import { describe, expect, it } from "vitest";
import {
  buildCollectionMetadataDocument,
  buildCommunityMetadataDocument,
  computeMetadataHash,
  decodeDocumentText,
  encodeCollectionMetadata,
  encodeCommunityMetadata,
} from "./metadataDocument";
import { parseCommunityMetadata } from "./schema";

const draft = {
  name: "Builders Guild",
  symbol: "BUILD",
  description: "A community for public-goods builders.",
  externalLinkLabel: "Website",
  externalLinkUrl: "https://builders.example",
};

/**
 * Golden fixtures. Changing these bytes changes every `metadata_hash` the
 * wizard produces, so a diff here must be a deliberate schema decision.
 */
const GOLDEN_COMMUNITY_JSON =
  '{"schemaVersion":1,"name":"Builders Guild","description":"A community for public-goods builders.","logo":"ipfs://bafy-logo","externalLinks":[{"label":"Website","url":"https://builders.example"}]}';
const GOLDEN_COMMUNITY_HASH =
  "94e5228a0151d91f88ac92b7836fd70156c915cf7065c21ac034a7d4427b3b8e";
const GOLDEN_COLLECTION_JSON =
  '{"name":"Builders Guild","symbol":"BUILD","description":"A community for public-goods builders.","image":"ipfs://bafy-logo"}';

describe("community metadata document", () => {
  it("emits canonical bytes in table order with no insignificant whitespace", async () => {
    const document = buildCommunityMetadataDocument(draft, "ipfs://bafy-logo");
    const bytes = encodeCommunityMetadata(document);

    expect(decodeDocumentText(bytes)).toBe(GOLDEN_COMMUNITY_JSON);
    expect(await computeMetadataHash(bytes)).toBe(GOLDEN_COMMUNITY_HASH);
  });

  it("is stable: identical inputs produce identical bytes and hash", async () => {
    const first = encodeCommunityMetadata(
      buildCommunityMetadataDocument({ ...draft }, "ipfs://bafy-logo"),
    );
    const second = encodeCommunityMetadata(
      buildCommunityMetadataDocument({ ...draft }, "ipfs://bafy-logo"),
    );
    expect(Array.from(first)).toEqual(Array.from(second));
    expect(await computeMetadataHash(first)).toBe(
      await computeMetadataHash(second),
    );
  });

  it("omits absent optionals instead of encoding null or empty values", async () => {
    const document = buildCommunityMetadataDocument({
      ...draft,
      externalLinkLabel: "",
      externalLinkUrl: "",
    });
    const text = decodeDocumentText(encodeCommunityMetadata(document));

    expect(text).toBe(
      '{"schemaVersion":1,"name":"Builders Guild","description":"A community for public-goods builders."}',
    );
    expect(text).not.toContain("null");
    expect(await computeMetadataHash(encodeCommunityMetadata(document))).not.toBe(
      GOLDEN_COMMUNITY_HASH,
    );
  });

  it("round-trips through the strict schema parser", () => {
    const bytes = encodeCommunityMetadata(
      buildCommunityMetadataDocument(draft, "ipfs://bafy-logo"),
    );
    expect(parseCommunityMetadata(JSON.parse(decodeDocumentText(bytes)))).toEqual({
      schemaVersion: 1,
      name: "Builders Guild",
      description: "A community for public-goods builders.",
      logo: "ipfs://bafy-logo",
      externalLinks: [{ label: "Website", url: "https://builders.example" }],
    });
  });

  it("does not normalize Unicode after input is accepted", () => {
    const composed = "Café";
    const decomposed = "Café";
    const a = encodeCommunityMetadata(
      buildCommunityMetadataDocument({ ...draft, name: composed }),
    );
    const b = encodeCommunityMetadata(
      buildCommunityMetadataDocument({ ...draft, name: decomposed }),
    );
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });
});

describe("NFT collection metadata document", () => {
  it("mirrors wizard identity fields and includes image only when a logo is known", () => {
    expect(
      decodeDocumentText(
        encodeCollectionMetadata(
          buildCollectionMetadataDocument(draft, "ipfs://bafy-logo"),
        ),
      ),
    ).toBe(GOLDEN_COLLECTION_JSON);
    expect(
      decodeDocumentText(
        encodeCollectionMetadata(buildCollectionMetadataDocument(draft)),
      ),
    ).toBe(
      '{"name":"Builders Guild","symbol":"BUILD","description":"A community for public-goods builders."}',
    );
  });
});
