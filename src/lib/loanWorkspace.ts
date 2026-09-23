import type { Loan, Membership } from "@/types/gear";

export const ACTIONABLE_LOAN_STATUSES = ["pending", "approved", "checked_out"] as const;
export const TERMINAL_LOAN_STATUSES = ["returned", "declined", "cancelled"] as const;

export interface LoanRolePartition {
  borrower: Loan[];
  owner: Loan[];
  groupManager: Loan[];
  administratorOversight: Loan[];
}

export interface LoanActivity {
  actionable: Loan[];
  terminal: Loan[];
}

export function isActionableLoan(loan: Loan) {
  return (ACTIONABLE_LOAN_STATUSES as readonly string[]).includes(loan.status);
}

export function partitionLoansByPrimaryRole(loans: Loan[], membership: Membership): LoanRolePartition {
  const isAdministrator = membership.accessLevel === "administrator";
  const isInventoryManager = isAdministrator || membership.accessLevel === "custodian";
  const partition: LoanRolePartition = { borrower: [], owner: [], groupManager: [], administratorOversight: [] };
  for (const loan of loans) {
    if (loan.borrowerId === membership.id) partition.borrower.push(loan);
    else if (loan.ownershipKind === "individual" && loan.ownerId === membership.id) partition.owner.push(loan);
    else if (loan.ownershipKind === "group" && isInventoryManager) partition.groupManager.push(loan);
    else if (loan.ownershipKind === "individual" && isAdministrator) partition.administratorOversight.push(loan);
  }
  return partition;
}

export function splitLoanActivity(loans: Loan[]): LoanActivity {
  return loans.reduce<LoanActivity>((activity, loan) => {
    activity[isActionableLoan(loan) ? "actionable" : "terminal"].push(loan);
    return activity;
  }, { actionable: [], terminal: [] });
}
