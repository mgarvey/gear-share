import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(),
    storage: { from: vi.fn() },
    functions: { invoke: vi.fn() },
  },
}));

import * as adapter from "@/lib/gearShareApi";
import type {
  AiGearDraftResult,
  BulkDraftCandidate,
  BulkDraftStageResult,
  BulkDraftStatus,
  CatalogPage,
  CatalogQuery,
  GearImageTarget,
  WantedRequestInput,
} from "@/lib/gearShareApi";

type PublicTypeSurface = [
  AiGearDraftResult,
  BulkDraftCandidate,
  BulkDraftStageResult,
  BulkDraftStatus,
  CatalogPage,
  CatalogQuery,
  GearImageTarget,
  WantedRequestInput,
];

describe("gear share API public surface", () => {
  it("preserves the established runtime exports", () => {
    expect(Object.keys(adapter).sort()).toEqual([
      "allowMembershipReapplication",
      "changeWantedRequestState",
      "checkAiActivation",
      "convertIndividualDonation",
      "createGroupSupply",
      "createIndividualSupply",
      "createOrResumeGroupDraft",
      "createOrResumeIndividualDraft",
      "createWantedRequest",
      "deactivateMember",
      "decideMembership",
      "deleteDeactivatedMember",
      "digestGearImageFile",
      "dismissAllNotifications",
      "dismissNotification",
      "draftGearListingsWithAi",
      "fetchActiveMembers",
      "fetchAdministratorOrientation",
      "fetchAiDraftingAvailability",
      "fetchBulkDraftStatuses",
      "fetchCatalog",
      "fetchCommunitySettings",
      "fetchHandoffCandidates",
      "fetchJoinQuestions",
      "fetchListingPostalCode",
      "fetchLoanContactDetails",
      "fetchLoanReminders",
      "fetchLoans",
      "fetchManageableWantedListings",
      "fetchMemberAdministration",
      "fetchMembership",
      "fetchMyMembershipApplication",
      "fetchMyPostalCode",
      "fetchMyProfileSettings",
      "fetchNotificationDeliveryDiagnostics",
      "fetchPendingMembers",
      "fetchPrivateNotifications",
      "fetchReactivationImpact",
      "fetchSupplies",
      "fetchSupplyDetail",
      "fetchTransactionalEmailPreferences",
      "fetchWantedListingSeed",
      "fetchWantedOffers",
      "fetchWantedRequests",
      "getAvailability",
      "getDeactivationImpact",
      "getLoanAvailabilitySummary",
      "getSignedImageUrl",
      "moderateWantedRequest",
      "offerWantedListing",
      "offerWantedOnce",
      "publishJoinQuestions",
      "publishSupplyDraft",
      "reactivateMember",
      "reassignGroupCustodian",
      "reassignLoanHandoff",
      "removeGearImage",
      "requestLoan",
      "retireSupply",
      "selectWantedOffer",
      "selectWantedOneOffOffer",
      "sendPreapprovedMemberInvitation",
      "setAccessLevel",
      "setAdministratorEmailSuppression",
      "setAdministratorOrientation",
      "setAiDraftingEnabled",
      "setMyPostalCode",
      "setNotificationRead",
      "setSupplyContact",
      "setSupplyGuidelines",
      "setSupplyImageOrder",
      "setSupplyNeedsAttention",
      "stageBulkGearDrafts",
      "submitJoinApplication",
      "transitionLoan",
      "updateCommunityDisplayName",
      "updateMyProfileSettings",
      "updateSupply",
      "updateTransactionalEmailPreferences",
      "updateWantedRequest",
      "uploadGearImage",
      "uploadGearImagesSequential"
]);
  });

  it("preserves the established public type exports", () => {
    const typeSurface: PublicTypeSurface | null = null;
    expect(typeSurface).toBeNull();
  });
});
