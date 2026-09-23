import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { LoanRequestForm } from "@/components/gear/LoanRequestForm";
import type { GearItem } from "@/types/gear";

const mocked = vi.hoisted(() => ({ getLoanAvailabilitySummary: vi.fn(), requestLoan: vi.fn() }));
vi.mock("@/lib/gearShareApi", () => mocked);

const item: GearItem = {
  id: "tent", communityId: "community", title: "Tent", description: "", category: "tents-shelters", condition: "good", ownershipKind: "group", ownerId: null, ownerIsActive: false, custodianId: "member", custodianName: "Member", custodianPostalCode: null, quantityTotal: 2, listingStatus: "listed", imagePaths: [], guidelineVersion: 4, borrowingGuidelines: ["Return dry"],
};

function renderForm(props: ComponentProps<typeof LoanRequestForm>) {
  return render(<MemoryRouter><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><LoanRequestForm {...props} /></QueryClientProvider></MemoryRouter>);
}

describe("LoanRequestForm guidelines", () => {
  it("requires acceptance, submits the loaded guideline version, and confirms success", async () => {
    const user = userEvent.setup();
    mocked.getLoanAvailabilitySummary.mockResolvedValue({ availableQuantity: 2, pendingQuantity: 0, pendingRequestCount: 0 });
    mocked.requestLoan.mockResolvedValue(undefined);
    renderForm({ item, initialValues: { quantity: 1, startDate: "2028-01-01", endDate: "2028-01-02" } });
    const submit = screen.getByRole("button", { name: "Submit request" });
    expect(submit).toBeDisabled();
    await user.click(screen.getByRole("checkbox"));
    expect(submit).toBeEnabled();
    await user.click(submit);
    expect(mocked.requestLoan.mock.calls[0][0]).toEqual(expect.objectContaining({ supplyId: "tent", guidelineVersion: 4, guidelinesAccepted: true, startDate: "2028-01-01", endDate: "2028-01-02" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Request sent");
    expect(screen.getByRole("link", { name: "View my loans" })).toHaveAttribute("href", "/loans");
    expect(screen.queryByRole("button", { name: "Submit request" })).not.toBeInTheDocument();
  });

  it("shows date affordances and clears both borrowing dates", async () => {
    const user = userEvent.setup();
    mocked.getLoanAvailabilitySummary.mockResolvedValue({ availableQuantity: 2, pendingQuantity: 1, pendingRequestCount: 1 });
    renderForm({ item, initialValues: { quantity: 1, startDate: "2028-01-01", endDate: "2028-01-02" } });

    expect(screen.getByLabelText("Start date")).toHaveAttribute("type", "date");
    expect(screen.getByLabelText("End date")).toHaveAttribute("type", "date");
    expect(screen.getByLabelText("Start date").parentElement?.parentElement).toHaveClass("grid-cols-2");
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("1 unit is also awaiting approval across 1 request"));
    expect(screen.getByRole("status")).toHaveTextContent("Pending requests do not reserve gear until approved");
    await user.click(screen.getByRole("button", { name: "Clear dates" }));
    expect(screen.getByLabelText("Start date")).toHaveValue("");
    expect(screen.getByLabelText("End date")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Submit request" })).toBeDisabled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("does not accept an end date before the start date", () => {
    mocked.getLoanAvailabilitySummary.mockResolvedValue({ availableQuantity: 2, pendingQuantity: 0, pendingRequestCount: 0 });
    renderForm({ item });

    const start = screen.getByLabelText("Start date");
    const end = screen.getByLabelText("End date");
    fireEvent.change(start, { target: { value: "2028-02-10" } });
    expect(end).toHaveAttribute("min", "2028-02-10");

    fireEvent.change(end, { target: { value: "2028-02-09" } });
    expect(end).toHaveValue("");
    expect(screen.getByRole("alert")).toHaveTextContent("on or after the start date");

    fireEvent.change(end, { target: { value: "2028-02-12" } });
    expect(end).toHaveValue("2028-02-12");
    fireEvent.change(start, { target: { value: "2028-02-13" } });
    expect(end).toHaveValue("");
  });

  it("does not accept borrowing dates in the past", () => {
    mocked.getLoanAvailabilitySummary.mockResolvedValue({ availableQuantity: 2, pendingQuantity: 0, pendingRequestCount: 0 });
    renderForm({ item });

    const localNow = new Date();
    const today = new Date(localNow.getTime() - localNow.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
    const yesterdayDate = new Date(localNow);
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterday = new Date(yesterdayDate.getTime() - yesterdayDate.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
    const start = screen.getByLabelText("Start date");
    const end = screen.getByLabelText("End date");

    expect(start).toHaveAttribute("min", today);
    expect(end).toHaveAttribute("min", today);
    fireEvent.change(start, { target: { value: yesterday } });
    expect(start).toHaveValue("");
    expect(screen.getByRole("alert")).toHaveTextContent("today or a later date");
    expect(screen.getByRole("button", { name: "Submit request" })).toBeDisabled();
  });
});
