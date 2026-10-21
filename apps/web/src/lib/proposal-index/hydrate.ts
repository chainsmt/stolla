import type { IndexedProposalRecord, ProposalIndexSnapshot } from "./types";

export interface RpcProposalRef {
  id: string;
  description: string | null;
  voteSnapshot?: number | null;
  voteEnd?: number | null;
}

export interface HydratedProposal extends RpcProposalRef {
  /** `indexer` means the row was missing from the retained RPC scan. */
  source: "rpc" | "indexer";
}

export type PartialHistoryReason =
  | "indexer-unavailable"
  | "indexer-empty"
  | "history-gap";

export interface PartialHistoryState {
  reason: PartialHistoryReason;
  title: string;
  message: string;
  action: string;
}

export type ProposalIndexLoad =
  | { status: "ok"; snapshot: ProposalIndexSnapshot }
  | { status: "empty"; snapshot: ProposalIndexSnapshot }
  | { status: "unavailable"; message: string }
  | { status: "skipped" };

export interface HydrateProposalHistoryInput {
  governorContractId: string;
  retentionClamped: boolean;
  rpcProposals: readonly RpcProposalRef[];
  index: ProposalIndexLoad;
}

export interface HydrateProposalHistoryResult {
  proposals: HydratedProposal[];
  partialHistory: PartialHistoryState | null;
}

const UNAVAILABLE: PartialHistoryState = {
  reason: "indexer-unavailable",
  title: "Older proposal history is unavailable",
  message:
    "RPC retention does not reach the configured start ledger, and the proposal index could not be read. This page is not empty: proposals still inside the retention window stay listed.",
  action:
    "Retry the index. If it stays down, restore the proposal index file from a backfill taken while those ledgers were still retained. Live proposal state and votes continue to load from RPC.",
};

const EMPTY: PartialHistoryState = {
  reason: "indexer-empty",
  title: "No indexed history for this governor",
  message:
    "RPC retention does not reach the configured start ledger, and the proposal index has no saved rows for this governor.",
  action:
    "Backfill from the configured start ledger while it is still inside RPC retention. If that window has already expired, events that were never indexed cannot be reconstructed. Live state and votes still come from RPC.",
};

const GAP: PartialHistoryState = {
  reason: "history-gap",
  title: "Indexed history starts after the configured ledger",
  message:
    "Some older proposals are listed from the index. The configured start ledger was already outside RPC retention when the index was built, so anything never stored before that point is missing.",
  action:
    "Keep the current index file. A new RPC scan cannot fill the gap. Live proposal state and votes still come from RPC.",
};

function createdLedger(record: IndexedProposalRecord): number {
  const created = record.events.find((event) => event.name === "ProposalCreated");
  if (created) return created.ledger;
  return record.events.reduce(
    (min, event) => Math.min(min, event.ledger),
    Number.POSITIVE_INFINITY,
  );
}

function toHydrated(record: IndexedProposalRecord): HydratedProposal {
  const created = record.events.find((event) => event.name === "ProposalCreated");
  return {
    id: record.proposalId.toLowerCase(),
    description: created?.description ?? null,
    voteSnapshot: created?.voteSnapshot ?? null,
    voteEnd: created?.voteEnd ?? null,
    source: "indexer",
  };
}

/**
 * Choose list/detail rows when RPC retention clamps discovery.
 *
 * RPC rows always win for ids that are still visible. The index only fills
 * proposals the retained scan cannot see. Vote totals are intentionally not
 * taken from the index; callers keep using live RPC for current votes.
 */
export function hydrateProposalHistory(
  input: HydrateProposalHistoryInput,
): HydrateProposalHistoryResult {
  const rpcProposals: HydratedProposal[] = input.rpcProposals.map((proposal) => ({
    id: proposal.id.toLowerCase(),
    description: proposal.description,
    voteSnapshot: proposal.voteSnapshot,
    voteEnd: proposal.voteEnd,
    source: "rpc",
  }));

  if (!input.retentionClamped) {
    return { proposals: rpcProposals, partialHistory: null };
  }

  if (input.index.status === "unavailable" || input.index.status === "skipped") {
    return { proposals: rpcProposals, partialHistory: UNAVAILABLE };
  }

  const records = input.index.snapshot.records.filter(
    (record) => record.governorContractId === input.governorContractId,
  );
  if (records.length === 0) {
    return { proposals: rpcProposals, partialHistory: EMPTY };
  }

  const seen = new Set(rpcProposals.map((proposal) => proposal.id));
  const indexed = records
    .map(toHydrated)
    .filter((proposal) => !seen.has(proposal.id))
    .sort((left, right) => {
      const leftLedger = createdLedger(
        records.find((record) => record.proposalId === left.id) ?? records[0],
      );
      const rightLedger = createdLedger(
        records.find((record) => record.proposalId === right.id) ?? records[0],
      );
      return rightLedger - leftLedger;
    });

  return {
    proposals: [...rpcProposals, ...indexed],
    partialHistory: input.index.snapshot.historyGap ? GAP : null,
  };
}
