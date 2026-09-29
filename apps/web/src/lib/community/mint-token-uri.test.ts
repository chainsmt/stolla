import { describe, expect, it } from "vitest";
import { COMMUNITY_LIMITS } from "./schema";
import { validateMintTokenUri } from "./mint-token-uri";

describe("validateMintTokenUri", () => {
  it("rejects empty and whitespace-only values", () => {
    expect(validateMintTokenUri("")).toMatch(/required/i);
    expect(validateMintTokenUri("   ")).toMatch(/required/i);
  });

  it("rejects scheme-only URIs", () => {
    expect(validateMintTokenUri("ipfs://")).toMatch(/scheme alone/i);
    expect(validateMintTokenUri("https://")).toMatch(/scheme alone/i);
    expect(validateMintTokenUri("  ipfs://  ")).toMatch(/scheme alone/i);
  });

  it("rejects unsupported schemes", () => {
    expect(validateMintTokenUri("http://example.com/meta.json")).toMatch(
      /ipfs:\/\/ or https:\/\//i,
    );
    expect(validateMintTokenUri("ar://abc")).toMatch(/ipfs:\/\/ or https:\/\//i);
  });

  it("accepts valid ipfs and https URIs including Unicode and long CIDs", () => {
    expect(validateMintTokenUri("ipfs://bafybeigmockcid/member.json")).toBe(
      null,
    );
    expect(
      validateMintTokenUri(
        "ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
      ),
    ).toBe(null);
    expect(validateMintTokenUri("ipfs://bafy/ünicode-member.json")).toBe(null);
    expect(
      validateMintTokenUri("https://example.com/metadata/member.json"),
    ).toBe(null);
  });

  it("rejects URIs above the byte limit", () => {
    const oversized = `ipfs://${"a".repeat(COMMUNITY_LIMITS.uriBytes)}`;
    expect(validateMintTokenUri(oversized)).toMatch(/at most/i);
  });

  it("rejects https URIs without a usable host", () => {
    expect(validateMintTokenUri("https://")).toMatch(/scheme alone/i);
    expect(validateMintTokenUri("https:// ")).toMatch(/valid|scheme/i);
  });
});
