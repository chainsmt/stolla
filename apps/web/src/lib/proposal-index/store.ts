import {
  INDEXED_EVENT_NAMES,
  emptyProposalIndex,
  proposalIndexKey,
  type IndexedEventName,
  type IndexedIncomingEvent,
  type IndexedProposalEvent,
  type IndexedProposalRecord,
  type ProposalIndexSnapshot,
} from "./types";

const EVENT_NAMES = new Set<string>(INDEXED_EVENT_NAMES);

function isHexId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-fA-F]{1,128}$/.test(value);
}

function isLedger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function parseEvent(value: unknown): IndexedProposalEvent | null {
  if (!value || typeof value !== "object") return null;
  const event = value as Partial<IndexedProposalEvent>;
  if (typeof event.name !== "string" || !EVENT_NAMES.has(event.name)) return null;
  if (!isLedger(event.ledger)) return null;
  if (event.txHash !== null && typeof event.txHash !== "string") return null;
  return {
    name: event.name as IndexedEventName,
    ledger: event.ledger,
    txHash: event.txHash ?? null,
    description: typeof event.description === "string" ? event.description : undefined,
    proposer: typeof event.proposer === "string" ? event.proposer : event.proposer ?? undefined,
    voteSnapshot: typeof event.voteSnapshot === "number" ? event.voteSnapshot : event.voteSnapshot ?? undefined,
    voteEnd: typeof event.voteEnd === "number" ? event.voteEnd : event.voteEnd ?? undefined,
    state: typeof event.state === "string" ? event.state : undefined,
    voter: typeof event.voter === "string" ? event.voter : event.voter ?? undefined,
    voteType: typeof event.voteType === "number" ? event.voteType : event.voteType ?? undefined,
    weight: typeof event.weight === "string" ? event.weight : event.weight ?? undefined,
  };
}

function parseRecord(value: unknown): IndexedProposalRecord | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<IndexedProposalRecord>;
  if (typeof record.governorContractId !== "string" || record.governorContractId.length === 0) {
    return null;
  }
  if (!isHexId(record.proposalId) || !Array.isArray(record.events)) return null;
  const events: IndexedProposalEvent[] = [];
  for (const event of record.events) {
    const parsed = parseEvent(event);
    if (!parsed) return null;
    events.push(parsed);
  }
  return {
    governorContractId: record.governorContractId,
    proposalId: record.proposalId.toLowerCase(),
    events,
  };
}

export function parseProposalIndexSnapshot(value: unknown): ProposalIndexSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Partial<ProposalIndexSnapshot>;
  if (body.version !== 1 || !Array.isArray(body.records)) return null;
  const records: IndexedProposalRecord[] = [];
  for (const record of body.records) {
    const parsed = parseRecord(record);
    if (!parsed) return null;
    records.push(parsed);
  }
  return {
    version: 1,
    configuredStartLedger: isLedger(body.configuredStartLedger) ? body.configuredStartLedger : null,
    indexedFromLedger: isLedger(body.indexedFromLedger) ? body.indexedFromLedger : null,
    indexedThroughLedger: isLedger(body.indexedThroughLedger) ? body.indexedThroughLedger : null,
    historyGap: body.historyGap === true,
    gapNote: typeof body.gapNote === "string" ? body.gapNote : null,
    records,
  };
}

function eventDedupeKey(event: IndexedProposalEvent): string {
  return [
    event.name,
    event.ledger,
    event.txHash ?? "",
    event.voter ?? "",
    event.state ?? "",
    event.voteType ?? "",
    event.weight ?? "",
  ].join("|");
}

function cloneSnapshot(snapshot: ProposalIndexSnapshot): ProposalIndexSnapshot {
  return {
    ...snapshot,
    records: snapshot.records.map((record) => ({
      ...record,
      events: record.events.map((event) => ({ ...event })),
    })),
  };
}

/** In-memory index. JSON file IO lives in `file.ts` so browser code can import this. */
export class MemoryProposalIndex {
  private snapshot: ProposalIndexSnapshot;

  constructor(snapshot: ProposalIndexSnapshot = emptyProposalIndex()) {
    this.snapshot = cloneSnapshot(snapshot);
  }

  static fromSnapshot(value: unknown): MemoryProposalIndex {
    const snapshot = parseProposalIndexSnapshot(value);
    if (!snapshot) throw new Error("Invalid proposal index snapshot.");
    return new MemoryProposalIndex(snapshot);
  }

  toSnapshot(): ProposalIndexSnapshot {
    return cloneSnapshot(this.snapshot);
  }

  recordsFor(governorContractId: string): IndexedProposalRecord[] {
    return this.snapshot.records
      .filter((record) => record.governorContractId === governorContractId)
      .map((record) => ({
        ...record,
        events: record.events.map((event) => ({ ...event })),
      }));
  }

  /**
   * Insert events for one governor. Re-reading the same event is a no-op.
   * Returns how many new events were stored.
   */
  upsertEvents(events: readonly IndexedIncomingEvent[]): number {
    let inserted = 0;
    for (const event of events) {
      if (!event.governorContractId || !isHexId(event.proposalId)) continue;
      const proposalId = event.proposalId.toLowerCase();
      const key = proposalIndexKey(event.governorContractId, proposalId);
      let record = this.snapshot.records.find(
        (candidate) => proposalIndexKey(candidate.governorContractId, candidate.proposalId) === key,
      );
      if (!record) {
        record = { governorContractId: event.governorContractId, proposalId, events: [] };
        this.snapshot.records.push(record);
      }
      const stored: IndexedProposalEvent = {
        name: event.name,
        ledger: event.ledger,
        txHash: event.txHash,
        description: event.description,
        proposer: event.proposer,
        voteSnapshot: event.voteSnapshot,
        voteEnd: event.voteEnd,
        state: event.state,
        voter: event.voter,
        voteType: event.voteType,
        weight: event.weight,
      };
      const dedupe = eventDedupeKey(stored);
      if (record.events.some((existing) => eventDedupeKey(existing) === dedupe)) continue;
      record.events.push(stored);
      record.events.sort((left, right) => left.ledger - right.ledger);
      inserted += 1;
    }
    return inserted;
  }

  setCoverage(coverage: {
    configuredStartLedger: number;
    indexedFromLedger: number | null;
    indexedThroughLedger: number | null;
    historyGap: boolean;
    gapNote: string | null;
  }): void {
    this.snapshot.configuredStartLedger = coverage.configuredStartLedger;
    this.snapshot.indexedFromLedger = coverage.indexedFromLedger;
    this.snapshot.indexedThroughLedger = coverage.indexedThroughLedger;
    this.snapshot.historyGap = coverage.historyGap;
    this.snapshot.gapNote = coverage.gapNote;
  }
}
