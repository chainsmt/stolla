import { COMMUNITY_LIMITS, isResourceUri, utf8Length } from "./schema";

const SCHEME_ONLY = new Set(["ipfs://", "https://"]);

/**
 * Validate a SEP-0050 style mint metadata URI before wallet/simulation work.
 * Returns an inline field error message, or null when the URI is acceptable.
 */
export function validateMintTokenUri(raw: string): string | null {
  const value = raw.trim();

  if (!value) {
    return "IPFS metadata URI is required.";
  }

  if (SCHEME_ONLY.has(value)) {
    return "Enter a full ipfs:// or https:// URI with a path or CID (SEP-0050). Scheme alone is not enough.";
  }

  if (!value.startsWith("ipfs://") && !value.startsWith("https://")) {
    return "Use an ipfs:// or https:// URI (SEP-0050).";
  }

  if (utf8Length(value) > COMMUNITY_LIMITS.uriBytes) {
    return `URI must be at most ${COMMUNITY_LIMITS.uriBytes} UTF-8 bytes.`;
  }

  if (!isResourceUri(value)) {
    return "Use a valid ipfs:// or https:// URI with a non-empty path or CID (SEP-0050).";
  }

  return null;
}
