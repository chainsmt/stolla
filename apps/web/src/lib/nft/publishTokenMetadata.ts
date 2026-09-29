import type { IpfsPinClient } from "@/lib/ipfs/pin";
import { validateMintTokenUri } from "@/lib/community/mint-token-uri";
import {
  buildTokenMetadataDocument,
  encodeTokenMetadata,
  TOKEN_METADATA_DOCUMENT_NAME,
  type TokenMetadataDocument,
  type TokenMetadataDraft,
} from "./tokenMetadata";

export type PublishedTokenMetadata = {
  /** The generated `token_uri`; the only value handed to `mint`. */
  tokenUri: string;
  imageUri?: string;
  document: TokenMetadataDocument;
  json: string;
};

export type TokenPublishStep = "image" | "document";

/** image (optional) → token.json → ipfs:// token_uri */
export async function publishTokenMetadata(
  draft: TokenMetadataDraft,
  imageFile: File | null,
  pin: IpfsPinClient,
  onStep?: (step: TokenPublishStep) => void,
): Promise<PublishedTokenMetadata> {
  let imageUri: string | undefined;
  if (imageFile) {
    onStep?.("image");
    imageUri = (await pin.pinFile(imageFile)).uri;
  }
  onStep?.("document");
  const document = buildTokenMetadataDocument(draft, imageUri);
  const bytes = encodeTokenMetadata(document);
  const pinned = await pin.pinJson(bytes, TOKEN_METADATA_DOCUMENT_NAME);
  const uriError = validateMintTokenUri(pinned.uri);
  if (uriError) {
    throw new Error(uriError);
  }
  return {
    tokenUri: pinned.uri,
    ...(imageUri ? { imageUri } : {}),
    document,
    json: new TextDecoder().decode(bytes),
  };
}
