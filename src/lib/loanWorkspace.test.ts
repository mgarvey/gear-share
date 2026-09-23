import { describe, expect, it } from "vitest";
import { isActionableLoan, partitionLoansByPrimaryRole, splitLoanActivity } from "./loanWorkspace";
import type { LoanStatus, Loan, Membership } from "@/types/gear";

const membership: Membership = {
  id: "administrator",
  communityId: "community",
  displayName: "Administrator",
  status: "active",
  accessLevel: "administrator",
};

function loan(id: string, status: LoanStatus, overrides: Partial<Loan> = {}): Loan {
  return {
    id,
    supplyId: `supply-${id}`,
    supplyTitle: `Item ${id}`,
    ownershipKind: "group",
    ownerId: null,
    ownerIsActive: false,
    currentCustodianId: "contact",
    currentCustodianName: "Contact",
    borrowerId: "borrower",
    borrowerName: "Borrower",
    custodianAtRequestId: "contact",
    quantity: 1,
    startDate: "2026-09-01",
    endDate: "2026-09-02",
    status,
    borrowerNote: null,
    ...overrides,
  };
}

describe("loan workspace classification", () => {
  it("classifies the three actionable and three terminal states", () => {
    const actionable = ["pending", "approved", "checked_out"] as const;
    const terminal = ["returned", "declined", "cancelled"] as const;
    expect(actionable.map((status) => isActionableLoan(loan(status, status)))).toEqual([true, true, true]);
    expect(terminal.map((status) => isActionableLoan(loan(status, status)))).toEqual([false, false, false]);
    expect(splitLoanActivity([...actionable, ...terminal].map((status) => loan(status, status)))).toMatchObject({
      actionable: actionable.map((status) => expect.objectContaining({ status })),
      terminal: terminal.map((status) => expect.objectContaining({ status })),
    });
  });

  it("uses borrower, owner, group manager, then Administrator oversight precedence", () => {
    const borrower = loan("borrower", "pending", { borrowerId: membership.id });
    const owner = loan("owner", "approved", { ownershipKind: "individual", ownerId: membership.id, ownerIsActive: true });
    const group = loan("group", "checked_out");
    const oversight = loan("oversight", "returned", { ownershipKind: "individual", ownerId: "other-owner", ownerIsActive: true });

    const result = partitionLoansByPrimaryRole([borrower, owner, group, oversight], membership);

    expect(result.borrower.map(({ id }) => id)).toEqual(["borrower"]);
    expect(result.owner.map(({ id }) => id)).toEqual(["owner"]);
    expect(result.groupManager.map(({ id }) => id)).toEqual(["group"]);
    expect(result.administratorOversight.map(({ id }) => id)).toEqual(["oversight"]);
  });

  it("does not derive loan authority from the Stored with contact", () => {
    const regularContact = { ...membership, id: "contact", accessLevel: "regular" as const };
    const result = partitionLoansByPrimaryRole([loan("contacted", "pending")], regularContact);
    expect(result).toEqual({ borrower: [], owner: [], groupManager: [], administratorOversight: [] });
  });
});
