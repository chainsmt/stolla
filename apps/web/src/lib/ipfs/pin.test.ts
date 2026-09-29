import { describe, expect, it, vi } from "vitest";
import { describeUploadRejection, IPFS_UPLOAD_LIMITS } from "./limits";
import {
  createIpfsPinClient,
  IPFS_PIN_ENDPOINT,
  IpfsPinError,
  validateImageFile,
} from "./pin";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("IPFS upload limits", () => {
  it("accepts allowed image types within the size limit", () => {
    expect(describeUploadRejection("image", "image/png", 1024)).toBeNull();
    expect(
      describeUploadRejection("image", "image/webp", IPFS_UPLOAD_LIMITS.imageMaxBytes),
    ).toBeNull();
  });

  it("rejects unsupported MIME types, empty files, and oversized uploads", () => {
    expect(describeUploadRejection("image", "application/pdf", 10)).toMatch(
      /PNG, JPEG, WebP, GIF, or SVG/,
    );
    expect(describeUploadRejection("image", "image/png", 0)).toMatch(/empty/);
    expect(
      describeUploadRejection(
        "image",
        "image/png",
        IPFS_UPLOAD_LIMITS.imageMaxBytes + 1,
      ),
    ).toMatch(/at most 5 MB/);
    expect(describeUploadRejection("json", "text/plain", 10)).toMatch(
      /application\/json/,
    );
    expect(
      describeUploadRejection(
        "json",
        "application/json",
        IPFS_UPLOAD_LIMITS.jsonMaxBytes + 1,
      ),
    ).toMatch(/at most 256 KB/);
  });

  it("validates a File through the same rule", () => {
    expect(
      validateImageFile(new File(["x"], "logo.png", { type: "image/png" })),
    ).toBeNull();
    expect(
      validateImageFile(new File(["x"], "logo.bmp", { type: "image/bmp" })),
    ).toMatch(/PNG, JPEG/);
  });
});

describe("createIpfsPinClient", () => {
  it("posts exact JSON bytes as multipart form data and returns the ipfs:// URI", async () => {
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = init?.body as FormData;
      const file = body.get("file") as File;
      expect(body.get("kind")).toBe("json");
      expect(body.get("name")).toBe("community.json");
      expect(file.type).toBe("application/json");
      expect(await file.text()).toBe('{"a":1}');
      return jsonResponse(200, { cid: "bafycid", uri: "ipfs://bafycid", size: 7 });
    });
    const client = createIpfsPinClient(fetchImpl as unknown as typeof fetch);

    await expect(
      client.pinJson(new TextEncoder().encode('{"a":1}'), "community.json"),
    ).resolves.toEqual({ cid: "bafycid", uri: "ipfs://bafycid", size: 7 });
    expect(fetchImpl).toHaveBeenCalledWith(
      IPFS_PIN_ENDPOINT,
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("rejects a bad image before any request is sent", async () => {
    const fetchImpl = vi.fn();
    const client = createIpfsPinClient(fetchImpl as unknown as typeof fetch);
    const file = new File(["x"], "doc.pdf", { type: "application/pdf" });

    await expect(client.pinFile(file)).rejects.toMatchObject({
      name: "IpfsPinError",
      kind: "validation",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("surfaces the server config error as non-retryable", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(503, {
        error: { kind: "config", message: "Set PINATA_JWT." },
      }),
    );
    const client = createIpfsPinClient(fetchImpl as unknown as typeof fetch);
    const file = new File(["x"], "logo.png", { type: "image/png" });

    const error = await client.pinFile(file).catch((caught) => caught);
    expect(error).toBeInstanceOf(IpfsPinError);
    expect(error.kind).toBe("config");
    expect(error.retryable).toBe(false);
    expect(error.message).toBe("Set PINATA_JWT.");
  });

  it("maps transport failures and provider failures to retryable errors", async () => {
    const offline = createIpfsPinClient(
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }) as unknown as typeof fetch,
    );
    const file = new File(["x"], "logo.png", { type: "image/png" });
    const transport = await offline.pinFile(file).catch((caught) => caught);
    expect(transport.kind).toBe("network");
    expect(transport.retryable).toBe(true);

    const flaky = createIpfsPinClient(
      vi.fn(async () => new Response("bad gateway", { status: 502 })) as unknown as typeof fetch,
    );
    const provider = await flaky.pinFile(file).catch((caught) => caught);
    expect(provider.kind).toBe("provider");
    expect(provider.retryable).toBe(true);
  });

  it("rejects a success response without a usable CID", async () => {
    const client = createIpfsPinClient(
      vi.fn(async () => jsonResponse(200, { cid: "", uri: "" })) as unknown as typeof fetch,
    );
    await expect(
      client.pinJson(new TextEncoder().encode("{}"), "x.json"),
    ).rejects.toMatchObject({ kind: "provider" });
  });
});
