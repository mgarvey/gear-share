import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => {
  const client = {
    from: mocked.from,
    rpc(this: unknown, ...args: unknown[]) {
      if (this !== client) throw new Error("Supabase RPC method was detached");
      return mocked.rpc(...args);
    },
  };
  return { supabase: client };
});

import {
  fetchCatalog,
  fetchListingPostalCode,
  fetchSupplies,
  fetchSupplyDetail,
} from "./catalogInventory";
import {
  fetchLoans,
  getLoanAvailabilitySummary,
  requestLoan,
  setSupplyGuidelines,
} from "./loans";
import {
  fetchAdministratorOrientation,
  allowMembershipReapplication,
  fetchCommunitySettings,
  fetchMemberAdministration,
  fetchReactivationImpact,
  reactivateMember,
  setAdministratorOrientation,
  setAiDraftingEnabled,
  updateCommunityDisplayName,
} from "./administrationSettings";
import { fetchMembership } from "./membershipProfile";
import {
  dismissAllNotifications,
  dismissNotification,
  fetchNotificationDeliveryDiagnostics,
  fetchPrivateNotifications,
  fetchTransactionalEmailPreferences,
  setAdministratorEmailSuppression,
  setNotificationRead,
  updateTransactionalEmailPreferences,
} from "./notifications";
import {
  createWantedRequest,
  fetchWantedRequests,
  offerWantedListing,
  offerWantedOnce,
  selectWantedOneOffOffer,
} from "./wanted";

describe("gear share membership adapter", () => {
  beforeEach(() => { mocked.from.mockReset(); mocked.rpc.mockReset(); });

  it("fails visibly when the membership snapshot is unavailable", async () => {
    mocked.rpc.mockResolvedValue({ data: null, error: new Error("membership unavailable") });
    await expect(fetchMembership()).rejects.toThrow("membership unavailable");
  });

  it("loads profile and role authority through one caller-derived request", async () => {
    mocked.rpc.mockResolvedValue({
      data: [{ id: "steward", community_id: "community", display_name: "Steward", membership_status: "active", access_level: "administrator" }],
      error: null,
    });
    await expect(fetchMembership()).resolves.toEqual({
      id: "steward",
      communityId: "community",
      displayName: "Steward",
      status: "active",
      accessLevel: "administrator",
    });
    expect(mocked.rpc).toHaveBeenCalledOnce();
    expect(mocked.rpc).toHaveBeenCalledWith("my_membership_snapshot", {});
    expect(mocked.from).not.toHaveBeenCalled();
  });

  it("returns null when no profile exists for the authenticated caller", async () => {
    mocked.rpc.mockResolvedValue({ data: [], error: null });
    await expect(fetchMembership()).resolves.toBeNull();
  });
});

describe("private notification adapters", () => {
  beforeEach(() => mocked.rpc.mockReset());

  it("maps an exact 30-row keyset request without detached RPC calls", async () => {
    mocked.rpc.mockResolvedValue({ data: [{ id: "notice", event_type: "loan_requested", title: "Requested", body: "Review it.", app_route: "/loans", occurred_at: "2026-08-14T12:00:00Z", read_at: null }], error: null });
    await expect(fetchPrivateNotifications({ occurredAt: "2026-08-14T13:00:00Z", id: "cursor" })).resolves.toMatchObject([{ id: "notice", eventType: "loan_requested", appRoute: "/loans" }]);
    expect(mocked.rpc).toHaveBeenCalledWith("my_private_notifications", { before_occurred_at: "2026-08-14T13:00:00Z", before_notification_id: "cursor", page_limit: 30 });
  });

  it("uses exact self-service mutation contracts", async () => {
    mocked.rpc
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: 4, error: null })
      .mockResolvedValueOnce({ data: null, error: null });
    await setNotificationRead("notice", true);
    await dismissNotification("notice");
    await expect(dismissAllNotifications()).resolves.toBe(4);
    await updateTransactionalEmailPreferences({ loanActivity: false, loanReminders: true, wantedActivity: false });
    expect(mocked.rpc).toHaveBeenNthCalledWith(1, "set_my_notification_read", { target_notification_id: "notice", supplied_read: true });
    expect(mocked.rpc).toHaveBeenNthCalledWith(2, "dismiss_my_notification", { target_notification_id: "notice" });
    expect(mocked.rpc).toHaveBeenNthCalledWith(3, "dismiss_all_my_notifications", {});
    expect(mocked.rpc).toHaveBeenNthCalledWith(4, "update_my_transactional_email_preferences", { supplied_loan_activity: false, supplied_loan_reminders: true, supplied_wanted_activity: false });
  });

  it("maps preferences and bounded administrator diagnostics without email content", async () => {
    mocked.rpc
      .mockResolvedValueOnce({ data: [{ loan_activity: false, loan_reminders: true, wanted_activity: true }], error: null })
      .mockResolvedValueOnce({ data: [{ outbox_id: "outbox", recipient_user_id: "member", recipient_display_name: "Member", event_type: "loan_requested", status: "pending", attempt_count: 0, suppression_reason: null, created_at: "created", updated_at: "updated" }], error: null })
      .mockResolvedValueOnce({ data: null, error: null });
    await expect(fetchTransactionalEmailPreferences()).resolves.toEqual({ loanActivity: false, loanReminders: true, wantedActivity: true });
    await expect(fetchNotificationDeliveryDiagnostics()).resolves.toEqual([{ outboxId: "outbox", recipientUserId: "member", recipientDisplayName: "Member", eventType: "loan_requested", status: "pending", attemptCount: 0, suppressionReason: null, createdAt: "created", updatedAt: "updated" }]);
    await setAdministratorEmailSuppression("member", true);
    expect(mocked.rpc).toHaveBeenLastCalledWith("set_administrator_email_suppression", { target_user_id: "member", supplied_suppressed: true });
  });
});

describe("Milestone 6 administration adapters", () => {
  beforeEach(() => mocked.rpc.mockReset());

  it("uses only exact settings and bounded member RPCs", async () => {
    mocked.rpc
      .mockResolvedValueOnce({ data: [{ community_id: "community", display_name: "Trail Group", configuration_version: 4, ai_drafting_enabled: false }], error: null })
      .mockResolvedValueOnce({ data: [{ id: "member", display_name: "Member", account_email: "member@example.test", membership_status: "deactivated", access_level: "regular" }], error: null })
      .mockResolvedValueOnce({ data: [{ community_id: "community", display_name: "Renamed Group", configuration_version: 5, ai_drafting_enabled: false }], error: null })
      .mockResolvedValueOnce({ data: [{ configuration_version: 5, ai_drafting_enabled: false, already_reserved_requests: 0, status_reason: "AI drafting remains disabled." }], error: null });
    await expect(fetchCommunitySettings()).resolves.toMatchObject({ displayName: "Trail Group", configurationVersion: 4, aiDraftingEnabled: false });
    await expect(fetchMemberAdministration()).resolves.toEqual([{ id: "member", display_name: "Member", account_email: "member@example.test", membership_status: "deactivated", accessLevel: "regular" }]);
    await expect(updateCommunityDisplayName("Renamed Group", 4)).resolves.toMatchObject({ communityId: "community", displayName: "Renamed Group", configurationVersion: 5 });
    await expect(setAiDraftingEnabled(true, 5)).resolves.toMatchObject({ aiDraftingEnabled: false, alreadyReservedRequests: 0 });
    expect(mocked.rpc.mock.calls).toEqual([
      ["get_my_community_settings", {}],
      ["private_member_administration", {}],
      ["update_community_display_name", { supplied_name: "Renamed Group", expected_version: 4 }],
      ["set_ai_drafting_enabled", { supplied_enabled: true, expected_version: 5 }],
    ]);
  });

  it("maps versioned reactivation and self-scoped orientation contracts", async () => {
    mocked.rpc
      .mockResolvedValueOnce({ data: [{ target_id: "member", display_name: "Member", membership_status: "deactivated", prior_access_level: "custodian", cancelled_loans: 2, individual_owned_listings: 1, stored_with_listings: 0, notification_consequence: "Regular only", preview_version: "a".repeat(64) }], error: null })
      .mockResolvedValueOnce({ data: "audit", error: null })
      .mockResolvedValueOnce({ data: [{ registry_version: 1, item_id: "review_privacy", label: "Review privacy", help_text: null, route_id: "privacy", display_order: 1, required: true, applicable_role: "administrator", status: null, changed_at: null }], error: null })
      .mockResolvedValueOnce({ data: null, error: null });
    await expect(fetchReactivationImpact("member")).resolves.toMatchObject({ priorAccessLevel: "custodian", cancelledLoans: 2, previewVersion: "a".repeat(64) });
    await expect(reactivateMember("member", "a".repeat(64), "Reviewed")).resolves.toBe("audit");
    await expect(fetchAdministratorOrientation()).resolves.toMatchObject([{ itemId: "review_privacy", routeId: "privacy", required: true, applicableRole: "administrator" }]);
    await setAdministratorOrientation(1, "review_privacy", "completed");
    expect(mocked.rpc.mock.calls).toEqual([
      ["reactivation_impact", { target_user_id: "member" }],
      ["reactivate_member", { target_user_id: "member", supplied_preview_version: "a".repeat(64), supplied_reason: "Reviewed" }],
      ["get_my_administrator_orientation", {}],
      ["set_my_administrator_orientation", { supplied_registry_version: 1, supplied_item_id: "review_privacy", supplied_status: "completed" }],
    ]);
  });

  it("uses the exact rejected-applicant recovery contract", async () => {
    mocked.rpc.mockResolvedValue({ data: null, error: null });
    await allowMembershipReapplication("rejected-member");
    expect(mocked.rpc).toHaveBeenCalledWith("allow_membership_reapplication", { target_user_id: "rejected-member" });
  });
});

describe("private catalog adapter", () => {
  beforeEach(() => mocked.rpc.mockReset());

  it("keeps the Supabase client context when invoking recovery RPCs", async () => {
    mocked.rpc.mockResolvedValue({ data: [], error: null });

    await fetchCatalog({ search: "", category: "all", ownership: "all", condition: "all", postal: "all", startDate: "", endDate: "", availableOnly: false, page: 1 });
  });

  it("passes only the bounded filter registry and maps protected result context", async () => {
    mocked.rpc.mockResolvedValue({
      data: [{
        id: "book", community_id: "community", title: "Field guide", description: "Trees",
        category: "books-guides", condition: "good", ownership_kind: "group", owner_id: null,
        owner_is_active: false, custodian_id: "contact", custodian_name: "Alex",
        custodian_postal_code: "78664", quantity_total: 1, listing_status: "listed",
        image_paths: [], available_quantity: 0, total_count: 25, resolved_page: 2,
      }],
      error: null,
    });

    await expect(fetchCatalog({ search: "guide", category: "books-guides", ownership: "group", condition: "good", postal: "78664", startDate: "2099-08-01", endDate: "2099-08-04", availableOnly: true, page: 2 })).resolves.toMatchObject({
      total: 25,
      page: 2,
      totalPages: 2,
      items: [{ id: "book", category: "books-guides", condition: "good", custodianPostalCode: "78664", availableQuantity: 0 }],
    });
    expect(mocked.rpc).toHaveBeenCalledWith("private_gear_catalog", {
      supplied_search: "guide",
      supplied_category: "books-guides",
      supplied_ownership: "group",
      supplied_condition: "good",
      supplied_postal: "78664",
      supplied_page: 2,
      supplied_start: "2099-08-01",
      supplied_end: "2099-08-04",
      supplied_available_only: true,
    });
  });

  it("requests postal context for one exact listing instead of a bulk ZIP endpoint", async () => {
    mocked.rpc.mockResolvedValue({ data: "78664", error: null });

    await expect(fetchListingPostalCode("book")).resolves.toBe("78664");
    expect(mocked.rpc).toHaveBeenCalledWith("private_listing_postal_code", { target_supply_id: "book" });
  });
});

describe("contextual private workflow adapters", () => {
  beforeEach(() => mocked.rpc.mockReset());

  it("loads list and canonical detail names only through exact server-derived supply RPCs", async () => {
    const row = {
      id: "tent", community_id: "community", title: "Trail tent", description: "Dry",
      category: "tents-shelters", condition: "good", ownership_kind: "individual",
      owner_id: "owner", owner_is_active: true, custodian_id: "contact",
      custodian_name: "Stored With Member", quantity_total: 1, listing_status: "listed",
      image_paths: [], publication_attempt_id: null, publication_expected_images: 0,
    };
    mocked.rpc
      .mockResolvedValueOnce({ data: [row], error: null })
      .mockResolvedValueOnce({ data: [{ supply_id: "tent", needs_attention: false, reason: null, version: 0 }], error: null })
      .mockResolvedValueOnce({ data: [{ supply_id: "tent", guideline_version: 1, rules: ["Return dry"] }], error: null })
      .mockResolvedValueOnce({ data: [row], error: null })
      .mockResolvedValueOnce({ data: [{ supply_id: "tent", needs_attention: false, reason: null, version: 0 }], error: null })
      .mockResolvedValueOnce({ data: [{ supply_id: "tent", guideline_version: 1, rules: ["Return dry"] }], error: null });

    await expect(fetchSupplies()).resolves.toMatchObject([{ id: "tent", custodianName: "Stored With Member" }]);
    await expect(fetchSupplyDetail("tent")).resolves.toMatchObject({ id: "tent", custodianName: "Stored With Member" });
    expect(mocked.rpc).toHaveBeenNthCalledWith(1, "private_supplies", {});
    expect(mocked.rpc).toHaveBeenNthCalledWith(2, "private_supply_attention_flags", { target_ids: ["tent"] });
    expect(mocked.rpc).toHaveBeenNthCalledWith(3, "private_supply_guidelines_batch", { target_ids: ["tent"] });
    expect(mocked.rpc).toHaveBeenNthCalledWith(4, "private_supply_detail", { target_supply_id: "tent" });
    expect(mocked.rpc).toHaveBeenNthCalledWith(5, "private_supply_attention_flags", { target_ids: ["tent"] });
    expect(mocked.rpc).toHaveBeenNthCalledWith(6, "private_supply_guidelines_batch", { target_ids: ["tent"] });
  });

  it("loads participant names only through the exact private loan workspace", async () => {
    mocked.rpc
      .mockResolvedValueOnce({ data: [{
      id: "loan", supply_id: "tent", supply_title: "Trail tent", ownership_kind: "individual",
      owner_id: "owner", owner_is_active: true, current_custodian_id: "contact",
      current_custodian_name: "Owner", borrower_id: "borrower", borrower_name: "Borrower",
      custodian_at_request_id: "contact", quantity: 1, start_date: "2027-01-01",
      end_date: "2027-01-02", status: "pending", borrower_note: null,
      }], error: null })
      .mockResolvedValueOnce({ data: [{ loan_id: "loan" }], error: null })
      .mockResolvedValueOnce({ data: [{ loan_id: "loan", guideline_version: 2, rules: ["Return dry"], accepted_at: "accepted" }], error: null });

    await expect(fetchLoans()).resolves.toMatchObject([{ id: "loan", borrowerName: "Borrower", currentCustodianName: "Owner", acceptedGuidelines: ["Return dry"] }]);
    expect(mocked.rpc).toHaveBeenCalledWith("private_gear_loans", {});
  });

  it("chunks loan-operation enrichment without relaxing the 500-ID server bound", async () => {
    const loans = Array.from({ length: 501 }, (_, index) => ({
      id: `loan-${index}`, supply_id: "tent", supply_title: "Trail tent",
      ownership_kind: "individual", owner_id: "owner", owner_is_active: true,
      current_custodian_id: "owner", current_custodian_name: "Owner",
      borrower_id: "borrower", borrower_name: "Borrower",
      custodian_at_request_id: "owner", quantity: 1, start_date: "2027-01-01",
      end_date: "2027-01-02", status: "pending", borrower_note: null,
    }));
    mocked.rpc
      .mockResolvedValueOnce({ data: loans, error: null })
      .mockResolvedValueOnce({
        data: loans.slice(0, 500).map(({ id }) => ({ loan_id: id })),
        error: null,
      })
      .mockResolvedValueOnce({ data: [{ loan_id: "loan-500" }], error: null });

    for (let index = 0; index < 6; index += 1) mocked.rpc.mockResolvedValueOnce({ data: [], error: null });

    await expect(fetchLoans()).resolves.toHaveLength(501);
    const operationCalls = mocked.rpc.mock.calls.filter(
      ([name]) => name === "private_loan_operations",
    );
    expect(operationCalls.map(([, args]) => args.target_ids.length)).toEqual([500, 1]);
  });

  it("chunks inventory attention enrichment without relaxing the 500-ID server bound", async () => {
    const supplies = Array.from({ length: 501 }, (_, index) => ({
      id: `supply-${index}`, community_id: "community", title: "Trail tent",
      description: "Dry", category: "tents-shelters", condition: "good",
      ownership_kind: "group", owner_id: null, owner_is_active: false,
      custodian_id: "contact", custodian_name: "Stored With Member",
      quantity_total: 1, listing_status: "listed", image_paths: [],
      publication_attempt_id: null, publication_expected_images: 0,
    }));
    mocked.rpc
      .mockResolvedValueOnce({ data: supplies, error: null })
      .mockResolvedValueOnce({
        data: supplies.slice(0, 500).map(({ id }) => ({
          supply_id: id, needs_attention: false, reason: null, version: 0,
        })),
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{ supply_id: "supply-500", needs_attention: false, reason: null, version: 0 }],
        error: null,
      })
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: [], error: null });

    await expect(fetchSupplies()).resolves.toHaveLength(501);
    const attentionCalls = mocked.rpc.mock.calls.filter(
      ([name]) => name === "private_supply_attention_flags",
    );
    expect(attentionCalls.map(([, args]) => args.target_ids.length)).toEqual([500, 1]);
  });
});

describe("Milestone 7 private workflow adapters", () => {
  beforeEach(() => mocked.rpc.mockReset());

  it("sends only the current guideline version and explicit acceptance", async () => {
    mocked.rpc.mockResolvedValue({ data: null, error: null });
    await requestLoan({ supplyId: "tent", quantity: 1, startDate: "2028-01-01", endDate: "2028-01-02", note: "Trip", guidelineVersion: 3, guidelinesAccepted: true });
    await setSupplyGuidelines("tent", 3, ["Return dry"]);
    expect(mocked.rpc).toHaveBeenNthCalledWith(1, "request_gear_loan", {
      target_supply_id: "tent", requested_quantity: 1, requested_start: "2028-01-01", requested_end: "2028-01-02", supplied_note: "Trip", supplied_guideline_version: 3, supplied_guidelines_accepted: true,
    });
    expect(mocked.rpc).toHaveBeenNthCalledWith(2, "set_supply_guidelines", { target_supply_id: "tent", supplied_expected_version: 3, supplied_rules: ["Return dry"] });
  });

  it("maps only aggregate pending demand from the bounded availability RPC", async () => {
    mocked.rpc.mockResolvedValue({
      data: [{ available_quantity: 4, pending_quantity: 2, pending_request_count: 1 }],
      error: null,
    });

    await expect(getLoanAvailabilitySummary("tent", "2028-01-01", "2028-01-02")).resolves.toEqual({
      availableQuantity: 4,
      pendingQuantity: 2,
      pendingRequestCount: 1,
    });
    expect(mocked.rpc).toHaveBeenCalledWith("loan_availability_summary", {
      target_supply_id: "tent",
      range_start: "2028-01-01",
      range_end: "2028-01-02",
    });
  });

  it("uses stable wanted pagination and exact mutation arguments", async () => {
    mocked.rpc
      .mockResolvedValueOnce({ data: [{ id: "request", requester_id: "member", requester_name: "Member", title: "Tent", category: "tents-shelters", desired_quantity: 1, desired_start: null, desired_end: null, note: null, status: "open", closure_kind: null, selected_offer_id: null, transition_version: 1, created_at: "created", updated_at: "updated" }], error: null })
      .mockResolvedValueOnce({ data: { id: "request", requester_id: "member", requester_name: "Member", title: "Tent", category: null, desired_quantity: 1, desired_start: null, desired_end: null, note: null, status: "open", closure_kind: null, selected_offer_id: null, transition_version: 1, created_at: "created", updated_at: "updated" }, error: null })
      .mockResolvedValue({ data: null, error: null });
    await fetchWantedRequests("open", { createdAt: "cursor-time", id: "cursor-id" });
    await createWantedRequest({ title: "Tent", category: null, quantity: 1, startDate: null, endDate: null, note: "" });
    await offerWantedListing("request", "supply", "Fits");
    await offerWantedOnce("request", 2, "One time");
    await selectWantedOneOffOffer({ requestId: "request", offerId: "offer", expectedVersion: 4, quantity: 1, startDate: "2028-01-01", endDate: "2028-01-02" });
    expect(mocked.rpc.mock.calls).toEqual([
      ["private_wanted_requests", { supplied_view: "open", supplied_before_created_at: "cursor-time", supplied_before_id: "cursor-id" }],
      ["create_wanted_request", { supplied_title: "Tent", supplied_category: null, supplied_quantity: 1, supplied_start: null, supplied_end: null, supplied_note: null }],
      ["offer_wanted_listing", { target_request_id: "request", target_supply_id: "supply", supplied_note: "Fits" }],
      ["offer_wanted_once", { target_request_id: "request", supplied_quantity: 2, supplied_note: "One time" }],
      ["select_wanted_one_off_offer", { target_request_id: "request", target_offer_id: "offer", supplied_expected_version: 4, supplied_quantity: 1, supplied_start: "2028-01-01", supplied_end: "2028-01-02" }],
    ]);
  });
});
