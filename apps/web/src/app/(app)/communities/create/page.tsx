"use client";

import { CommunityCreationWizard } from "@/components/community/CommunityCreationWizard";

/**
 * Canonical community creation route. The wizard component is the single
 * implementation; this page only mounts it.
 */
export default function CreateCommunityPage() {
  return <CommunityCreationWizard />;
}
