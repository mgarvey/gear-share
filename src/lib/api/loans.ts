import type {
  HandoffCandidate,
  LoanContactDetails,
  LoanReminder,
  Loan,
} from "@/types/gear";
import { db, fetchRecoveryRowsInIdBatches, recoveryRpc } from "./client";

export async function fetchLoans(): Promise<Loan[]> {
  const { data, error } = await recoveryRpc("private_gear_loans", {});
  if (error) throw error;
  const rows = data ?? [];
  if (rows.length === 0) return [];
  const operations = await fetchRecoveryRowsInIdBatches(
    "private_loan_operations",
    rows.map((row: any) => row.id),
  );
  const byLoan = new Map(
    operations.map((row: any) => [row.loan_id, row]),
  );
  const acceptanceRows: any[] = [];
  for (let offset = 0; offset < rows.length; offset += 100) {
    const acceptances = await recoveryRpc("private_loan_guideline_acceptances", {
      supplied_loan_ids: rows.slice(offset, offset + 100).map((row: any) => row.id),
    });
    if (acceptances.error) throw acceptances.error;
    acceptanceRows.push(...(acceptances.data ?? []));
  }
  const acceptanceByLoan = new Map(
    acceptanceRows.map((row: any) => [row.loan_id, row]),
  );
  return rows.map((row: any) => {
    const operation: any = byLoan.get(row.id);
    const acceptance: any = acceptanceByLoan.get(row.id);
    return {
      id: row.id,
      supplyId: row.supply_id,
      supplyTitle: row.supply_title ?? "Gear",
      ownershipKind: row.ownership_kind ?? "individual",
      ownerId: row.owner_id ?? null,
      ownerIsActive: Boolean(row.owner_is_active),
      currentCustodianId: row.current_custodian_id,
      currentCustodianName: row.current_custodian_name ?? "Community member",
      borrowerId: row.borrower_id,
      borrowerName: row.borrower_name ?? "Community member",
      custodianAtRequestId: row.custodian_at_request_id,
      quantity: row.quantity,
      startDate: row.start_date,
      endDate: row.end_date,
      status: row.status,
      borrowerNote: row.borrower_note,
      handoffContactId: operation?.handoff_contact_id ?? null,
      handoffContactName: operation?.handoff_contact_name ?? null,
      needsAttention: Boolean(operation?.needs_attention),
      needsAttentionReason: operation?.needs_attention_reason ?? null,
      guidelineVersion: acceptance ? Number(acceptance.guideline_version) : null,
      acceptedGuidelines: acceptance?.rules ?? [],
      guidelinesAcceptedAt: acceptance?.accepted_at ?? null,
    };
  });
}
export async function getAvailability(
  supplyId: string,
  startDate: string,
  endDate: string,
): Promise<number> {
  const { data, error } = await db.rpc("available_quantity", {
    target_supply_id: supplyId,
    range_start: startDate,
    range_end: endDate,
  });
  if (error) throw error;
  return Number(data);
}

export interface LoanAvailabilitySummary {
  availableQuantity: number;
  pendingQuantity: number;
  pendingRequestCount: number;
}

export async function getLoanAvailabilitySummary(
  supplyId: string,
  startDate: string,
  endDate: string,
): Promise<LoanAvailabilitySummary> {
  const { data, error } = await recoveryRpc("loan_availability_summary", {
    target_supply_id: supplyId,
    range_start: startDate,
    range_end: endDate,
  });
  if (error) throw error;
  const row = data?.[0];
  if (!row) throw new Error("Availability could not be loaded.");
  return {
    availableQuantity: Number(row.available_quantity),
    pendingQuantity: Number(row.pending_quantity),
    pendingRequestCount: Number(row.pending_request_count),
  };
}

export async function requestLoan(input: {
  supplyId: string;
  quantity: number;
  startDate: string;
  endDate: string;
  note: string;
  guidelineVersion?: number;
  guidelinesAccepted?: boolean;
}) {
  const { error } = await recoveryRpc("request_gear_loan", {
    target_supply_id: input.supplyId,
    requested_quantity: input.quantity,
    requested_start: input.startDate,
    requested_end: input.endDate,
    supplied_note: input.note || null,
    supplied_guideline_version: input.guidelineVersion ?? null,
    supplied_guidelines_accepted: input.guidelinesAccepted ?? false,
  });
  if (error) throw error;
}

export async function setSupplyGuidelines(
  supplyId: string,
  expectedVersion: number,
  rules: string[],
): Promise<{ guidelineVersion: number; rules: string[] }> {
  const { data, error } = await recoveryRpc("set_supply_guidelines", {
    target_supply_id: supplyId,
    supplied_expected_version: expectedVersion,
    supplied_rules: rules,
  });
  if (error) throw error;
  const row = data?.[0];
  return {
    guidelineVersion: Number(row?.guideline_version ?? expectedVersion),
    rules: row?.rules ?? rules,
  };
}

export async function transitionLoan(
  action: "approve" | "decline" | "checkout" | "return" | "cancel",
  loanId: string,
  options?: {
    handoffContactId?: string;
    markNeedsAttention?: boolean;
    attentionReason?: string;
  },
) {
  const result =
    action === "approve"
      ? await recoveryRpc("approve_gear_loan", {
          target_loan_id: loanId,
          supplied_handoff_contact_id: options?.handoffContactId ?? null,
        })
      : action === "decline"
        ? await db.rpc("decline_gear_loan", { target_loan_id: loanId })
        : action === "checkout"
          ? await db.rpc("checkout_gear_loan", { target_loan_id: loanId })
          : action === "return"
            ? await recoveryRpc("return_gear_loan", {
                target_loan_id: loanId,
                mark_needs_attention: Boolean(options?.markNeedsAttention),
                supplied_attention_reason: options?.attentionReason || null,
              })
            : await db.rpc("cancel_gear_loan", {
                target_loan_id: loanId,
                supplied_reason: "cancelled in app",
              });
  const { error } = result;
  if (error) throw error;
}

export async function setSupplyNeedsAttention(
  supplyId: string,
  value: boolean,
  reason: string,
) {
  const { error } = await recoveryRpc("set_supply_needs_attention", {
    target_supply_id: supplyId,
    supplied_value: value,
    supplied_reason: reason,
  });
  if (error) throw error;
}

export async function fetchHandoffCandidates(
  loanId: string,
): Promise<HandoffCandidate[]> {
  const { data, error } = await recoveryRpc("private_handoff_candidates", {
    target_loan_id: loanId,
  });
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    id: row.id,
    displayName: row.display_name,
  }));
}

export async function reassignLoanHandoff(
  loanId: string,
  handoffContactId: string,
) {
  const { error } = await recoveryRpc("reassign_loan_handoff", {
    target_loan_id: loanId,
    target_handoff_user_id: handoffContactId,
  });
  if (error) throw error;
}

export async function fetchLoanReminders(): Promise<LoanReminder[]> {
  const { data, error } = await recoveryRpc("my_loan_reminders", {});
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    id: row.id,
    loanId: row.loan_id,
    supplyTitle: row.supply_title,
    kind: row.reminder_kind,
    ordinal: Number(row.ordinal),
    endDate: row.end_date,
    dueAt: row.due_at,
    occurredAt: row.occurred_at,
  }));
}

export async function fetchLoanContactDetails(
  loanId: string,
): Promise<LoanContactDetails | null> {
  const { data, error } = await recoveryRpc("loan_contact_details", {
    target_loan_id: loanId,
  });
  if (error) throw error;
  const row = data?.[0];
  if (!row) return null;
  return {
    displayName: row.display_name,
    email: row.email ?? "",
    phoneE164: row.phone_e164 ?? "",
    coordinationNote: row.coordination_note ?? "",
  };
}
