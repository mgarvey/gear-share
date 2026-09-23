import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link, MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GearImage } from "@/components/gear/GearImage";
import { LegacyManagementRedirect } from "@/components/gear/LegacyManagementRedirect";
import { PrimaryNavigation } from "@/components/gear/PrimaryNavigation";
import GearDetailPage from "@/pages/app/GearDetailPage";
import type { Membership, GearItem } from "@/types/gear";

const api = vi.hoisted(() => ({
  fetchSupplies: vi.fn(),
  fetchPrivateNotifications: vi.fn(),
  fetchSupplyDetail: vi.fn(),
  fetchListingPostalCode: vi.fn(),
  getLoanAvailabilitySummary: vi.fn(),
  getSignedImageUrl: vi.fn(),
  requestLoan: vi.fn(),
  setSupplyNeedsAttention: vi.fn(),
}));

vi.mock("@/lib/gearShareApi", () => api);

const membership: Membership = {
  id: "member",
  communityId: "community",
  displayName: "Regular Member",
  status: "active",
  accessLevel: "regular",
};

function supply(id: string, overrides: Partial<GearItem> = {}): GearItem {
  return {
    id,
    communityId: "community",
    title: id === "tent" ? "Trail tent" : "Camp stove",
    description: "Complete item description",
    category: "tents-shelters",
    condition: "good",
    ownershipKind: "group",
    ownerId: null,
    ownerIsActive: false,
    custodianId: "contact",
    custodianName: "Storage Contact",
    custodianPostalCode: null,
    quantityTotal: 6,
    listingStatus: "listed",
    imagePaths: [],
    ...overrides,
  };
}

function renderWithClient(ui: React.ReactElement, initialEntries: any[] = ["/"]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={initialEntries}>{ui}</MemoryRouter></QueryClientProvider>);
}

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="Current route">{location.pathname}{location.search}</output>;
}

describe("gear experience foundation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
    api.fetchSupplyDetail.mockImplementation(async (id: string) => ((await api.fetchSupplies()) ?? []).find((item: GearItem) => item.id === id) ?? null);
    api.fetchPrivateNotifications.mockResolvedValue([]);
    api.fetchListingPostalCode.mockResolvedValue("");
    api.getSignedImageUrl.mockImplementation(async (path: string) => `blob:${path}`);
    api.setSupplyNeedsAttention.mockResolvedValue(undefined);
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  });

  it("keeps a held listing canonical and lets its individual owner clear the audited hold", async () => {
    const user = userEvent.setup();
    api.fetchSupplies.mockResolvedValue([supply("held", { ownershipKind: "individual", ownerId: membership.id, ownerIsActive: true, custodianId: membership.id, needsAttention: true, needsAttentionReason: "Inspect zipper" })]);

    renderWithClient(<Routes><Route path="/gear/:supplyId" element={<GearDetailPage membership={membership} />} /></Routes>, ["/gear/held"]);

    expect(await screen.findByText("Needs Attention")).toBeInTheDocument();
    expect(screen.getByText(/New approvals and checkouts are paused/)).toBeInTheDocument();
    await user.type(screen.getByLabelText("Reason"), "Zipper repaired and inspected");
    await user.click(screen.getByRole("button", { name: "Clear Needs Attention" }));

    expect(api.setSupplyNeedsAttention).toHaveBeenCalledWith("held", false, "Zipper repaired and inspected");
  });

  it.each([
    ["regular", false, false],
    ["custodian", true, false],
    ["administrator", true, true],
  ] as const)("shows the exact %s primary navigation", async (accessLevel, hasInventory, hasAdministration) => {
    const user = userEvent.setup();
    renderWithClient(<PrimaryNavigation accessLevel={accessLevel} onSignOut={vi.fn()} />, ["/catalog"]);

    expect(screen.getByRole("link", { name: "Browse" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "My gear" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Loans" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Notifications" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add gear" })).toHaveAttribute("href", "/my-gear?add=1");
    expect(screen.getByRole("link", { name: "Add in bulk" })).toHaveAttribute("href", "/bulk-intake");
    await user.click(screen.getByRole("button", { name: /Account/ }));
    expect(screen.queryByText("Group inventory") !== null).toBe(hasInventory);
    expect(screen.queryByText("Administration") !== null).toBe(hasAdministration);
  });

  it("uses a compact menu instead of wrapping Administrator navigation", () => {
    renderWithClient(<PrimaryNavigation accessLevel="administrator" onSignOut={vi.fn()} />, ["/catalog"]);
    expect(screen.getByRole("button", { name: "Open menu" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Primary" })).toHaveClass("hidden", "md:flex");
  });

  it("visually marks the notification bell when unread notifications exist", async () => {
    const readPage = Array.from({ length: 30 }, (_, index) => ({ id: `read-${index}`, eventType: "loan_requested", title: "Loan requested", body: "A member requested gear.", appRoute: "/loans", occurredAt: `2026-08-17T12:${String(59 - index).padStart(2, "0")}:00Z`, readAt: "2026-08-17T13:00:00Z" }));
    api.fetchPrivateNotifications.mockResolvedValueOnce(readPage).mockResolvedValueOnce([{ id: "unread", eventType: "loan_requested", title: "Loan requested", body: "A member requested gear.", appRoute: "/loans", occurredAt: "2026-08-16T12:00:00Z", readAt: null }]);

    renderWithClient(<PrimaryNavigation accessLevel="regular" onSignOut={vi.fn()} />, ["/catalog"]);

    const notificationLink = await screen.findByRole("link", { name: "Notifications, unread" });
    expect(notificationLink.querySelector("[data-unread-notification-indicator]")).toHaveClass("-right-0.5", "-top-0.5", "h-2", "w-2", "bg-amber-300", "ring-1", "ring-primary");
    expect(api.fetchPrivateNotifications).toHaveBeenNthCalledWith(2, { occurredAt: readPage[29].occurredAt, id: readPage[29].id });
  });

  it("routes legacy Administrator membership links to Administration and preserves safe query context", async () => {
    renderWithClient(<Routes>
      <Route path="/manage" element={<LegacyManagementRedirect accessLevel="administrator" />} />
      <Route path="/administration" element={<LocationProbe />} />
    </Routes>, ["/manage?view=members&q=tent"]);

    expect(await screen.findByLabelText("Current route")).toHaveTextContent("/administration?q=tent");
  });

  it("routes legacy Custodian links to Inventory instead of Administration", async () => {
    renderWithClient(<Routes>
      <Route path="/steward" element={<LegacyManagementRedirect accessLevel="custodian" />} />
      <Route path="/inventory" element={<LocationProbe />} />
    </Routes>, ["/steward?view=members&category=Shelter"]);

    expect(await screen.findByLabelText("Current route")).toHaveTextContent("/inventory?category=Shelter");
  });

  it("shows complete selected-item facts and dated availability to a requestable member", async () => {
    const user = userEvent.setup();
    api.fetchSupplies.mockResolvedValue([supply("tent")]);
    api.fetchListingPostalCode.mockResolvedValue("78664");
    api.getLoanAvailabilitySummary.mockResolvedValue({ availableQuantity: 4, pendingQuantity: 2, pendingRequestCount: 1 });
    renderWithClient(<Routes><Route path="/gear/:supplyId" element={<GearDetailPage membership={membership} />} /></Routes>, ["/gear/tent"]);

    expect(await screen.findByRole("heading", { name: "Trail tent" })).toBeInTheDocument();
    expect(screen.getByText("Tents & Shelters")).toBeInTheDocument();
    expect(screen.getByText("Good")).toBeInTheDocument();
    expect(screen.getByText(/Storage Contact · 78664/)).toBeInTheDocument();
    expect(screen.getByText("6")).toBeInTheDocument();
    expect(screen.queryByText("Catalog status")).not.toBeInTheDocument();
    expect(screen.queryByText("Published")).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("Start date"), "2027-08-01");
    await user.type(screen.getByLabelText("End date"), "2027-08-03");
    await waitFor(() => expect(api.getLoanAvailabilitySummary).toHaveBeenCalledWith("tent", "2027-08-01", "2027-08-03"));
    expect(await screen.findByRole("status")).toHaveTextContent("4 available");
    expect(screen.getByRole("status")).toHaveTextContent("2 units are also awaiting approval across 1 request");
  });

  it("brings the borrowing form into view from a catalog request shortcut", async () => {
    api.fetchSupplies.mockResolvedValue([supply("tent")]);
    renderWithClient(<Routes><Route path="/gear/:supplyId" element={<GearDetailPage membership={membership} />} /></Routes>, ["/gear/tent#request"]);

    expect(await screen.findByRole("heading", { name: "Request to borrow" })).toBeInTheDocument();
    await waitFor(() => expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledWith({ block: "start" }));
  });

  it("prefills editable request dates carried from the Catalog", async () => {
    api.fetchSupplies.mockResolvedValue([supply("tent")]);
    api.getLoanAvailabilitySummary.mockResolvedValue({ availableQuantity: 3, pendingQuantity: 0, pendingRequestCount: 0 });
    renderWithClient(
      <Routes><Route path="/gear/:supplyId" element={<GearDetailPage membership={membership} />} /></Routes>,
      [{ pathname: "/gear/tent", hash: "#request", state: { returnTo: "/catalog?start=2099-08-01&end=2099-08-04", catalogDates: { startDate: "2099-08-01", endDate: "2099-08-04" } } }],
    );

    expect(await screen.findByLabelText("Start date")).toHaveValue("2099-08-01");
    expect(screen.getByLabelText("End date")).toHaveValue("2099-08-04");
    await waitFor(() => expect(api.getLoanAvailabilitySummary).toHaveBeenCalledWith("tent", "2099-08-01", "2099-08-04"));
  });

  it("shows the explicit legacy condition state on canonical detail", async () => {
    api.fetchSupplies.mockResolvedValue([supply("tent", { condition: null })]);
    renderWithClient(<Routes><Route path="/gear/:supplyId" element={<GearDetailPage membership={membership} />} /></Routes>, ["/gear/tent"]);

    expect(await screen.findByText("Condition not recorded")).toBeInTheDocument();
  });

  it("does not offer borrowing controls to an individual owner", async () => {
    api.fetchSupplies.mockResolvedValue([supply("stove", { ownershipKind: "individual", ownerId: membership.id, ownerIsActive: true, custodianId: membership.id })]);
    renderWithClient(<Routes><Route path="/gear/:supplyId" element={<GearDetailPage membership={membership} />} /></Routes>, ["/gear/stove"]);

    expect(await screen.findByText(/You manage this individual-owned item/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Start date")).not.toBeInTheDocument();
  });

  it("does not expose removed or unknown gear details", async () => {
    api.fetchSupplies.mockResolvedValue([supply("retired", { title: "Private retired detail", listingStatus: "retired" })]);
    renderWithClient(<Routes><Route path="/gear/:supplyId" element={<GearDetailPage membership={membership} />} /></Routes>, ["/gear/retired"]);

    expect(await screen.findByRole("heading", { name: "Gear unavailable" })).toBeInTheDocument();
    expect(screen.queryByText("Private retired detail")).not.toBeInTheDocument();
  });

  it("resets quantity and dates when navigation selects another item", async () => {
    const user = userEvent.setup();
    api.fetchSupplies.mockResolvedValue([supply("tent"), supply("stove", { quantityTotal: 1 })]);
    renderWithClient(<>
      <Link to="/gear/stove">Next item</Link>
      <Routes><Route path="/gear/:supplyId" element={<GearDetailPage membership={membership} />} /></Routes>
    </>, ["/gear/tent"]);

    const quantity = await screen.findByLabelText("Quantity (of 6)");
    await user.clear(quantity);
    await user.type(quantity, "2");
    await user.type(screen.getByLabelText("Start date"), "2027-08-01");
    await user.click(screen.getByRole("link", { name: "Next item" }));

    expect(await screen.findByLabelText("Quantity (of 1)")).toHaveValue(1);
    expect(screen.getByLabelText("Start date")).toHaveValue("");
  });

  it("fits a signed image inside the selected frame instead of cropping it", async () => {
    api.getSignedImageUrl.mockResolvedValue("https://example.test/tent.jpg");
    renderWithClient(<GearImage imagePath="community/tent.jpg" title="Trail tent" variant="detail" />);

    const image = await screen.findByRole("img", { name: "Trail tent" });
    expect(image).toHaveClass("object-contain");
    expect(image).toHaveClass("absolute", "inset-0", "h-full", "w-full");
    expect(image).not.toHaveClass("object-cover");
  });

  it("limits canonical detail to four ordered photos with accessible gallery controls", async () => {
    const user = userEvent.setup();
    api.fetchSupplies.mockResolvedValue([supply("tent", {
      imagePaths: ["one.jpg", "two.jpg", "three.jpg", "four.jpg", "ignored.jpg"],
    })]);
    renderWithClient(<Routes><Route path="/gear/:supplyId" element={<GearDetailPage membership={membership} />} /></Routes>, ["/gear/tent"]);

    const gallery = await screen.findByLabelText("Trail tent photo gallery");
    expect(screen.getByText("1 of 4")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show photo 5" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Next photo" }));
    expect(await screen.findByRole("img", { name: "Trail tent, photo 2 of 4" })).toBeInTheDocument();
    expect(screen.getByText("2 of 4")).toBeInTheDocument();

    gallery.focus();
    await user.keyboard("{ArrowLeft}");
    expect(await screen.findByRole("img", { name: "Trail tent, photo 1 of 4" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show photo 4" }));
    expect(await screen.findByRole("img", { name: "Trail tent, photo 4 of 4" })).toBeInTheDocument();
  });
});
