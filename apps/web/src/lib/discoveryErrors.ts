import type { DiscoveryErrorKind } from "@/hooks/useProposalDiscovery";

/**
 * Turn a discovery failure into the sentence shown on the proposals page.
 * Keeps a concrete RPC or configuration message when one was already mapped.
 */
export function describeDiscoveryError(
  error: string | null,
  kind: DiscoveryErrorKind | null,
): string {
  const message = error?.trim() ?? "";
  if (message) return message;
  if (kind === "config") {
    return "Proposal discovery is not configured. Set NEXT_PUBLIC_GOVERNOR_START_LEDGER and reload.";
  }
  if (kind === "retention") {
    return "Proposal history could not be scanned because the start ledger is outside the RPC retention window. Check NEXT_PUBLIC_GOVERNOR_START_LEDGER, or use the proposal index for older history.";
  }
  return "Proposal history could not be loaded. Retry discovery.";
}
