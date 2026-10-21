import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { backfillProposalIndex } from "./backfill";
import { readProposalIndexFile, writeProposalIndexFile } from "./file";
import { hydrateProposalHistory } from "./hydrate";
import { MemoryProposalIndex } from "./store";
import type { IndexedIncomingEvent } from "./types";

const GOVERNOR = "CGOVERNOR";
const OLD_ID = "ab".repeat(32);
const NEW_ID = "cd".repeat(32);

function created(proposalId: string, ledger: number, description: string): IndexedIncomingEvent {
  return {
    name: "ProposalCreated",
    governorContractId: GOVERNOR,
    proposalId,
    ledger,
    txHash: `tx-${ledger}`,
    description,
    proposer: "GPROPOSER",
    voteSnapshot: ledger + 10,
    voteEnd: ledger + 100,
  };
}

describe("backfillProposalIndex", () => {
  it("stores created, vote, and state events while the start ledger is inside retention", () => {
    const index = new MemoryProposalIndex();
    const events: IndexedIncomingEvent[] = [
      created(OLD_ID, 120, "Inside window"),
      {
        name: "VoteCast",
        governorContractId: GOVERNOR,
        proposalId: OLD_ID,
        ledger: 130,
        txHash: "tx-vote",
        voter: "GVOTER",
        voteType: 1,
        weight: "5",
      },
      {
        name: "ProposalExecuted",
        governorContractId: GOVERNOR,
        proposalId: OLD_ID,
        ledger: 180,
        txHash: "tx-exec",
        state: "Executed",
      },
    ];

    const result = backfillProposalIndex(index, {
      governorContractId: GOVERNOR,
      configuredStartLedger: 100,
      oldestRetainedLedger: 100,
      latestLedger: 200,
      events,
    });

    expect(result.historyAlreadyGone).toBe(false);
    expect(result.scanFromLedger).toBe(100);
    expect(result.ingestedEvents).toBe(3);
    const [record] = index.recordsFor(GOVERNOR);
    expect(record.events.map((event) => event.name)).toEqual([
      "ProposalCreated",
      "VoteCast",
      "ProposalExecuted",
    ]);
    expect(backfillProposalIndex(index, {
      governorContractId: GOVERNOR,
      configuredStartLedger: 100,
      oldestRetainedLedger: 100,
      latestLedger: 200,
      events,
    }).ingestedEvents).toBe(0);
  });

  it("does not invent events that retention has already dropped", () => {
    const index = new MemoryProposalIndex();
    index.upsertEvents([created(OLD_ID, 20, "Stored earlier")]);

    const result = backfillProposalIndex(index, {
      governorContractId: GOVERNOR,
      configuredStartLedger: 1,
      oldestRetainedLedger: 100,
      latestLedger: 200,
      events: [
        { ...created(OLD_ID, 20, "Should be ignored"), txHash: "outside-retention" },
        created(NEW_ID, 150, "Still retained"),
      ],
    });

    expect(result.historyAlreadyGone).toBe(true);
    expect(result.scanFromLedger).toBe(100);
    expect(result.note).toMatch(/cannot be reconstructed/);
    const records = index.recordsFor(GOVERNOR);
    expect(records).toHaveLength(2);
    expect(records.find((record) => record.proposalId === OLD_ID)?.events).toHaveLength(1);
    expect(records.find((record) => record.proposalId === OLD_ID)?.events[0]?.ledger).toBe(20);
    expect(index.toSnapshot().historyGap).toBe(true);
  });
});

describe("hydrateProposalHistory", () => {
  const rpcProposal = {
    id: NEW_ID,
    description: "Still on RPC",
    voteSnapshot: 160,
    voteEnd: 250,
  };

  function indexWithOldProposal(historyGap = false) {
    const index = new MemoryProposalIndex();
    index.upsertEvents([created(OLD_ID, 20, "Older than retention")]);
    index.setCoverage({
      configuredStartLedger: 1,
      indexedFromLedger: 100,
      indexedThroughLedger: 200,
      historyGap,
      gapNote: historyGap ? "gap" : null,
    });
    return index.toSnapshot();
  }

  it("falls back to the indexer when RPC retention clamps the scan", () => {
    const result = hydrateProposalHistory({
      governorContractId: GOVERNOR,
      retentionClamped: true,
      rpcProposals: [rpcProposal],
      index: { status: "ok", snapshot: indexWithOldProposal() },
    });

    expect(result.partialHistory).toBeNull();
    expect(result.proposals).toEqual([
      { ...rpcProposal, id: NEW_ID, source: "rpc" },
      {
        id: OLD_ID,
        description: "Older than retention",
        voteSnapshot: 30,
        voteEnd: 120,
        source: "indexer",
      },
    ]);
  });

  it("keeps live RPC rows and explains an empty index", () => {
    const result = hydrateProposalHistory({
      governorContractId: GOVERNOR,
      retentionClamped: true,
      rpcProposals: [rpcProposal],
      index: {
        status: "empty",
        snapshot: new MemoryProposalIndex().toSnapshot(),
      },
    });

    expect(result.proposals).toEqual([{ ...rpcProposal, source: "rpc" }]);
    expect(result.partialHistory?.reason).toBe("indexer-empty");
    expect(result.partialHistory?.action).toMatch(/Backfill/);
    expect(result.partialHistory?.message).toMatch(/stay|still inside|no saved rows/i);
  });

  it("keeps live RPC rows when the indexer cannot be read", () => {
    const result = hydrateProposalHistory({
      governorContractId: GOVERNOR,
      retentionClamped: true,
      rpcProposals: [rpcProposal],
      index: { status: "unavailable", message: "down" },
    });

    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]?.source).toBe("rpc");
    expect(result.partialHistory?.reason).toBe("indexer-unavailable");
    expect(result.partialHistory?.title).toMatch(/unavailable/i);
    expect(result.partialHistory?.action).toMatch(/Retry/);
  });

  it("ignores the indexer while the configured start is still inside retention", () => {
    const result = hydrateProposalHistory({
      governorContractId: GOVERNOR,
      retentionClamped: false,
      rpcProposals: [rpcProposal],
      index: { status: "ok", snapshot: indexWithOldProposal() },
    });

    expect(result.partialHistory).toBeNull();
    expect(result.proposals.map((proposal) => proposal.id)).toEqual([NEW_ID]);
  });
});

describe("proposal index file", () => {
  let directory: string | null = null;

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = null;
  });

  it("round-trips a snapshot through JSON", async () => {
    directory = await mkdtemp(path.join(tmpdir(), "proposal-index-"));
    const filePath = path.join(directory, "proposal-index.json");
    const index = new MemoryProposalIndex();
    index.upsertEvents([created(OLD_ID, 40, "Persisted")]);
    await writeProposalIndexFile(filePath, index);

    const loaded = await readProposalIndexFile(filePath);
    expect(loaded.recordsFor(GOVERNOR)[0]?.events[0]?.description).toBe("Persisted");
  });
});
