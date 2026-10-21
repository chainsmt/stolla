import { parseProposalIndexSnapshot } from "./store";
import type { ProposalIndexLoad } from "./hydrate";

export const DEFAULT_PROPOSAL_INDEX_URL =
  process.env.NEXT_PUBLIC_PROPOSAL_INDEX_URL ?? "/proposal-index.json";

/**
 * Read the public JSON index. A failed request is an unavailable index,
 * not an empty proposal list.
 */
export async function loadProposalIndex(
  fetchImpl: typeof fetch = fetch,
  url: string = DEFAULT_PROPOSAL_INDEX_URL,
): Promise<ProposalIndexLoad> {
  try {
    const response = await fetchImpl(url, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      return {
        status: "unavailable",
        message: `Proposal index request failed (${response.status}).`,
      };
    }
    const snapshot = parseProposalIndexSnapshot(await response.json());
    if (!snapshot) {
      return {
        status: "unavailable",
        message: "Proposal index payload is not a version 1 snapshot.",
      };
    }
    if (snapshot.records.length === 0) return { status: "empty", snapshot };
    return { status: "ok", snapshot };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Proposal index request failed.";
    return { status: "unavailable", message };
  }
}
