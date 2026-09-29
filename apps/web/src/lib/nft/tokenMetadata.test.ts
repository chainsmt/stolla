import { describe, expect, it, vi } from "vitest";
import type { IpfsPinClient } from "@/lib/ipfs/pin";
import { publishTokenMetadata } from "./publishTokenMetadata";
import {
  buildTokenMetadataDocument,
  encodeTokenMetadata,
  validateTokenMetadataDraft,
} from "./tokenMetadata";

const draft = { name: "Stolla Member #1", description: "Community membership NFT" };

describe("token metadata document (SEP-0050)", () => {
  it("matches the locked shape with an image", () => {
    expect(
      new TextDecoder().decode(
        encodeTokenMetadata(buildTokenMetadataDocument(draft, "ipfs://bafyimage")),
      ),
    ).toBe(
      '{"name":"Stolla Member #1","description":"Community membership NFT","image":"ipfs://bafyimage","attributes":[]}',
    );
  });

  it("omits the image key entirely and keeps attributes as an empty array", () => {
    const text = new TextDecoder().decode(
      encodeTokenMetadata(buildTokenMetadataDocument(draft)),
    );
    expect(text).toBe(
      '{"name":"Stolla Member #1","description":"Community membership NFT","attributes":[]}',
    );
    expect(text).not.toContain("null");
  });

  it("validates name and description bounds without any URI field", () => {
    expect(validateTokenMetadataDraft(draft)).toEqual({});
    expect(validateTokenMetadataDraft({ name: "  ", description: "" })).toEqual({
      name: "Enter a display name for this membership token.",
      description: "Enter a short description.",
    });
    expect(
      validateTokenMetadataDraft({
        name: "x".repeat(65),
        description: "x".repeat(501),
      }),
    ).toEqual({
      name: "Use at most 64 UTF-8 bytes and no control characters.",
      description: "Use at most 500 UTF-8 bytes and no control characters.",
    });
    expect(validateTokenMetadataDraft({ name: "a\u0000b", description: "ok" })).toHaveProperty("name");
  });
});

describe("publishTokenMetadata", () => {
  function fakePin(): IpfsPinClient {
    return {
      pinFile: vi.fn(async () => ({ cid: "img", uri: "ipfs://img", size: 1 })),
      pinJson: vi.fn(async (bytes: Uint8Array) => ({
        cid: "doc",
        uri: "ipfs://doc",
        size: bytes.length,
      })),
    };
  }

  it("pins the image first and returns the document URI as token_uri", async () => {
    const pin = fakePin();
    const steps: string[] = [];
    const result = await publishTokenMetadata(
      draft,
      new File(["x"], "m.png", { type: "image/png" }),
      pin,
      (step) => steps.push(step),
    );
    expect(steps).toEqual(["image", "document"]);
    expect(result.tokenUri).toBe("ipfs://doc");
    expect(result.imageUri).toBe("ipfs://img");
    expect(result.json).toContain('"image":"ipfs://img"');
  });

  it("skips the image pin when no file is chosen", async () => {
    const pin = fakePin();
    const result = await publishTokenMetadata(draft, null, pin);
    expect(pin.pinFile).not.toHaveBeenCalled();
    expect(result.imageUri).toBeUndefined();
    expect(result.json).not.toContain("image");
  });

  it("propagates pin failures", async () => {
    const pin = fakePin();
    (pin.pinJson as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("down"));
    await expect(publishTokenMetadata(draft, null, pin)).rejects.toThrow("down");
  });
});
