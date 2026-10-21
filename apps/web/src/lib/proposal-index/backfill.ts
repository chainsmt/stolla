import type { MemoryProposalIndex } from "./store";
import type { IndexedIncomingEvent } from "./types";

export interface BackfillInput {
  governorContractId: string;
  configuredStartLedger: number;
  oldestRetainedLedger: number;
  latestLedger: number;
  events: readonly IndexedIncomingEvent[];
}

export interface BackfillResult {
  /** Configured start was already older than the RPC retention window. */
  historyAlreadyGone: boolean;
  /** First ledger this run was allowed to read from RPC. */
  scanFromLedger: number;
  indexedThroughLedger: number;
  ingestedEvents: number;
  note: string;
}

const HISTORY_GONE_NOTE =
  "The configured start ledger is already outside RPC retention. This backfill only stores events that are still retained, and it keeps rows indexed earlier. Events older than the retention window that were never stored cannot be reconstructed from RPC.";

const IN_WINDOW_NOTE =
  "Backfill read from the configured start ledger through the latest ledger while that range was still inside RPC retention.";

/**
 * Plan and apply a retention-aware backfill.
 *
 * Callers supply events they already read from RPC. This function refuses
 * to invent events below the oldest retained ledger.
 */
export function backfillProposalIndex(
  index: MemoryProposalIndex,
  input: BackfillInput,
): BackfillResult {
  const { configuredStartLedger, oldestRetainedLedger, latestLedger } = input;
  if (!Number.isSafeInteger(configuredStartLedger) || configuredStartLedger < 1) {
    throw new Error("configuredStartLedger must be a positive integer.");
  }
  if (!Number.isSafeInteger(oldestRetainedLedger) || oldestRetainedLedger < 1) {
    throw new Error("oldestRetainedLedger must be a positive integer.");
  }
  if (!Number.isSafeInteger(latestLedger) || latestLedger < oldestRetainedLedger) {
    throw new Error("latestLedger must be within the retained RPC window.");
  }

  const historyAlreadyGone = configuredStartLedger < oldestRetainedLedger;
  const scanFromLedger = Math.max(configuredStartLedger, oldestRetainedLedger);
  const eligible = input.events.filter(
    (event) =>
      event.governorContractId === input.governorContractId &&
      event.ledger >= scanFromLedger &&
      event.ledger <= latestLedger,
  );
  const ingestedEvents = index.upsertEvents(eligible);
  const note = historyAlreadyGone ? HISTORY_GONE_NOTE : IN_WINDOW_NOTE;
  index.setCoverage({
    configuredStartLedger,
    indexedFromLedger: scanFromLedger,
    indexedThroughLedger: latestLedger,
    historyGap: historyAlreadyGone || index.toSnapshot().historyGap,
    gapNote: historyAlreadyGone ? note : index.toSnapshot().gapNote,
  });

  return {
    historyAlreadyGone,
    scanFromLedger,
    indexedThroughLedger: latestLedger,
    ingestedEvents,
    note,
  };
}
