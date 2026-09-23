import type {
  JoinQuestionSet,
  MemberProfileSettings,
  Membership,
} from "@/types/gear";
import { recoveryRpc } from "./client";

export async function fetchMembership(): Promise<Membership | null> {
  const { data, error } = await recoveryRpc("my_membership_snapshot", {});
  if (error) throw error;
  const row = data?.[0];
  if (!row) return null;
  return {
    id: row.id,
    communityId: row.community_id,
    displayName: row.display_name,
    status: row.membership_status,
    accessLevel: row.access_level,
  };
}
export async function fetchJoinQuestions(): Promise<JoinQuestionSet> {
  const { data, error } = await recoveryRpc("current_join_questions", {});
  if (error) throw error;
  const row = data?.[0];
  if (!row) throw new Error("The membership application is not configured.");
  return {
    communityName: row.community_name,
    versionId: row.version_id,
    questions: row.questions ?? [],
  };
}

export async function submitJoinApplication(
  versionId: string,
  answers: Record<string, string>,
) {
  const { error } = await recoveryRpc("submit_join_application", {
    supplied_version_id: versionId,
    supplied_answers: answers,
  });
  if (error) throw error;
}

export async function fetchMyMembershipApplication() {
  const { data, error } = await recoveryRpc("my_membership_application", {});
  if (error) throw error;
  return data?.[0] ?? null;
}

export async function fetchMyProfileSettings(): Promise<MemberProfileSettings> {
  const { data, error } = await recoveryRpc("get_my_profile_settings", {});
  if (error) throw error;
  const row = data?.[0];
  if (!row) throw new Error("Profile settings are unavailable.");
  return {
    displayName: row.display_name,
    introduction: row.introduction ?? "",
    phoneE164: row.phone_e164 ?? "",
    coordinationNote: row.coordination_note ?? "",
    confirmedEmail: row.confirmed_email ?? "",
  };
}

export async function updateMyProfileSettings(
  settings: Omit<MemberProfileSettings, "confirmedEmail">,
) {
  const { error } = await recoveryRpc("update_my_profile_settings", {
    supplied_display_name: settings.displayName,
    supplied_introduction: settings.introduction,
    supplied_phone_e164: settings.phoneE164,
    supplied_coordination_note: settings.coordinationNote,
  });
  if (error) throw error;
}
