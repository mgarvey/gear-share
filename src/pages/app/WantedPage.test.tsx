import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import WantedPage from "@/pages/app/WantedPage";

const mocked = vi.hoisted(() => ({
  fetchWantedRequests: vi.fn(), fetchWantedOffers: vi.fn(), fetchManageableWantedListings: vi.fn(),
  createWantedRequest: vi.fn(), updateWantedRequest: vi.fn(), changeWantedRequestState: vi.fn(),
  offerWantedListing: vi.fn(), offerWantedOnce: vi.fn(), selectWantedOffer: vi.fn(), selectWantedOneOffOffer: vi.fn(), moderateWantedRequest: vi.fn(),
}));
vi.mock("@/lib/gearShareApi", () => mocked);

const request = { id: "request", requesterId: "member", requesterName: "Alex", title: "Two-person tent", category: "tents-shelters", desiredQuantity: 1, desiredStart: null, desiredEnd: null, note: "Weekend camp", status: "open", closureKind: null, selectedOfferId: null, transitionVersion: 1, createdAt: "2028-01-01T00:00:00Z", updatedAt: "2028-01-01T00:00:00Z" };

function renderPage(accessLevel: "regular" | "administrator" = "regular") {
  return render(<MemoryRouter><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><WantedPage membership={{ id: "member", communityId: "community", displayName: "Alex", status: "active", accessLevel }} /></QueryClientProvider></MemoryRouter>);
}

describe("WantedPage", () => {
  it("renders the bounded private board and requester lifecycle actions", async () => {
    mocked.fetchWantedRequests.mockResolvedValue([request]);
    mocked.fetchWantedOffers.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText("Two-person tent")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Offer listed gear" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Hide request" })).not.toBeInTheDocument();
  });

  it("offers one-time help without making the member create a listing", async () => {
    const user = userEvent.setup();
    mocked.fetchWantedRequests.mockResolvedValue([{ ...request, requesterId: "requester", requesterName: "Pat", desiredQuantity: 3 }]);
    mocked.fetchWantedOffers.mockResolvedValue([]);
    mocked.offerWantedOnce.mockResolvedValue(undefined);
    renderPage();
    await screen.findByText("Two-person tent");

    await user.click(screen.getByRole("button", { name: "Offer one-time help" }));
    expect(screen.getByRole("dialog", { name: "Offer one-time help" })).toBeInTheDocument();
    expect(screen.getByText(/without adding the item to the catalog/i)).toBeInTheDocument();
    await user.clear(screen.getByLabelText("How many can you provide?"));
    await user.type(screen.getByLabelText("How many can you provide?"), "2");
    await user.type(screen.getByLabelText("Note to the requester (optional)"), "I can bring these to the meeting.");
    await user.click(screen.getByRole("button", { name: "Send offer" }));
    expect(mocked.offerWantedOnce).toHaveBeenCalledWith("request", 2, "I can bring these to the meeting.");
    expect(screen.getByRole("button", { name: "Offer listed gear" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create a reusable listing" })).toBeInTheDocument();
  });

  it("turns an accepted one-time offer into the normal borrowing request", async () => {
    const user = userEvent.setup();
    mocked.fetchWantedRequests.mockResolvedValue([{ ...request, desiredQuantity: 2 }]);
    mocked.fetchWantedOffers.mockResolvedValue([{ id: "offer", requestId: "request", supplyId: null, supplyTitle: "Two-person tent", offererId: "helper", offererName: "Sam", note: "I have one", status: "active", transitionVersion: 1, createdAt: "2028-01-01T00:00:00Z", offerKind: "one_off", offeredQuantity: 1 }]);
    mocked.selectWantedOneOffOffer.mockResolvedValue(undefined);
    renderPage();
    await screen.findByText("One-time help · up to 1");
    await user.click(screen.getByRole("button", { name: "Request this offer" }));
    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2099-05-01" } });
    fireEvent.change(screen.getByLabelText("End date"), { target: { value: "2099-05-03" } });
    await user.click(screen.getByRole("button", { name: "Send borrowing request" }));
    expect(mocked.selectWantedOneOffOffer).toHaveBeenCalledWith({ requestId: "request", offerId: "offer", expectedVersion: 1, quantity: 1, startDate: "2099-05-01", endDate: "2099-05-03" });
  });

  it("gives Administrators a plain-language hidden-request view without exposing destructive delete", async () => {
    const user = userEvent.setup();
    mocked.fetchWantedRequests.mockResolvedValue([request]);
    mocked.fetchWantedOffers.mockResolvedValue([]);
    renderPage("administrator");
    await screen.findByText("Two-person tent");
    expect(screen.getByRole("button", { name: "Hidden" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hide request" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "New request" }));
    expect(screen.getByRole("dialog", { name: "New wanted request" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Dates (optional)" })).toBeInTheDocument();
    expect(screen.getByLabelText("What are you looking for?")).toHaveClass("bg-card", "border-border", "shadow-sm");
    expect(screen.getByRole("combobox", { name: "Category" })).toHaveClass("bg-card", "border-border", "shadow-sm");
    expect(screen.getByLabelText("Additional context (optional)")).toHaveClass("bg-card", "border-border", "shadow-sm");
    expect(screen.getByLabelText("Start date").parentElement?.parentElement).toHaveClass("grid-cols-2");
    expect(screen.getByRole("button", { name: "Post request" }).parentElement).toHaveClass("shrink-0", "border-t");
  });

  it("uses compact mobile dialogs and explains offering and hiding in member language", async () => {
    const user = userEvent.setup();
    mocked.fetchWantedRequests.mockResolvedValue([{ ...request, requesterId: "requester", requesterName: "Pat" }]);
    mocked.fetchWantedOffers.mockResolvedValue([]);
    mocked.fetchManageableWantedListings.mockResolvedValue([]);
    renderPage("administrator");
    await screen.findByText("Two-person tent");

    await user.click(screen.getByRole("button", { name: "Offer listed gear" }));
    const offerDialog = screen.getByRole("dialog", { name: "Offer listed gear" });
    expect(offerDialog).toHaveClass("h-auto", "bottom-auto", "top-1/2", "overflow-hidden");
    expect(screen.getByText(/This does not create or approve a loan/).parentElement).not.toHaveClass("pr-14");
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await user.click(screen.getByRole("button", { name: "Hide request" }));
    const hideDialog = screen.getByRole("dialog", { name: "Hide wanted request" });
    expect(hideDialog).toHaveClass("h-auto", "bottom-auto", "top-1/2", "overflow-hidden");
    expect(screen.getByText(/without deleting it/i).parentElement).not.toHaveClass("pr-14");
    expect(screen.getByLabelText("Reason for hiding")).toBeInTheDocument();
  });

  it("aligns category clearing and lets a member clear both optional dates", async () => {
    const user = userEvent.setup();
    mocked.fetchWantedRequests.mockResolvedValue([{ ...request, category: "other-gear", desiredStart: "2028-01-01", desiredEnd: "2028-01-02" }]);
    mocked.fetchWantedOffers.mockResolvedValue([]);
    renderPage();
    await screen.findByText("Two-person tent");
    await user.click(screen.getByRole("button", { name: "Edit" }));

    expect(screen.getByRole("button", { name: "Clear category" })).toHaveClass("h-10");
    expect(screen.getAllByText("Choose the closest Scout gear category.")).toHaveLength(1);
    expect(screen.getByLabelText("Start date")).toHaveAttribute("type", "date");
    expect(screen.getByLabelText("End date")).toHaveAttribute("type", "date");

    await user.click(screen.getByRole("button", { name: "Clear dates" }));
    expect(screen.getByLabelText("Start date")).toHaveValue("");
    expect(screen.getByLabelText("End date")).toHaveValue("");
    expect(screen.queryByRole("button", { name: "Clear dates" })).not.toBeInTheDocument();
  });

  it("does not accept a wanted-request end date before its start date", async () => {
    const user = userEvent.setup();
    mocked.fetchWantedRequests.mockResolvedValue([]);
    mocked.fetchWantedOffers.mockResolvedValue([]);
    renderPage();
    await user.click(await screen.findByRole("button", { name: "New request" }));

    const start = screen.getByLabelText("Start date");
    const end = screen.getByLabelText("End date");
    fireEvent.change(start, { target: { value: "2028-03-10" } });
    expect(end).toHaveAttribute("min", "2028-03-10");
    fireEvent.change(end, { target: { value: "2028-03-09" } });
    expect(end).toHaveValue("");
    expect(screen.getByRole("alert")).toHaveTextContent("on or after the start date");
  });
});
