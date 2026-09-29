import {
  describeUploadRejection,
  IPFS_UPLOAD_LIMITS,
  type IpfsUploadKind,
} from "./limits";

/**
 * Browser-side client for the server pin route. The browser never holds the
 * Pinata credential; it posts bytes to `/api/ipfs/pin` and receives the
 * content identifier back. Every metadata document Stolla commits on-chain is
 * produced through this client so users never author or paste URIs by hand.
 */
export const IPFS_PIN_ENDPOINT = "/api/ipfs/pin";

export type IpfsPinErrorKind =
  /** The server has no `PINATA_JWT`; retrying cannot help until it is set. */
  | "config"
  /** The bytes were rejected before any upload (MIME type, size). */
  | "validation"
  /** The request never completed; retrying is reasonable. */
  | "network"
  /** The pinning provider answered with an error; retrying is reasonable. */
  | "provider";

export class IpfsPinError extends Error {
  readonly kind: IpfsPinErrorKind;

  constructor(kind: IpfsPinErrorKind, message: string) {
    super(message);
    this.name = "IpfsPinError";
    this.kind = kind;
  }

  get retryable(): boolean {
    return this.kind === "network" || this.kind === "provider";
  }
}

export type PinResult = {
  cid: string;
  uri: string;
  size: number;
};

export type IpfsPinClient = {
  /** Pins a user-selected image and resolves its `ipfs://` URI. */
  pinFile(file: File): Promise<PinResult>;
  /** Pins exact document bytes; the returned CID commits to those bytes. */
  pinJson(bytes: Uint8Array, name: string): Promise<PinResult>;
};

export function validateImageFile(file: File): string | null {
  return describeUploadRejection("image", file.type, file.size);
}

export function ipfsUriFromCid(cid: string): string {
  return `ipfs://${cid}`;
}

type PinResponseBody =
  | { cid: string; uri: string; size: number }
  | { error: { kind: IpfsPinErrorKind; message: string } };

async function postPin(
  fetchImpl: typeof fetch,
  kind: IpfsUploadKind,
  blob: Blob,
  name: string,
): Promise<PinResult> {
  const rejection = describeUploadRejection(kind, blob.type, blob.size);
  if (rejection) throw new IpfsPinError("validation", rejection);

  const body = new FormData();
  body.set("kind", kind);
  body.set("name", name);
  body.set("file", blob, name);

  let response: Response;
  try {
    response = await fetchImpl(IPFS_PIN_ENDPOINT, { method: "POST", body });
  } catch {
    throw new IpfsPinError(
      "network",
      "The upload did not reach the server. Check your connection and retry.",
    );
  }

  let parsed: PinResponseBody | null = null;
  try {
    parsed = (await response.json()) as PinResponseBody;
  } catch {
    parsed = null;
  }

  if (!response.ok || !parsed || "error" in parsed) {
    const error = parsed && "error" in parsed ? parsed.error : null;
    throw new IpfsPinError(
      error?.kind ?? (response.status >= 500 ? "provider" : "validation"),
      error?.message ??
        `The pin request failed with HTTP ${response.status}. Retry the upload.`,
    );
  }

  if (
    typeof parsed.cid !== "string" ||
    !parsed.cid ||
    typeof parsed.uri !== "string" ||
    !parsed.uri.startsWith("ipfs://")
  ) {
    throw new IpfsPinError(
      "provider",
      "The pin service returned an unusable content identifier. Retry the upload.",
    );
  }

  return {
    cid: parsed.cid,
    uri: parsed.uri,
    size: typeof parsed.size === "number" ? parsed.size : blob.size,
  };
}

export function createIpfsPinClient(
  fetchImpl: typeof fetch = (...args) => globalThis.fetch(...args),
): IpfsPinClient {
  return {
    pinFile(file) {
      return postPin(fetchImpl, "image", file, file.name || "image");
    },
    pinJson(bytes, name) {
      const blob = new Blob([Uint8Array.from(bytes)], {
        type: IPFS_UPLOAD_LIMITS.jsonType,
      });
      return postPin(fetchImpl, "json", blob, name);
    },
  };
}
