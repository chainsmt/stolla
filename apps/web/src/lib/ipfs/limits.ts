/**
 * Upload limits shared by the browser pin client and the `/api/ipfs/pin`
 * route. Keeping them in one DOM-free module means the server rejects exactly
 * what the client already refuses to send, so a bypassed client cannot pin
 * something the UI would not accept.
 */
export const IPFS_UPLOAD_LIMITS = {
  /** Logo and token images. */
  imageMaxBytes: 5 * 1024 * 1024,
  imageTypes: [
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
    "image/svg+xml",
  ],
  /** Generated metadata documents are small by construction. */
  jsonMaxBytes: 256 * 1024,
  jsonType: "application/json",
} as const;

export type IpfsUploadKind = "image" | "json";

export function isAllowedImageType(type: string): boolean {
  return (IPFS_UPLOAD_LIMITS.imageTypes as readonly string[]).includes(type);
}

/**
 * Returns a human-readable rejection for an upload, or `null` when the
 * MIME type and size are acceptable for the given kind.
 */
export function describeUploadRejection(
  kind: IpfsUploadKind,
  type: string,
  size: number,
): string | null {
  if (kind === "json") {
    if (type !== IPFS_UPLOAD_LIMITS.jsonType) {
      return "Metadata documents must be application/json.";
    }
    if (size <= 0) return "Metadata documents cannot be empty.";
    if (size > IPFS_UPLOAD_LIMITS.jsonMaxBytes) {
      return `Metadata documents must be at most ${formatBytes(IPFS_UPLOAD_LIMITS.jsonMaxBytes)}.`;
    }
    return null;
  }
  if (!isAllowedImageType(type)) {
    return "Use a PNG, JPEG, WebP, GIF, or SVG image.";
  }
  if (size <= 0) return "The selected image is empty.";
  if (size > IPFS_UPLOAD_LIMITS.imageMaxBytes) {
    return `Images must be at most ${formatBytes(IPFS_UPLOAD_LIMITS.imageMaxBytes)}.`;
  }
  return null;
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} bytes`;
}
