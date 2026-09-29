import { describe, expect, it, vi } from "vitest";
import type { IpfsPinClient } from "@/lib/ipfs/pin";
import { computeMetadataHash } from "./metadataDocument";
import { previewCommunityMetadata, publishCommunityMetadata } from "./publishMetadata";
import { validateDeploymentPayload } from "./schema";

const draft = {
  name: "Builders Guild",
  symbol: "BUILD",
  description: "A community for public-goods builders.",
  externalLinkLabel: "",
  externalLinkUrl: "",
};

function fakePin(): IpfsPinClient & { pinned: { name: string; text: string }[] } {
  const pinned: { name: string; text: string }[] = [];
  return {
    pinned,
    pinFile: vi.fn(async (file: File) => {
      pinned.push({ name: file.name, text: "" });
      return { cid: "bafylogo", uri: "ipfs://bafylogo", size: file.size };
    }),
    pinJson: vi.fn(async (bytes: Uint8Array, name: string) => {
      pinned.push({ name, text: new TextDecoder().decode(bytes) });
      return { cid: `bafy-${name}`, uri: `ipfs://bafy-${name}`, size: bytes.length };
    }),
  };
}

describe("publishCommunityMetadata", () => {
  it("pins logo, community, then collection and returns a valid generated payload", async () => {
    const pin = fakePin();
    const steps: string[] = [];
    const logo = new File(["png"], "logo.png", { type: "image/png" });

    const result = await publishCommunityMetadata(draft, logo, pin, (step) =>
      steps.push(step),
    );

    expect(steps).toEqual(["logo", "community", "collection"]);
    expect(pin.pinned.map((entry) => entry.name)).toEqual([
      "logo.png",
      "community.json",
      "collection.json",
    ]);
    expect(result.payload).toEqual({
      collectionUri: "ipfs://bafy-collection.json",
      metadataUri: "ipfs://bafy-community.json",
      metadataHash: result.metadataHash,
      logoUri: "ipfs://bafylogo",
    });
    expect(validateDeploymentPayload(result.payload)).toEqual({});
    expect(result.communityJson).toContain('"logo":"ipfs://bafylogo"');
    expect(result.collectionJson).toContain('"image":"ipfs://bafylogo"');
  });

  it("hashes exactly the bytes that were pinned", async () => {
    const pin = fakePin();
    const result = await publishCommunityMetadata(draft, null, pin);
    const pinnedCommunity = pin.pinned.find((entry) => entry.name === "community.json");

    expect(pinnedCommunity?.text).toBe(result.communityJson);
    expect(
      await computeMetadataHash(new TextEncoder().encode(pinnedCommunity!.text)),
    ).toBe(result.payload.metadataHash);
  });

  it("omits the logo without breaking the pin path or the documents", async () => {
    const pin = fakePin();
    const result = await publishCommunityMetadata(draft, null, pin);

    expect(pin.pinFile).not.toHaveBeenCalled();
    expect(result.payload.logoUri).toBeUndefined();
    expect(result.communityJson).not.toContain("logo");
    expect(result.collectionJson).not.toContain("image");
    expect(validateDeploymentPayload(result.payload)).toEqual({});
  });

  it("propagates a pin failure without producing a partial payload", async () => {
    const pin = fakePin();
    (pin.pinJson as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("provider down"),
    );

    await expect(publishCommunityMetadata(draft, null, pin)).rejects.toThrow(
      "provider down",
    );
    expect(pin.pinned.filter((entry) => entry.name === "collection.json")).toHaveLength(0);
  });

  it("preview bytes are hash-equal to the pinned community bytes", async () => {
    const pin = fakePin();
    const published = await publishCommunityMetadata(draft, null, pin);
    const preview = await previewCommunityMetadata(draft);

    expect(preview.communityJson).toBe(published.communityJson);
    expect(preview.metadataHash).toBe(published.payload.metadataHash);
  });
});
