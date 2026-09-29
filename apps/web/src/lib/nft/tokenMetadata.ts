import { utf8Length } from "@/lib/community/schema";

/**
 * SEP-0050 membership token metadata authored in the mint form. The shape is
 * locked by #311: exact keys, absent optionals omitted (never `null`), and
 * `attributes` always present as an empty array until an attribute editor
 * exists. See docs/adr/003-ipfs-metadata.md.
 *
 *   { "name": "…", "description": "…", "image": "ipfs://…", "attributes": [] }
 */
export const TOKEN_METADATA_LIMITS = {
  nameBytes: 64,
  descriptionBytes: 500,
} as const;

export const TOKEN_METADATA_DOCUMENT_NAME = "token.json";

export type TokenMetadataDraft = {
  name: string;
  description: string;
};

export type TokenMetadataDraftErrors = Partial<
  Record<keyof TokenMetadataDraft, string>
>;

export type TokenMetadataDocument = {
  name: string;
  description: string;
  image?: string;
  attributes: [];
};

function hasControlCharacter(value: string): boolean {
  return /[\u0000-\u001f\u007f]/.test(value);
}

/** Authoring-layer validation: name and description only, no URI strings. */
export function validateTokenMetadataDraft(
  draft: TokenMetadataDraft,
): TokenMetadataDraftErrors {
  const errors: TokenMetadataDraftErrors = {};
  const name = draft.name.trim();
  const description = draft.description.trim();

  if (!name) {
    errors.name = "Enter a display name for this membership token.";
  } else if (
    utf8Length(name) > TOKEN_METADATA_LIMITS.nameBytes ||
    hasControlCharacter(name)
  ) {
    errors.name = "Use at most 64 UTF-8 bytes and no control characters.";
  }

  if (!description) {
    errors.description = "Enter a short description.";
  } else if (
    utf8Length(description) > TOKEN_METADATA_LIMITS.descriptionBytes ||
    hasControlCharacter(description)
  ) {
    errors.description = "Use at most 500 UTF-8 bytes and no control characters.";
  }

  return errors;
}

export function buildTokenMetadataDocument(
  draft: TokenMetadataDraft,
  imageUri?: string,
): TokenMetadataDocument {
  const document: TokenMetadataDocument = {
    name: draft.name.trim(),
    description: draft.description.trim(),
    attributes: [],
  };
  if (imageUri) {
    return {
      name: document.name,
      description: document.description,
      image: imageUri,
      attributes: [],
    };
  }
  return document;
}

export function encodeTokenMetadata(document: TokenMetadataDocument): Uint8Array {
  const ordered: Record<string, unknown> = {
    name: document.name,
    description: document.description,
  };
  if (document.image !== undefined) ordered.image = document.image;
  ordered.attributes = [];
  return new TextEncoder().encode(JSON.stringify(ordered));
}
