import type {
  AccessLevel,
  AdministratorOrientationItem,
  AiDraftingSettingResult,
  CommunitySettings,
  JoinQuestion,
  MemberAdministrationRecord,
  PendingMember,
  ReactivationImpact,
} from "@/types/gear";
import { db, invokeAuthenticatedFunction, recoveryRpc } from "./client";

async function invitationErrorCode(error: unknown) {
  const context = (error as { context?: unknown } | null)?.context;
  if (!(context instanceof Response)) return undefined;
  try {
    const body = await context.clone().json() as { code?: unknown };
    return typeof body.code === "string" ? body.code : undefined;
  } catch {
    return undefined;
  }
}

async function functionErrorCode(error: unknown) {
  return invitationErrorCode(error);
}

export async function sendPreapprovedMemberInvitation(email: string, displayName: string) {
  const { data, error } = await invokeAuthenticatedFunction("invite-preapproved-member", {
    body: { email, displayName },
  });
  if (!error && data?.code === "sent") return;
  const code = data?.code ?? await invitationErrorCode(error);
  if (code === "existing_account") throw new Error("That email already has an account. Use the existing member controls instead.");
  if (code === "in_progress") throw new Error("An invitation for that email is already being sent.");
  if (code === "rate_limit") throw new Error("The invitation limit has been reached. Try again later.");
  if (code === "authorization") throw new Error("Only an active Administrator can send personal invitations.");
  if (code === "result_unknown") throw new Error("The result is unclear. Check the member list before trying again.");
  if (code === "delivery") throw new Error("The invitation email could not be sent. Try again.");
  if (code === "input_email") throw new Error("Enter a valid email address.");
  if (code === "input_display_name") throw new Error("Use a display name of 80 characters or fewer without links or special formatting.");
  if (code === "input") throw new Error("Enter a valid email address and an optional display name of 80 characters or fewer.");
  throw new Error("Personal invitations are unavailable right now.");
}

export async function deleteDeactivatedMember(userId: string) {
  const { data, error } = await invokeAuthenticatedFunction("delete-deactivated-member", {
    body: { targetUserId: userId },
  });
  if (!error && data?.code === "deleted") return;
  const code = data?.code ?? await functionErrorCode(error);
  if (code === "authorization") throw new Error("Only an active Administrator can delete a deactivated account.");
  if (code === "not_deactivated") throw new Error("This account must be deactivated before it can be deleted.");
  if (code === "already_deleted") throw new Error("This account has already been deleted.");
  if (code === "result_unknown") throw new Error("The result is unclear. Refresh the member list before trying again.");
  if (code === "input") throw new Error("The selected member could not be deleted.");
  throw new Error("Account deletion is unavailable right now.");
}

export async function fetchPendingMembers() {
  const { data, error } = await recoveryRpc("private_pending_members", {});
  if (error) throw error;
  return (data ?? []) as PendingMember[];
}
export async function decideMembership(userId: string, approve: boolean) {
  const { error } = await db.rpc("decide_membership", {
    target_user_id: userId,
    approve,
  });
  if (error) throw error;
}

export async function allowMembershipReapplication(userId: string) {
  const { error } = await recoveryRpc("allow_membership_reapplication", {
    target_user_id: userId,
  });
  if (error) throw error;
}

export async function fetchActiveMembers(targetSupplyId?: string) {
  const { data, error } = await recoveryRpc("private_inventory_contacts", {
    target_supply_id: targetSupplyId ?? null,
  });
  if (error) throw error;
  return data ?? [];
}

export async function fetchMemberAdministration(): Promise<MemberAdministrationRecord[]> {
  const { data, error } = await recoveryRpc("private_member_administration", {});
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    id: row.id,
    display_name: row.display_name,
    account_email: row.account_email,
    membership_status: row.membership_status,
    accessLevel: row.access_level,
  }));
}

export async function setAccessLevel(userId: string, accessLevel: AccessLevel) {
  const targetRole =
    accessLevel === "administrator"
      ? "steward"
      : accessLevel === "custodian"
        ? "custodian"
        : "member";
  const { error } = await db.rpc("set_access_level", {
    target_user_id: userId,
    target_role: targetRole,
  });
  if (error) throw error;
}

export async function getDeactivationImpact(
  userId: string,
  successorId: string,
) {
  const { data, error } = await db.rpc("deactivation_impact", {
    target_user_id: userId,
    successor_user_id: successorId,
  });
  if (error) throw error;
  const row = data?.[0];
  return {
    affectedListings: Number(row?.affected_listings ?? 0),
    requestsToCancel: Number(row?.requests_to_cancel ?? 0),
    checkedOutLoans: Number(row?.checked_out_loans ?? 0),
  };
}

export async function deactivateMember(userId: string, successorId: string) {
  const { error } = await db.rpc("deactivate_member", {
    target_user_id: userId,
    successor_user_id: successorId,
  });
  if (error) throw error;
}

export async function fetchCommunitySettings(): Promise<CommunitySettings> {
  const { data, error } = await recoveryRpc("get_my_community_settings", {});
  if (error) throw error;
  const row = data?.[0];
  if (!row) throw new Error("Community settings are unavailable.");
  return {
    communityId: row.community_id,
    displayName: row.display_name,
    configurationVersion: Number(row.configuration_version),
    aiDraftingEnabled: Boolean(row.ai_drafting_enabled),
  };
}

export async function updateCommunityDisplayName(name: string, expectedVersion: number): Promise<CommunitySettings> {
  const { data, error } = await recoveryRpc("update_community_display_name", {
    supplied_name: name,
    expected_version: expectedVersion,
  });
  if (error) throw error;
  const row = data?.[0];
  return {
    communityId: row.community_id,
    displayName: row.display_name,
    configurationVersion: Number(row.configuration_version),
    aiDraftingEnabled: Boolean(row.ai_drafting_enabled),
  };
}

export async function setAiDraftingEnabled(enabled: boolean, expectedVersion: number): Promise<AiDraftingSettingResult> {
  const { data, error } = await recoveryRpc("set_ai_drafting_enabled", {
    supplied_enabled: enabled,
    expected_version: expectedVersion,
  });
  if (error) throw error;
  const row = data?.[0];
  return {
    configurationVersion: Number(row.configuration_version),
    aiDraftingEnabled: Boolean(row.ai_drafting_enabled),
    alreadyReservedRequests: Number(row.already_reserved_requests),
    statusReason: row.status_reason,
  };
}

export async function fetchReactivationImpact(userId: string): Promise<ReactivationImpact> {
  const { data, error } = await recoveryRpc("reactivation_impact", { target_user_id: userId });
  if (error) throw error;
  const row = data?.[0];
  if (!row) throw new Error("Reactivation impact is unavailable.");
  return {
    targetId: row.target_id,
    displayName: row.display_name,
    membershipStatus: row.membership_status,
    priorAccessLevel: row.prior_access_level,
    cancelledLoans: Number(row.cancelled_loans),
    individualOwnedListings: Number(row.individual_owned_listings),
    storedWithListings: Number(row.stored_with_listings),
    notificationConsequence: row.notification_consequence,
    previewVersion: row.preview_version,
  };
}

export async function reactivateMember(userId: string, previewVersion: string, reason: string): Promise<string> {
  const { data, error } = await recoveryRpc("reactivate_member", {
    target_user_id: userId,
    supplied_preview_version: previewVersion,
    supplied_reason: reason,
  });
  if (error) throw error;
  return data;
}

export async function fetchAdministratorOrientation(): Promise<AdministratorOrientationItem[]> {
  const { data, error } = await recoveryRpc("get_my_administrator_orientation", {});
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    registryVersion: Number(row.registry_version),
    itemId: row.item_id,
    label: row.label,
    helpText: row.help_text,
    routeId: row.route_id,
    displayOrder: Number(row.display_order),
    required: Boolean(row.required),
    applicableRole: row.applicable_role,
    status: row.status,
    changedAt: row.changed_at,
  }));
}

export async function setAdministratorOrientation(registryVersion: number, itemId: string, status: "completed" | "dismissed"): Promise<void> {
  const { error } = await recoveryRpc("set_my_administrator_orientation", {
    supplied_registry_version: registryVersion,
    supplied_item_id: itemId,
    supplied_status: status,
  });
  if (error) throw error;
}

export async function publishJoinQuestions(questions: JoinQuestion[]) {
  const normalized = questions.map((question, index) => ({
    id: `q${index + 1}`,
    prompt: question.prompt.trim(),
    required: question.required,
  }));
  const { error } = await recoveryRpc("publish_join_questions", {
    supplied_questions: normalized,
  });
  if (error) throw error;
}
