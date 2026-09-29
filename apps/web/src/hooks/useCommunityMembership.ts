"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@/context/WalletProvider";
import { createReadOnlyNftClient } from "@/lib/contracts";
import {
  membershipFromBalance,
  type CommunityMembershipState,
} from "@/lib/community/membership";

/**
 * Read membership for the connected wallet against a community NFT contract.
 * Disconnected wallets stay on `disconnected` (no factual membership claim).
 * Per-community read failures degrade to `unknown` without throwing.
 */
export function useCommunityMembership(
  nftContractId: string | null | undefined,
): CommunityMembershipState {
  const { address } = useWallet();
  const [state, setState] = useState<CommunityMembershipState>(() =>
    address && nftContractId ? "pending" : "disconnected",
  );

  useEffect(() => {
    if (!address || !nftContractId) {
      // Wallet/contract identity is external; sync membership label off-render.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState("disconnected");
      return;
    }

    let cancelled = false;
    setState("pending");

    void (async () => {
      try {
        const client = createReadOnlyNftClient(nftContractId);
        const tx = await client.balance({ account: address });
        if (cancelled) return;
        const balance = Number(tx.result ?? 0);
        setState(
          Number.isFinite(balance)
            ? membershipFromBalance(balance)
            : "unknown",
        );
      } catch {
        if (!cancelled) setState("unknown");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [address, nftContractId]);

  return state;
}
