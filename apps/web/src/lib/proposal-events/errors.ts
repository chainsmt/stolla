import {
  mapProposalDiscoveryError,
  type ProposalDiscoveryError,
  type ProposalDiscoveryErrorKind,
} from "./types";

export type ProposalDiscoveryErrorCode = ProposalDiscoveryErrorKind;

export type { ProposalDiscoveryError, ProposalDiscoveryErrorKind };

export { mapProposalDiscoveryError };

export interface ProposalDiscoveryErrorMapping {
  kind: ProposalDiscoveryErrorKind;
  message: string;
}

export function classifyProposalDiscoveryError(
  error: unknown,
): ProposalDiscoveryErrorKind {
  return mapProposalDiscoveryError(error).kind;
}

export function describeProposalDiscoveryError(
  error: unknown,
): ProposalDiscoveryErrorMapping {
  const mapped = mapProposalDiscoveryError(error);
  return { kind: mapped.kind, message: mapped.message };
}
