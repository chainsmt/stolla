import { describe, expect, it } from "vitest";
import {
  communityWizardStorageKey,
  emptyCommunityWizardDraft,
  isCommunityWizardDirty,
  parseCommunityWizardDraft,
} from "./wizard";

describe("community wizard session draft", () => {
  it("scopes versioned storage to the configured network", () => {
    expect(communityWizardStorageKey("testnet")).toBe(
      "stolla:community-wizard:testnet:v2",
    );
    expect(communityWizardStorageKey("mainnet")).toBe(
      "stolla:community-wizard:mainnet:v2",
    );
  });

  it("restores only matching, structurally valid drafts", () => {
    const draft = emptyCommunityWizardDraft("testnet");
    draft.step = 2;
    draft.metadata.name = "Builders Guild";

    expect(
      parseCommunityWizardDraft(JSON.stringify(draft), "testnet"),
    ).toEqual(draft);
    expect(
      parseCommunityWizardDraft(JSON.stringify(draft), "mainnet"),
    ).toBeNull();
    expect(parseCommunityWizardDraft("{bad json", "testnet")).toBeNull();
    expect(
      parseCommunityWizardDraft(
        JSON.stringify({ ...draft, version: 99 }),
        "testnet",
      ),
    ).toBeNull();
  });

  it("discards version-1 drafts that still carried user-typed URI fields", () => {
    const legacy = {
      version: 1,
      network: "testnet",
      step: 1,
      metadata: {
        name: "Legacy",
        symbol: "OLD",
        description: "Typed URIs",
        collectionUri: "ipfs://bafy/collection.json",
        metadataUri: "https://legacy.example/community.json",
        logo: "",
        externalLinkLabel: "",
        externalLinkUrl: "",
      },
      governance: { proposalThreshold: "1", quorum: "1", votingDelay: "1", votingPeriod: "10" },
    };
    expect(parseCommunityWizardDraft(JSON.stringify(legacy), "testnet")).toBeNull();
  });

  it("marks only changed persisted fields as dirty", () => {
    const draft = emptyCommunityWizardDraft("testnet");
    expect(isCommunityWizardDirty(draft)).toBe(false);
    draft.governance.quorum = "2";
    expect(isCommunityWizardDirty(draft)).toBe(true);
  });
});
