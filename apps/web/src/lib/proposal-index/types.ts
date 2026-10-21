/**
 * Minimal proposal-event index.
 *
 * This is an in-repo read model, not a hosted indexer. Records are keyed by
 * Governor contract id plus proposal id and can live in memory or in a JSON
 * file. Live proposal state and vote totals still come from RPC.
 */

export const PROPOSAL_INDEX_VERSION = 1 as const;

export const INDEXED_EVENT_NAMES = [
  "ProposalCreated",
  "VoteCast",
  "ProposalQueued",
  "ProposalExecuted",
  "ProposalCancelled",
] as const;

export type IndexedEventName = (typeof INDEXED_EVENT_NAMES)[number];

export interface IndexedProposalEvent {
  name: IndexedEventName;
  ledger: number;
  txHash: string | null;
  description?: string;
  proposer?: string | null;
  voteSnapshot?: number | null;
  voteEnd?: number | null;
  /** Hint carried by a lifecycle event. Not a substitute for live RPC state. */
  state?: string;
  voter?: string | null;
  voteType?: number | null;
  /** Decimal string so weights above Number.MAX_SAFE_INTEGER survive JSON. */
  weight?: string | null;
}

export interface IndexedProposalRecord {
  governorContractId: string;
  proposalId: string;
  events: IndexedProposalEvent[];
}

export interface ProposalIndexSnapshot {
  version: typeof PROPOSAL_INDEX_VERSION;
  configuredStartLedger: number | null;
  indexedFromLedger: number | null;
  indexedThroughLedger: number | null;
  /**
   * True when a backfill observed that the configured start ledger was
   * already older than RPC retention. Events before the retained window
   * that were not already stored cannot be reconstructed.
   */
  historyGap: boolean;
  gapNote: string | null;
  records: IndexedProposalRecord[];
}

export interface IndexedIncomingEvent extends IndexedProposalEvent {
  governorContractId: string;
  proposalId: string;
}

export function proposalIndexKey(
  governorContractId: string,
  proposalId: string,
): string {
  return `${governorContractId}:${proposalId.toLowerCase()}`;
}

export function emptyProposalIndex(): ProposalIndexSnapshot {
  return {
    version: PROPOSAL_INDEX_VERSION,
    configuredStartLedger: null,
    indexedFromLedger: null,
    indexedThroughLedger: null,
    historyGap: false,
    gapNote: null,
    records: [],
  };
}
