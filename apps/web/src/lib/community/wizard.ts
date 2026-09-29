import {
  DEFAULT_GOVERNANCE_DRAFT,
  type CommunityMetadataDraft,
  type GovernanceDraft,
} from "./schema";

/**
 * Version 2 dropped the user-typed collection, metadata, and logo URI fields.
 * Version-1 drafts are discarded on load because their URIs are no longer
 * part of the authoring model.
 */
export const COMMUNITY_WIZARD_DRAFT_VERSION = 2 as const;
export type CommunityWizardStep = 1 | 2 | 3;

export type CommunityWizardDraft = {
  version: typeof COMMUNITY_WIZARD_DRAFT_VERSION;
  network: "testnet" | "mainnet";
  step: CommunityWizardStep;
  metadata: CommunityMetadataDraft;
  governance: GovernanceDraft;
};

export const EMPTY_METADATA_DRAFT: CommunityMetadataDraft = {
  name: "",
  symbol: "",
  description: "",
  externalLinkLabel: "",
  externalLinkUrl: "",
};

const METADATA_FIELDS: (keyof CommunityMetadataDraft)[] = [
  "name",
  "symbol",
  "description",
  "externalLinkLabel",
  "externalLinkUrl",
];

const GOVERNANCE_FIELDS: (keyof GovernanceDraft)[] = [
  "proposalThreshold",
  "quorum",
  "votingDelay",
  "votingPeriod",
];

export function communityWizardStorageKey(network: "testnet" | "mainnet") {
  return `stolla:community-wizard:${network}:v${COMMUNITY_WIZARD_DRAFT_VERSION}`;
}

export function emptyCommunityWizardDraft(
  network: "testnet" | "mainnet",
): CommunityWizardDraft {
  return {
    version: COMMUNITY_WIZARD_DRAFT_VERSION,
    network,
    step: 1,
    metadata: { ...EMPTY_METADATA_DRAFT },
    governance: { ...DEFAULT_GOVERNANCE_DRAFT },
  };
}

function hasStringFields<T extends object>(
  value: unknown,
  fields: readonly (keyof T)[],
): value is T {
  return (
    typeof value === "object" &&
    value !== null &&
    fields.every(
      (field) =>
        typeof (value as Record<PropertyKey, unknown>)[field] === "string",
    )
  );
}

export function parseCommunityWizardDraft(
  raw: string | null,
  network: "testnet" | "mainnet",
): CommunityWizardDraft | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (
      typeof value !== "object" ||
      value === null ||
      (value as Partial<CommunityWizardDraft>).version !==
        COMMUNITY_WIZARD_DRAFT_VERSION ||
      (value as Partial<CommunityWizardDraft>).network !== network
    ) {
      return null;
    }
    const draft = value as Partial<CommunityWizardDraft>;
    if (
      (draft.step !== 1 && draft.step !== 2 && draft.step !== 3) ||
      !hasStringFields<CommunityMetadataDraft>(
        draft.metadata,
        METADATA_FIELDS,
      ) ||
      !hasStringFields<GovernanceDraft>(draft.governance, GOVERNANCE_FIELDS)
    ) {
      return null;
    }
    return draft as CommunityWizardDraft;
  } catch {
    return null;
  }
}

export function isCommunityWizardDirty(draft: CommunityWizardDraft): boolean {
  const empty = emptyCommunityWizardDraft(draft.network);
  return (
    METADATA_FIELDS.some(
      (field) => draft.metadata[field] !== empty.metadata[field],
    ) ||
    GOVERNANCE_FIELDS.some(
      (field) => draft.governance[field] !== empty.governance[field],
    )
  );
}
