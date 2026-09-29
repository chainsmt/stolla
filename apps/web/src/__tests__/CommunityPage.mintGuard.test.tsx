import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { IpfsPinError } from "@/lib/ipfs/pin";

const mocks = vi.hoisted(() => ({
  useWallet: vi.fn(),
  createNftClient: vi.fn(),
  createReadOnlyNftClient: vi.fn(),
  runCommunityRefresh: vi.fn(),
  getE2EBridge: vi.fn(),
  pinFile: vi.fn(),
  pinJson: vi.fn(),
}));

vi.mock("@/lib/e2eMock", () => ({
  getE2EBridge: mocks.getE2EBridge,
}));

vi.mock("@/context/WalletProvider", () => ({
  useWallet: mocks.useWallet,
}));

vi.mock("@/lib/contracts", () => ({
  createNftClient: mocks.createNftClient,
  createReadOnlyNftClient: mocks.createReadOnlyNftClient,
}));

vi.mock("@/lib/stellar", () => ({
  contractIds: { nft: "CNFT", governor: "CGOV" },
}));

vi.mock("@/app/(app)/community/community-data.mjs", () => ({
  loadCommunityData: vi.fn(),
  runCommunityRefresh: mocks.runCommunityRefresh,
}));

import CommunityPage from "@/app/(app)/community/page";

/** Fills the SEP-0050 authoring fields; there is no URI input to fill. */
function fillMembership(name = "Stolla Member #1", description = "Community membership NFT") {
  fireEvent.change(screen.getByLabelText(/Display name/i), {
    target: { value: name },
  });
  fireEvent.change(screen.getByLabelText(/^Description/i), {
    target: { value: description },
  });
}

function selectImage(file: File) {
  const input = screen.getByLabelText(/^Image/i) as HTMLInputElement;
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  fireEvent.change(input);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("CommunityPage mint lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, "", "/community");
    mocks.pinFile.mockImplementation(async (file: File) => ({
      cid: "bafyimage",
      uri: "ipfs://bafyimage",
      size: file.size,
    }));
    mocks.pinJson.mockImplementation(async (bytes: Uint8Array) => ({
      cid: "bafytoken",
      uri: "ipfs://bafytoken",
      size: bytes.length,
    }));
    mocks.getE2EBridge.mockReturnValue({
      pin: { pinFile: mocks.pinFile, pinJson: mocks.pinJson },
    });
    mocks.useWallet.mockReturnValue({
      address: "GWALLET",
      signTransaction: vi.fn(),
      isConnecting: false,
    });
    mocks.runCommunityRefresh.mockImplementation(
      async (
        _load: unknown,
        callbacks: {
          onStart: () => void;
          onSuccess: (data: {
            name: string;
            symbol: string;
            balance: number;
            votes: string;
          }) => void;
        },
      ) => {
        callbacks.onStart();
        callbacks.onSuccess({
          name: "Stolla",
          symbol: "STL",
          balance: 1,
          votes: "0",
        });
        return true;
      },
    );
  });

  it("shows simulating then approval then confirmation for mint", async () => {
    const signGate = deferred<void>();
    const sendGate = deferred<{ result: number; hash: string }>();
    const mint = vi.fn().mockResolvedValue({
      sign: () => signGate.promise,
      send: () => sendGate.promise,
    });
    mocks.createNftClient.mockReturnValue({ mint });

    render(<CommunityPage />);
    fireEvent.change(await screen.findByLabelText(/Recipient address/i), {
      target: { value: "GRECIPIENT" },
    });
    fillMembership();

    const button = screen.getByRole("button", { name: "Mint NFT" });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(
      await screen.findByText("Waiting for wallet approval…"),
    ).toBeInTheDocument();
    expect(mint).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();

    await act(async () => {
      signGate.resolve();
    });
    expect(
      await screen.findByText("Confirming on ledger…"),
    ).toBeInTheDocument();

    await act(async () => {
      sendGate.resolve({
        result: 7,
        hash: "a1b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef0",
      });
    });

    expect(
      await screen.findByText("Minted token #7 successfully."),
    ).toBeInTheDocument();
    expect(await screen.findByText("Mint confirmed")).toBeInTheDocument();
  });

  it("re-enables mint after wallet rejection", async () => {
    const mint = vi
      .fn()
      .mockResolvedValueOnce({
        sign: async () => {
          throw new Error("User rejected the request");
        },
        send: vi.fn(),
      })
      .mockResolvedValueOnce({
        sign: async () => undefined,
        send: async () => ({ result: 9 }),
      });
    mocks.createNftClient.mockReturnValue({ mint });

    render(<CommunityPage />);
    fireEvent.change(await screen.findByLabelText(/Recipient address/i), {
      target: { value: "GRECIPIENT" },
    });
    fillMembership();

    const button = screen.getByRole("button", { name: "Mint NFT" });
    fireEvent.click(button);
    expect(
      (await screen.findAllByText(/rejected the wallet request/i)).length,
    ).toBeGreaterThanOrEqual(1);
    expect(screen.getByLabelText(/Recipient address/i)).toHaveValue(
      "GRECIPIENT",
    );
    expect(screen.getByLabelText(/Display name/i)).toHaveValue("Stolla Member #1");
    await waitFor(() => expect(button).not.toBeDisabled());

    fireEvent.click(button);
    expect(
      await screen.findByText("Minted token #9 successfully."),
    ).toBeInTheDocument();
    expect(mint).toHaveBeenCalledTimes(2);
  });

  it("does not call mint when wallet is disconnected", async () => {
    const mint = vi.fn();
    mocks.createNftClient.mockReturnValue({ mint });
    mocks.useWallet.mockReturnValue({
      address: null,
      signTransaction: vi.fn(),
      isConnecting: false,
    });

    render(<CommunityPage />);
    expect(
      await screen.findByRole("button", { name: "Mint NFT" }),
    ).toBeDisabled();
    expect(mint).not.toHaveBeenCalled();
  });

  it("has no URI input, disables mint until the authoring fields are valid, and never pins early", async () => {
    const mint = vi.fn();
    mocks.createNftClient.mockReturnValue({ mint });

    render(<CommunityPage />);
    const button = await screen.findByRole("button", { name: "Mint NFT" });
    expect(screen.queryByLabelText(/metadata URI/i)).not.toBeInTheDocument();
    expect(document.querySelector('input[value^="ipfs://"]')).toBeNull();
    expect(button).toBeDisabled();

    fillMembership("x".repeat(65), "ok");
    expect(button).toBeDisabled();

    fillMembership();
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(
      await screen.findByText("Recipient address is required."),
    ).toBeInTheDocument();
    expect(mocks.pinJson).not.toHaveBeenCalled();
    expect(mint).not.toHaveBeenCalled();
  });

  it("rejects a bad image before any pin request", async () => {
    render(<CommunityPage />);
    await screen.findByRole("button", { name: "Mint NFT" });
    fillMembership();
    selectImage(new File(["x"], "member.bmp", { type: "image/bmp" }));

    expect(screen.getByText("Use a PNG, JPEG, WebP, GIF, or SVG image.")).toHaveAttribute(
      "role",
      "alert",
    );
    expect(screen.getByRole("button", { name: "Mint NFT" })).toBeDisabled();
    expect(mocks.pinFile).not.toHaveBeenCalled();
  });

  it("rejects a scheme-only generated token_uri before mint simulation", async () => {
    const mint = vi.fn();
    mocks.createNftClient.mockReturnValue({ mint });
    mocks.pinJson.mockResolvedValue({
      cid: "",
      uri: "ipfs://",
      size: 1,
    });

    render(<CommunityPage />);
    fireEvent.change(await screen.findByLabelText(/Recipient address/i), {
      target: { value: "GRECIPIENT" },
    });
    fillMembership();
    fireEvent.click(screen.getByRole("button", { name: "Mint NFT" }));

    expect(
      await screen.findByText(/Scheme alone is not enough/i),
    ).toBeInTheDocument();
    expect(mint).not.toHaveBeenCalled();
  });

  it("pins image then document and calls mint with the generated token_uri only", async () => {
    const mint = vi.fn().mockResolvedValue({
      sign: async () => undefined,
      send: async () => ({ result: 3 }),
    });
    mocks.createNftClient.mockReturnValue({ mint });

    render(<CommunityPage />);
    fireEvent.change(await screen.findByLabelText(/Recipient address/i), {
      target: { value: "GRECIPIENT" },
    });
    fillMembership();
    selectImage(new File(["png"], "member.png", { type: "image/png" }));
    fireEvent.click(screen.getByRole("button", { name: "Mint NFT" }));

    await waitFor(() => {
      expect(mint).toHaveBeenCalledWith({
        to: "GRECIPIENT",
        token_uri: "ipfs://bafytoken",
      });
    });
    expect(mocks.pinFile).toHaveBeenCalledTimes(1);
    expect(mocks.pinFile.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.pinJson.mock.invocationCallOrder[0],
    );
    const pinnedJson = new TextDecoder().decode(mocks.pinJson.mock.calls[0][0]);
    expect(pinnedJson).toBe(
      '{"name":"Stolla Member #1","description":"Community membership NFT","image":"ipfs://bafyimage","attributes":[]}',
    );
    expect(screen.getByText(/token_uri: ipfs:\/\/bafytoken/)).toBeInTheDocument();
  });

  it("keeps mint disabled with a retryable error when pinning fails, then mints after retry", async () => {
    const mint = vi.fn().mockResolvedValue({
      sign: async () => undefined,
      send: async () => ({ result: 4 }),
    });
    mocks.createNftClient.mockReturnValue({ mint });
    mocks.pinJson.mockRejectedValueOnce(
      new IpfsPinError("provider", "Pinata is unavailable."),
    );

    render(<CommunityPage />);
    fireEvent.change(await screen.findByLabelText(/Recipient address/i), {
      target: { value: "GRECIPIENT" },
    });
    fillMembership();
    fireEvent.click(screen.getByRole("button", { name: "Mint NFT" }));

    expect(
      await screen.findByText(/Metadata upload failed: Pinata is unavailable\./),
    ).toHaveAttribute("role", "alert");
    expect(screen.getByRole("button", { name: "Mint NFT" })).toBeDisabled();
    expect(screen.getByLabelText(/Display name/i)).toHaveValue("Stolla Member #1");
    expect(mint).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Retry upload" }));
    expect(await screen.findByText(/token_uri: ipfs:\/\/bafytoken/)).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "Mint NFT" });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(() =>
      expect(mint).toHaveBeenCalledWith({ to: "GRECIPIENT", token_uri: "ipfs://bafytoken" }),
    );
    expect(mocks.pinJson).toHaveBeenCalledTimes(2);
  });

  it("reports a missing PINATA_JWT as a non-retryable configuration error", async () => {
    mocks.createNftClient.mockReturnValue({ mint: vi.fn() });
    mocks.pinJson.mockRejectedValue(
      new IpfsPinError("config", "Set PINATA_JWT before minting."),
    );

    render(<CommunityPage />);
    fireEvent.change(await screen.findByLabelText(/Recipient address/i), {
      target: { value: "GRECIPIENT" },
    });
    fillMembership();
    fireEvent.click(screen.getByRole("button", { name: "Mint NFT" }));

    expect(await screen.findByText(/Set PINATA_JWT/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry upload" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mint NFT" })).toBeDisabled();
  });

  it("drops the generated token_uri when a field is edited after pinning", async () => {
    const mint = vi.fn().mockRejectedValue(new Error("simulation failed: not the owner"));
    mocks.createNftClient.mockReturnValue({ mint });

    render(<CommunityPage />);
    fireEvent.change(await screen.findByLabelText(/Recipient address/i), {
      target: { value: "GRECIPIENT" },
    });
    fillMembership();
    fireEvent.click(screen.getByRole("button", { name: "Mint NFT" }));
    expect(await screen.findByText(/token_uri: ipfs:\/\/bafytoken/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Display name/i), {
      target: { value: "Renamed" },
    });
    expect(screen.queryByText(/token_uri:/)).not.toBeInTheDocument();
  });

  it("shows simulation failure and preserves form input", async () => {
    const mint = vi
      .fn()
      .mockRejectedValue(new Error("simulation failed: not the owner"));
    mocks.createNftClient.mockReturnValue({ mint });

    render(<CommunityPage />);
    fireEvent.change(await screen.findByLabelText(/Recipient address/i), {
      target: { value: "GRECIPIENT" },
    });
    fillMembership();
    fireEvent.click(screen.getByRole("button", { name: "Mint NFT" }));

    expect(
      (await screen.findAllByText(/could not be simulated/i)).length,
    ).toBeGreaterThanOrEqual(1);
    expect(screen.getByLabelText(/Recipient address/i)).toHaveValue(
      "GRECIPIENT",
    );
    expect(screen.getByLabelText(/Display name/i)).toHaveValue("Stolla Member #1");
  });

  it("shows submission failure and preserves form input", async () => {
    const mint = vi.fn().mockResolvedValue({
      sign: async () => undefined,
      send: async () => {
        throw new Error("send failed: rpc unavailable");
      },
    });
    mocks.createNftClient.mockReturnValue({ mint });

    render(<CommunityPage />);
    fireEvent.change(await screen.findByLabelText(/Recipient address/i), {
      target: { value: "GKEEP" },
    });
    fillMembership();
    fireEvent.click(screen.getByRole("button", { name: "Mint NFT" }));

    expect(
      (await screen.findAllByText(/could not be submitted|temporarily unreachable/i))
        .length,
    ).toBeGreaterThanOrEqual(1);
    expect(screen.getByLabelText(/Recipient address/i)).toHaveValue("GKEEP");
    expect(screen.getByLabelText(/Display name/i)).toHaveValue("Stolla Member #1");
  });
});
