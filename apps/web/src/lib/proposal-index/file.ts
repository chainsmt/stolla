import { readFile, writeFile } from "node:fs/promises";
import { MemoryProposalIndex, parseProposalIndexSnapshot } from "./store";

/** Load a JSON snapshot from disk. Used by backfill jobs and tests, not the browser bundle. */
export async function readProposalIndexFile(filePath: string): Promise<MemoryProposalIndex> {
  const raw = await readFile(filePath, "utf8");
  const snapshot = parseProposalIndexSnapshot(JSON.parse(raw) as unknown);
  if (!snapshot) {
    throw new Error(`Proposal index file is not a version 1 snapshot: ${filePath}`);
  }
  return MemoryProposalIndex.fromSnapshot(snapshot);
}

export async function writeProposalIndexFile(
  filePath: string,
  index: MemoryProposalIndex,
): Promise<void> {
  const body = `${JSON.stringify(index.toSnapshot(), null, 2)}\n`;
  await writeFile(filePath, body, "utf8");
}
