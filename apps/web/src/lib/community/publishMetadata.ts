import type { IpfsPinClient } from "@/lib/ipfs/pin";
import {
  buildCollectionMetadataDocument,
  buildCommunityMetadataDocument,
  COLLECTION_METADATA_DOCUMENT_NAME,
  COMMUNITY_METADATA_DOCUMENT_NAME,
  computeMetadataHash,
  decodeDocumentText,
  encodeCollectionMetadata,
  encodeCommunityMetadata,
  type CollectionMetadataDocument,
} from "./metadataDocument";
import type { CommunityDeploymentPayload, CommunityMetadataDraft } from "./schema";
import type { CommunityMetadata } from "./types";

/**
 * The pin pipeline that turns wizard fields into the generated deployment
 * payload. Order matters: the logo must be pinned first because its URI is
 * embedded in both documents, and the community document must be pinned
 * before its hash is trusted, because the hash commits to the pinned bytes.
 *
 *   logo file (optional)  -> ipfs://logo
 *   community.json        -> ipfs://community   + sha256 -> metadata_hash
 *   collection.json       -> ipfs://collection
 */
export type PublishStep = "logo" | "community" | "collection";

export type CommunityMetadataPreview = {
  communityDocument: CommunityMetadata;
  communityJson: string;
  metadataHash: string;
  collectionDocument: CollectionMetadataDocument;
  collectionJson: string;
};

export type PublishedCommunityMetadata = CommunityMetadataPreview & {
  payload: CommunityDeploymentPayload;
};

/**
 * Read-only preview of the documents the pipeline will pin. When `logoUri`
 * is unknown (before pinning) the preview omits `logo`/`image`; once the logo
 * is pinned the same builder is used, so preview bytes and pinned bytes are
 * hash-equal.
 */
export async function previewCommunityMetadata(
  draft: CommunityMetadataDraft,
  logoUri?: string,
): Promise<CommunityMetadataPreview> {
  const communityDocument = buildCommunityMetadataDocument(draft, logoUri);
  const communityBytes = encodeCommunityMetadata(communityDocument);
  const collectionDocument = buildCollectionMetadataDocument(draft, logoUri);
  return {
    communityDocument,
    communityJson: decodeDocumentText(communityBytes),
    metadataHash: await computeMetadataHash(communityBytes),
    collectionDocument,
    collectionJson: decodeDocumentText(encodeCollectionMetadata(collectionDocument)),
  };
}

export async function publishCommunityMetadata(
  draft: CommunityMetadataDraft,
  logoFile: File | null,
  pin: IpfsPinClient,
  onStep?: (step: PublishStep) => void,
): Promise<PublishedCommunityMetadata> {
  let logoUri: string | undefined;
  if (logoFile) {
    onStep?.("logo");
    logoUri = (await pin.pinFile(logoFile)).uri;
  }

  onStep?.("community");
  const communityDocument = buildCommunityMetadataDocument(draft, logoUri);
  const communityBytes = encodeCommunityMetadata(communityDocument);
  const metadataHash = await computeMetadataHash(communityBytes);
  const community = await pin.pinJson(
    communityBytes,
    COMMUNITY_METADATA_DOCUMENT_NAME,
  );

  onStep?.("collection");
  const collectionDocument = buildCollectionMetadataDocument(draft, logoUri);
  const collectionBytes = encodeCollectionMetadata(collectionDocument);
  const collection = await pin.pinJson(
    collectionBytes,
    COLLECTION_METADATA_DOCUMENT_NAME,
  );

  return {
    communityDocument,
    communityJson: decodeDocumentText(communityBytes),
    metadataHash,
    collectionDocument,
    collectionJson: decodeDocumentText(collectionBytes),
    payload: {
      collectionUri: collection.uri,
      metadataUri: community.uri,
      metadataHash,
      ...(logoUri ? { logoUri } : {}),
    },
  };
}
