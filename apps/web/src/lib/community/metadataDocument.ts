import type { CommunityExternalLink, CommunityMetadata } from "./types";
import type { CommunityMetadataDraft } from "./schema";

/**
 * Deterministic serializers for the two off-chain documents CommunityFactory
 * creation depends on. Both are produced from wizard fields only; the creator
 * never authors or pastes a URI.
 *
 * Community metadata (schema version 1) follows
 * `docs/community-metadata-governance-schema.md`: keys in table order, no
 * insignificant whitespace, absent optionals omitted (never `null`), and no
 * Unicode normalization after input is accepted. The SHA-256 of these exact
 * bytes becomes the on-chain `metadata_hash`.
 *
 * NFT collection metadata is the minimal SEP-0050 style collection document
 * `{ "name", "symbol", "description", "image"? }`. `name` and `symbol` mirror
 * the on-chain collection values so a reader of `collection_uri` sees the same
 * identity the contract reports; `image` is included only when a logo was
 * pinned. See https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0050.md
 */
export type CollectionMetadataDocument = {
  name: string;
  symbol: string;
  description: string;
  image?: string;
};

export const COMMUNITY_METADATA_DOCUMENT_NAME = "community.json";
export const COLLECTION_METADATA_DOCUMENT_NAME = "collection.json";

const textEncoder = new TextEncoder();

export function draftExternalLinks(
  draft: Pick<CommunityMetadataDraft, "externalLinkLabel" | "externalLinkUrl">,
): CommunityExternalLink[] {
  const label = draft.externalLinkLabel.trim();
  const url = draft.externalLinkUrl.trim();
  return label && url ? [{ label, url }] : [];
}

/**
 * Builds the version-1 community document. Keys are inserted in the
 * documented order so `JSON.stringify` yields canonical bytes.
 */
export function buildCommunityMetadataDocument(
  draft: Pick<
    CommunityMetadataDraft,
    "name" | "description" | "externalLinkLabel" | "externalLinkUrl"
  >,
  logoUri?: string,
): CommunityMetadata {
  const document: CommunityMetadata = {
    schemaVersion: 1,
    name: draft.name,
    description: draft.description,
    externalLinks: draftExternalLinks(draft),
  };
  if (logoUri) {
    return {
      schemaVersion: 1,
      name: document.name,
      description: document.description,
      logo: logoUri,
      externalLinks: document.externalLinks,
    };
  }
  return document;
}

export function encodeCommunityMetadata(document: CommunityMetadata): Uint8Array {
  const ordered: Record<string, unknown> = {
    schemaVersion: document.schemaVersion,
    name: document.name,
    description: document.description,
  };
  if (document.logo !== undefined) ordered.logo = document.logo;
  if (document.externalLinks.length > 0) {
    ordered.externalLinks = document.externalLinks.map(({ label, url }) => ({
      label,
      url,
    }));
  }
  return textEncoder.encode(JSON.stringify(ordered));
}

export function buildCollectionMetadataDocument(
  draft: Pick<CommunityMetadataDraft, "name" | "symbol" | "description">,
  imageUri?: string,
): CollectionMetadataDocument {
  const document: CollectionMetadataDocument = {
    name: draft.name,
    symbol: draft.symbol,
    description: draft.description,
  };
  if (imageUri) document.image = imageUri;
  return document;
}

export function encodeCollectionMetadata(
  document: CollectionMetadataDocument,
): Uint8Array {
  const ordered: Record<string, unknown> = {
    name: document.name,
    symbol: document.symbol,
    description: document.description,
  };
  if (document.image !== undefined) ordered.image = document.image;
  return textEncoder.encode(JSON.stringify(ordered));
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  const copy = Uint8Array.from(bytes);
  return new Uint8Array(
    await globalThis.crypto.subtle.digest("SHA-256", copy.buffer),
  );
}

/** Lowercase hex SHA-256 of the exact document bytes: the `metadata_hash`. */
export async function computeMetadataHash(bytes: Uint8Array): Promise<string> {
  return bytesToHex(await sha256(bytes));
}

export function decodeDocumentText(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}
