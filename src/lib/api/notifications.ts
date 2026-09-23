import type {
  NotificationDeliveryDiagnostic,
  PrivateNotification,
  TransactionalEmailPreferences,
} from "@/types/gear";
import { recoveryRpc } from "./client";

export async function fetchPrivateNotifications(cursor?: {
  occurredAt: string;
  id: string;
}): Promise<PrivateNotification[]> {
  const { data, error } = await recoveryRpc("my_private_notifications", {
    before_occurred_at: cursor?.occurredAt ?? null,
    before_notification_id: cursor?.id ?? null,
    page_limit: 30,
  });
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    id: row.id,
    eventType: row.event_type,
    title: row.title,
    body: row.body,
    appRoute: row.app_route,
    occurredAt: row.occurred_at,
    readAt: row.read_at,
  }));
}
export async function setNotificationRead(
  notificationId: string,
  read: boolean,
): Promise<void> {
  const { error } = await recoveryRpc("set_my_notification_read", {
    target_notification_id: notificationId,
    supplied_read: read,
  });
  if (error) throw error;
}

export async function dismissNotification(notificationId: string): Promise<void> {
  const { error } = await recoveryRpc("dismiss_my_notification", {
    target_notification_id: notificationId,
  });
  if (error) throw error;
}

export async function dismissAllNotifications(): Promise<number> {
  const { data, error } = await recoveryRpc("dismiss_all_my_notifications", {});
  if (error) throw error;
  return Number(data ?? 0);
}

export async function fetchTransactionalEmailPreferences(): Promise<TransactionalEmailPreferences> {
  const { data, error } = await recoveryRpc("get_my_transactional_email_preferences", {});
  if (error) throw error;
  const row = data?.[0];
  return {
    loanActivity: row?.loan_activity ?? true,
    loanReminders: row?.loan_reminders ?? true,
    wantedActivity: row?.wanted_activity ?? true,
  };
}

export async function updateTransactionalEmailPreferences(
  preferences: TransactionalEmailPreferences,
): Promise<void> {
  const { error } = await recoveryRpc("update_my_transactional_email_preferences", {
    supplied_loan_activity: preferences.loanActivity,
    supplied_loan_reminders: preferences.loanReminders,
    supplied_wanted_activity: preferences.wantedActivity,
  });
  if (error) throw error;
}

export async function fetchNotificationDeliveryDiagnostics(): Promise<NotificationDeliveryDiagnostic[]> {
  const { data, error } = await recoveryRpc("private_notification_delivery_diagnostics", {
    target_user_id: null,
  });
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    outboxId: row.outbox_id,
    recipientUserId: row.recipient_user_id,
    recipientDisplayName: row.recipient_display_name,
    eventType: row.event_type,
    status: row.status,
    attemptCount: Number(row.attempt_count),
    suppressionReason: row.suppression_reason ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function setAdministratorEmailSuppression(
  userId: string,
  suppressed: boolean,
): Promise<void> {
  const { error } = await recoveryRpc("set_administrator_email_suppression", {
    target_user_id: userId,
    supplied_suppressed: suppressed,
  });
  if (error) throw error;
}
