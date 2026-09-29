export type CommunityMembershipState =
  | "disconnected"
  | "pending"
  | "member"
  | "non_member"
  | "unknown";

/** Map a successful NFT balance read into a membership state. */
export function membershipFromBalance(balance: number): "member" | "non_member" {
  return balance > 0 ? "member" : "non_member";
}

export function membershipLabel(state: CommunityMembershipState): string | null {
  switch (state) {
    case "member":
      return "Member";
    case "non_member":
      return "Not a member";
    case "unknown":
      return "Membership unavailable";
    case "disconnected":
    case "pending":
      return null;
  }
}
