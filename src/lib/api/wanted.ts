import type {
  GearCategory,
  ManageableWantedListing,
  WantedOffer,
  WantedRequest,
  WantedRequestStatus,
  WantedRequestView,
} from "@/types/gear";
import { recoveryRpc } from "./client";

export interface WantedRequestInput {
  title: string;
  category: GearCategory | null;
  quantity: number;
  startDate: string | null;
  endDate: string | null;
  note: string;
}
function mapWantedRequest(row: any): WantedRequest {
  return {
    id: row.id,
    requesterId: row.requester_id,
    requesterName: row.requester_name,
    title: row.title,
    category: row.category,
    desiredQuantity: Number(row.desired_quantity),
    desiredStart: row.desired_start,
    desiredEnd: row.desired_end,
    note: row.note,
    status: row.status,
    closureKind: row.closure_kind,
    selectedOfferId: row.selected_offer_id,
    transitionVersion: Number(row.transition_version),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function fetchWantedRequests(
  view: WantedRequestView,
  cursor?: { createdAt: string; id: string },
): Promise<WantedRequest[]> {
  const { data, error } = await recoveryRpc("private_wanted_requests", {
    supplied_view: view,
    supplied_before_created_at: cursor?.createdAt ?? null,
    supplied_before_id: cursor?.id ?? null,
  });
  if (error) throw error;
  return (data ?? []).map(mapWantedRequest);
}

export async function createWantedRequest(input: WantedRequestInput) {
  const { data, error } = await recoveryRpc("create_wanted_request", {
    supplied_title: input.title,
    supplied_category: input.category,
    supplied_quantity: input.quantity,
    supplied_start: input.startDate,
    supplied_end: input.endDate,
    supplied_note: input.note || null,
  });
  if (error) throw error;
  return mapWantedRequest(data);
}

export async function updateWantedRequest(
  requestId: string,
  expectedVersion: number,
  input: WantedRequestInput,
) {
  const { data, error } = await recoveryRpc("update_wanted_request", {
    target_request_id: requestId,
    supplied_expected_version: expectedVersion,
    supplied_title: input.title,
    supplied_category: input.category,
    supplied_quantity: input.quantity,
    supplied_start: input.startDate,
    supplied_end: input.endDate,
    supplied_note: input.note || null,
  });
  if (error) throw error;
  return mapWantedRequest(data);
}

export async function changeWantedRequestState(
  action: "close" | "reopen",
  requestId: string,
  expectedVersion: number,
) {
  const { error } = await recoveryRpc(`${action}_wanted_request`, {
    target_request_id: requestId,
    supplied_expected_version: expectedVersion,
  });
  if (error) throw error;
}

export async function fetchWantedOffers(requestId: string): Promise<WantedOffer[]> {
  const { data, error } = await recoveryRpc("private_wanted_offers", {
    target_request_id: requestId,
  });
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    id: row.id,
    requestId: row.request_id,
    supplyId: row.supply_id,
    supplyTitle: row.supply_title,
    offererId: row.offerer_id,
    offererName: row.offerer_name,
    note: row.note,
    status: row.status,
    transitionVersion: Number(row.transition_version),
    createdAt: row.created_at,
    offerKind: row.offer_kind ?? "listing",
    offeredQuantity: row.offered_quantity == null ? null : Number(row.offered_quantity),
  }));
}

export async function fetchManageableWantedListings(): Promise<ManageableWantedListing[]> {
  const { data, error } = await recoveryRpc("private_manageable_listings_for_wanted", {});
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    id: row.id,
    title: row.title,
    ownershipKind: row.ownership_kind,
  }));
}

export async function fetchWantedListingSeed(requestId: string) {
  const { data, error } = await recoveryRpc("wanted_request_listing_seed", {
    target_request_id: requestId,
  });
  if (error) throw error;
  const row = data?.[0];
  if (!row) throw new Error("Wanted request context is unavailable.");
  return {
    title: row.title as string,
    description: row.description as string,
    category: (row.category ?? "") as string,
    quantity: Number(row.quantity),
  };
}

export async function offerWantedListing(requestId: string, supplyId: string, note: string) {
  const { error } = await recoveryRpc("offer_wanted_listing", {
    target_request_id: requestId,
    target_supply_id: supplyId,
    supplied_note: note || null,
  });
  if (error) throw error;
}

export async function offerWantedOnce(requestId: string, quantity: number, note: string) {
  const { error } = await recoveryRpc("offer_wanted_once", {
    target_request_id: requestId,
    supplied_quantity: quantity,
    supplied_note: note || null,
  });
  if (error) throw error;
}

export async function selectWantedOffer(requestId: string, offerId: string, expectedVersion: number) {
  const { error } = await recoveryRpc("select_wanted_offer", {
    target_request_id: requestId,
    target_offer_id: offerId,
    supplied_expected_version: expectedVersion,
  });
  if (error) throw error;
}

export async function selectWantedOneOffOffer(input: {
  requestId: string;
  offerId: string;
  expectedVersion: number;
  quantity: number;
  startDate: string;
  endDate: string;
}) {
  const { error } = await recoveryRpc("select_wanted_one_off_offer", {
    target_request_id: input.requestId,
    target_offer_id: input.offerId,
    supplied_expected_version: input.expectedVersion,
    supplied_quantity: input.quantity,
    supplied_start: input.startDate,
    supplied_end: input.endDate,
  });
  if (error) throw error;
}

export async function moderateWantedRequest(
  action: "moderate" | "restore",
  requestId: string,
  expectedVersion: number,
  reason: string,
  targetStatus?: Extract<WantedRequestStatus, "open" | "closed">,
) {
  const { error } = await recoveryRpc(`${action}_wanted_request`, action === "moderate" ? {
    target_request_id: requestId,
    supplied_expected_version: expectedVersion,
    supplied_reason: reason,
  } : {
    target_request_id: requestId,
    supplied_expected_version: expectedVersion,
    supplied_target_status: targetStatus,
    supplied_reason: reason,
  });
  if (error) throw error;
}
