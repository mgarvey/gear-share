import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CatalogPage from "./CatalogPage";
import CopyGearPage from "./CopyGearPage";
import MyGearPage from "./MyGearPage";
import LoansPage from "./LoansPage";
import ManageGearPage from "./ManageGearPage";
import InventoryPage from "./InventoryPage";
import MembershipAdministration, { JoinQuestionEditor } from "./MembershipAdministration";
import type { Membership, GearItem } from "@/types/gear";

const api = vi.hoisted(() => ({
  fetchCatalog: vi.fn(),
  fetchMyPostalCode: vi.fn(),
  fetchSupplies: vi.fn(),
  fetchWantedListingSeed: vi.fn(),
  getLoanAvailabilitySummary: vi.fn(),
  getSignedImageUrl: vi.fn(),
  requestLoan: vi.fn(),
  fetchLoans: vi.fn(),
  fetchLoanContactDetails: vi.fn(),
  fetchLoanReminders: vi.fn(),
  fetchHandoffCandidates: vi.fn(),
  reassignLoanHandoff: vi.fn(),
  setSupplyNeedsAttention: vi.fn(),
  transitionLoan: vi.fn(),
  fetchPendingMembers: vi.fn(),
  fetchJoinQuestions: vi.fn(),
  fetchMyMembershipApplication: vi.fn(),
  fetchActiveMembers: vi.fn(),
  fetchAiDraftingAvailability: vi.fn(),
  fetchMemberAdministration: vi.fn(),
  fetchReactivationImpact: vi.fn(),
  allowMembershipReapplication: vi.fn(),
  decideMembership: vi.fn(),
  publishJoinQuestions: vi.fn(),
  reactivateMember: vi.fn(),
  sendPreapprovedMemberInvitation: vi.fn(),
  createGroupSupply: vi.fn(),
  createIndividualSupply: vi.fn(),
  createOrResumeGroupDraft: vi.fn(),
  createOrResumeIndividualDraft: vi.fn(),
  convertDonation: vi.fn(),
  convertIndividualDonation: vi.fn(),
  deactivateMember: vi.fn(),
  deleteDeactivatedMember: vi.fn(),
  getDeactivationImpact: vi.fn(),
  reassignGroupCustodian: vi.fn(),
  setSupplyContact: vi.fn(),
  setMyPostalCode: vi.fn(),
  retireSupply: vi.fn(),
  setAccessLevel: vi.fn(),
  updateSupply: vi.fn(),
  uploadGearImage: vi.fn(),
  uploadGearImagesSequential: vi.fn(),
  publishSupplyDraft: vi.fn(),
  setSupplyImageOrder: vi.fn(),
  removeGearImage: vi.fn(),
  draftGearListingsWithAi: vi.fn(),
}));

vi.mock("@/lib/gearShareApi", () => api);
vi.mock("@/lib/safeImage", () => ({
  convertSelectedImage: vi.fn(async (file: File) => ({ blob: file, header: { format: "jpeg", width: 100, height: 100 } })),
}));
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: any) => <select value={value} onChange={(event) => onValueChange(event.target.value)}><option value="">Select</option>{children}</select>,
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectGroup: ({ children }: any) => <>{children}</>,
  SelectItem: ({ value, children }: any) => <option value={value}>{children}</option>,
}));

const member: Membership = {
  id: "10000000-0000-4000-8000-000000000001",
  communityId: "7b000000-0000-4000-8000-000000000001",
  displayName: "Trailblazer Individual",
  status: "active",
  accessLevel: "regular",
};

function workspaceSupply(id: string, overrides: Partial<GearItem> = {}): GearItem {
  return {
    id,
    communityId: member.communityId,
    title: `Group item ${id}`,
    description: "Shared equipment",
    category: "tents-shelters",
    condition: "good",
    ownershipKind: "group",
    ownerId: null,
    ownerIsActive: false,
    custodianId: "steward",
    custodianName: "Coordinator",
    custodianPostalCode: null,
    quantityTotal: 1,
    listingStatus: "listed",
    imagePaths: [],
    ...overrides,
  };
}

function renderWithQuery(ui: React.ReactElement, initialEntries: any[] = ["/"]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={initialEntries}>{ui}</MemoryRouter></QueryClientProvider>);
}

function renderManagement(membership: Membership, supplyId: string, returnTo: unknown = "/my-gear") {
  return renderWithQuery(
    <Routes>
      <Route path="/gear/:supplyId/manage" element={<ManageGearPage membership={membership} />} />
      <Route path="/my-gear" element={<p>Returned to My gear</p>} />
      <Route path="/catalog" element={<p>Returned to Catalog</p>} />
      <Route path="/inventory" element={<InventoryPage membership={membership} />} />
      <Route path="/gear/:supplyId" element={<p>Returned to Gear detail</p>} />
      <Route path="/steward" element={<p>Returned to Coordinator inventory</p>} />
    </Routes>,
    [{ pathname: `/gear/${supplyId}/manage`, state: { returnTo } }],
  );
}

function renderCopy(supplyId: string, returnTo?: unknown) {
  return renderWithQuery(
    <Routes>
      <Route path="/gear/:supplyId/copy" element={<CopyGearPage />} />
      <Route path="/catalog" element={<p>Returned to Catalog</p>} />
      <Route path="/my-gear" element={<p>Created in My gear</p>} />
      <Route path="/gear/:supplyId" element={<p>Returned to Gear detail</p>} />
    </Routes>,
    [{ pathname: `/gear/${supplyId}/copy`, state: returnTo === undefined ? null : { returnTo } }],
  );
}

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="Current route">{location.pathname}{location.search}</output>;
}

describe("gear share ownership and loan workflows", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => `blob:test-${crypto.randomUUID()}`) });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    api.publishSupplyDraft.mockResolvedValue(undefined);
    api.uploadGearImagesSequential.mockResolvedValue([]);
    api.fetchMyPostalCode.mockResolvedValue("");
    api.fetchAiDraftingAvailability.mockResolvedValue(false);
    api.fetchLoanContactDetails.mockResolvedValue(null);
    api.fetchLoanReminders.mockResolvedValue([]);
    api.sendPreapprovedMemberInvitation.mockResolvedValue(undefined);
    api.deleteDeactivatedMember.mockResolvedValue(undefined);
    api.fetchHandoffCandidates.mockResolvedValue([
      { id: "steward", displayName: "Administrator" },
      { id: "custodian", displayName: "Custodian" },
    ]);
    api.fetchJoinQuestions.mockResolvedValue({ communityName: "Gear Share", versionId: "version-1", questions: [] });
    api.fetchMyMembershipApplication.mockResolvedValue(null);
    api.fetchActiveMembers.mockResolvedValue([]);
    api.getSignedImageUrl.mockResolvedValue("blob:test-photo");
    api.fetchCatalog.mockImplementation(async (query) => {
      const all = (await api.fetchSupplies()) ?? [];
      const items = all.filter((item: GearItem) => item.listingStatus === "listed")
        .filter((item: GearItem) => query.category === "all" || item.category === query.category)
        .filter((item: GearItem) => query.ownership === "all" || item.ownershipKind === query.ownership)
        .filter((item: GearItem) => query.condition === "all" || item.condition === query.condition);
      return { items, total: items.length, page: query.page, totalPages: 1 };
    });
  });
  afterEach(() => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
    window.dispatchEvent(new Event("resize"));
  });

  it("clearly distinguishes individual and six-item Group listings", async () => {
    api.fetchSupplies.mockResolvedValue([
      { id: "individual", communityId: member.communityId, title: "Individual stove", description: "Compact stove", category: "camp-kitchen", ownershipKind: "individual", ownerId: member.id, custodianId: member.id, custodianName: "Trailblazer Individual", quantityTotal: 1, listingStatus: "listed", imagePaths: [] },
      { id: "group", communityId: member.communityId, title: "Patrol tents", description: "Matching tents", category: "tents-shelters", ownershipKind: "group", ownerId: null, custodianId: "steward", custodianName: "Gear Steward", quantityTotal: 6, listingStatus: "listed", imagePaths: [] },
    ]);
    renderWithQuery(<CatalogPage membership={member} />);
    expect(await screen.findByText("Member gear")).toBeInTheDocument();
    expect(screen.getByText("Group gear")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Camp Kitchen & Dining" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tents & Shelters" })).toBeInTheDocument();
    expect(screen.getByText("6 total").parentElement).toHaveTextContent("Condition not recorded · 6 total");
    expect(screen.getByRole("link", { name: "Request to borrow" })).toHaveAttribute("href", "/gear/group#request");
    expect(screen.getByRole("link", { name: "View Patrol tents" })).toHaveAttribute("href", "/gear/group");
    expect(screen.getByRole("link", { name: "Edit" })).toHaveAttribute("href", "/gear/individual/manage");
    expect(screen.getAllByRole("link", { name: "Request to borrow" })).toHaveLength(1);
  });

  it("uses the category sidebar to filter the catalog", async () => {
    const user = userEvent.setup();
    api.fetchSupplies.mockResolvedValue([]);
    renderWithQuery(<CatalogPage membership={member} />);
    await user.click(await screen.findByRole("button", { name: "Books & Field Guides" }));
    await waitFor(() => expect(api.fetchCatalog).toHaveBeenLastCalledWith(expect.objectContaining({ category: "books-guides" })));
  });

  it("restores every bounded catalog filter from the URL on a narrow screen", async () => {
    const user = userEvent.setup();
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 375 });
    window.dispatchEvent(new Event("resize"));
    api.fetchCatalog.mockResolvedValue({ items: [], total: 0, page: 3, totalPages: 1 });

    renderWithQuery(<CatalogPage membership={member} />, ["/catalog?q=field+guide&category=books-guides&ownership=group&condition=good&postal=78664&page=3"]);

    await waitFor(() => expect(api.fetchCatalog).toHaveBeenCalledWith({
      search: "field guide",
      category: "books-guides",
      ownership: "group",
      condition: "good",
      postal: "78664",
      startDate: "",
      endDate: "",
      availableOnly: false,
      page: 3,
    }));
    expect(screen.getByLabelText("Search gear")).toHaveValue("field guide");
    expect(screen.queryByRole("navigation", { name: "Quick categories" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear filters" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^Filters/ }));
    expect(screen.getAllByRole("combobox")[0]).toHaveValue("books-guides");
    expect(screen.getByLabelText("ZIP or postal code")).toHaveValue("78664");
  });

  it("shows dated Catalog availability, filters it, and preserves the range in the URL", async () => {
    const user = userEvent.setup();
    const datedItem = workspaceSupply("dated-tents", { title: "Five patrol tents", quantityTotal: 5 });
    api.fetchCatalog.mockImplementation(async (query) => ({
      items: [{ ...datedItem, availableQuantity: query.startDate ? 3 : null }],
      total: 1,
      page: 1,
      totalPages: 1,
    }));

    renderWithQuery(<><CatalogPage membership={member} /><LocationProbe /></>, ["/catalog"]);

    expect(await screen.findByText("5 total")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Available items only" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2099-08-01" } });
    fireEvent.change(screen.getByLabelText("End date"), { target: { value: "2099-08-04" } });
    await user.click(screen.getByRole("button", { name: "Check dates" }));

    await waitFor(() => expect(api.fetchCatalog).toHaveBeenLastCalledWith(expect.objectContaining({ startDate: "2099-08-01", endDate: "2099-08-04", availableOnly: false })));
    expect(await screen.findByText("3 of 5 available")).toBeInTheDocument();
    expect(screen.getByLabelText("Current route")).toHaveTextContent("start=2099-08-01&end=2099-08-04");
    await user.click(screen.getByRole("checkbox", { name: "Available items only" }));
    await waitFor(() => expect(api.fetchCatalog).toHaveBeenLastCalledWith(expect.objectContaining({ availableOnly: true })));
    expect(screen.getByLabelText("Current route")).toHaveTextContent("available=1");
    fireEvent.change(screen.getByLabelText("End date"), { target: { value: "2099-08-05" } });
    expect(screen.getByText(/Results still use Aug 1, 2099–Aug 4, 2099 until updated\./)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Available items only" })).toBeDisabled();
  });

  it("normalizes an emptied catalog page to the server-resolved last page", async () => {
    api.fetchCatalog.mockResolvedValue({ items: [], total: 25, page: 2, totalPages: 2 });
    renderWithQuery(<><CatalogPage membership={member} /><LocationProbe /></>, ["/catalog?page=999"]);

    await waitFor(() => expect(screen.getByLabelText("Current route")).toHaveTextContent("/catalog?page=2"));
    expect(await screen.findByText("Page 2 of 2")).toBeInTheDocument();
  });

  it("limits the individual management view to that individual's own gear", async () => {
    api.fetchSupplies.mockResolvedValue([
      { id: "mine", communityId: member.communityId, title: "Our two pads", description: "Matching pads", category: "sleep-systems", ownershipKind: "individual", ownerId: member.id, custodianId: member.id, custodianName: member.displayName, quantityTotal: 2, listingStatus: "listed", imagePaths: [] },
      { id: "theirs", communityId: member.communityId, title: "Another individual's stove", description: "Private management boundary", category: "camp-kitchen", ownershipKind: "individual", ownerId: "other", custodianId: "other", custodianName: "Other Individual", quantityTotal: 1, listingStatus: "listed", imagePaths: [] },
    ]);

    renderWithQuery(<MyGearPage membership={member} />);

    expect(await screen.findByText("Our two pads")).toBeInTheDocument();
    expect(screen.queryByText("Another individual's stove")).not.toBeInTheDocument();
    expect(screen.getByText("Category:").parentElement).toHaveTextContent("Sleeping Gear");
    expect(screen.queryByText("sleep-systems")).not.toBeInTheDocument();
    expect(screen.getByText("Total quantity:").parentElement).toHaveTextContent("2");
    expect(screen.getByRole("link", { name: "Edit" })).toHaveAttribute("href", "/gear/mine/manage");
  });

  it("confirms removal before taking individual gear out of active inventory", async () => {
    const user = userEvent.setup();
    api.fetchSupplies.mockResolvedValue([{ id: "mine", communityId: member.communityId, title: "Our tent", description: "Individual tent", category: "tents-shelters", ownershipKind: "individual", ownerId: member.id, ownerIsActive: true, custodianId: member.id, custodianName: member.displayName, quantityTotal: 1, listingStatus: "listed", imagePaths: [] }]);
    api.fetchActiveMembers.mockResolvedValue([]);
    api.retireSupply.mockResolvedValue(undefined);

    renderManagement(member, "mine");
    await user.click(await screen.findByRole("button", { name: "Remove from inventory" }));
    expect(screen.getByRole("heading", { name: "Remove Our tent from inventory?" })).toBeInTheDocument();
    expect(screen.getByText(/Past loan history is kept/)).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: "Remove from inventory" }).at(-1)!);

    await waitFor(() => expect(api.retireSupply).toHaveBeenCalledWith("mine"));
  });

  it("uploads an optional photo as part of creating an individual listing", async () => {
    const user = userEvent.setup();
    const created = { id: "created-item", communityId: member.communityId, imagePaths: [] };
    const photo = new File(["photo bytes"], "tent.jpg", { type: "image/jpeg" });
    api.fetchSupplies.mockResolvedValue([]);
    api.createOrResumeIndividualDraft.mockResolvedValue(created);

    renderWithQuery(<MyGearPage membership={member} />);
    await user.click(await screen.findByRole("button", { name: "Add gear" }));
    await user.type(screen.getByLabelText("Name"), "Family tent");
    const createSelects = document.querySelectorAll("select");
    fireEvent.change(createSelects[0], { target: { value: "tents-shelters" } });
    fireEvent.change(createSelects[1], { target: { value: "good" } });
    await user.upload(screen.getByLabelText("Start with photos (optional)"), photo);
    expect(await screen.findByAltText("Prepared tent.jpg")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Publish individual listing" }));

    await waitFor(() => expect(api.createOrResumeIndividualDraft).toHaveBeenCalledWith({
      attemptId: expect.any(String),
      title: "Family tent",
      description: "",
      category: "tents-shelters",
      condition: "good",
      quantity: 1,
      expectedImages: 1,
      borrowingGuidelines: [],
    }));
    expect(api.uploadGearImagesSequential).toHaveBeenCalledWith(created, [expect.objectContaining({ name: "tent.jpg", type: "image/jpeg" })], 0, expect.any(Function), expect.any(Function));
    expect(api.publishSupplyDraft).toHaveBeenCalledWith("created-item", expect.any(String));
  });

  it("puts photo suggestions before the listing details they can fill", async () => {
    api.fetchSupplies.mockResolvedValue([]);
    api.fetchAiDraftingAvailability.mockResolvedValue(true);

    renderWithQuery(<MyGearPage membership={member} />);
    await userEvent.click(await screen.findByRole("button", { name: "Add gear" }));

    const photoField = await screen.findByLabelText("Start with photos (optional)");
    const nameField = screen.getByLabelText("Name");
    expect(photoField.compareDocumentPosition(nameField) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("button", { name: "Suggest listing details" })).toBeDisabled();
  });

  it("uses one add form and reveals only the group-specific pickup contact", async () => {
    const coordinator = { ...member, id: "steward", displayName: "Coordinator", accessLevel: "administrator" as const };
    api.fetchSupplies.mockResolvedValue([]);
    api.fetchActiveMembers.mockResolvedValue([{ id: coordinator.id, display_name: coordinator.displayName, accessLevel: "administrator" as const }]);

    renderWithQuery(<MyGearPage membership={coordinator} />, ["/my-gear?add=1"]);

    expect(await screen.findByText("Who owns this gear?")).toBeInTheDocument();
    expect(screen.queryByText("Pickup contact")).not.toBeInTheDocument();
    fireEvent.change(document.querySelectorAll("select")[0], { target: { value: "group" } });
    expect(await screen.findByText("Pickup contact")).toBeInTheDocument();
    expect(screen.getByLabelText("Start with photos (optional)")).toBeInTheDocument();
  });

  it("routes request entry through each canonical item detail", async () => {
    api.fetchSupplies.mockResolvedValue([
      { id: "six-tents", communityId: member.communityId, title: "Six tents", description: "Group tents", category: "tents-shelters", ownershipKind: "group", ownerId: null, custodianId: "coordinator", custodianName: "Coordinator", quantityTotal: 6, listingStatus: "listed", imagePaths: [] },
      { id: "one-stove", communityId: member.communityId, title: "One stove", description: "Individual stove", category: "camp-kitchen", ownershipKind: "individual", ownerId: "owner", custodianId: "owner", custodianName: "Owner", quantityTotal: 1, listingStatus: "listed", imagePaths: [] },
    ]);

    renderWithQuery(<CatalogPage membership={member} />);
    expect(await screen.findByRole("link", { name: "View Six tents" })).toHaveAttribute("href", "/gear/six-tents");
    expect(screen.getByRole("link", { name: "View One stove" })).toHaveAttribute("href", "/gear/one-stove");
    expect(screen.queryByLabelText("Quantity (of 6)")).not.toBeInTheDocument();
  });

  it("lets members switch between compact grid and list catalog views", async () => {
    const user = userEvent.setup();
    api.fetchSupplies.mockResolvedValue([
      workspaceSupply("tent", { title: "Trail tent", category: "tents-shelters" }),
    ]);

    renderWithQuery(<CatalogPage membership={member} />, ["/catalog"]);

    expect(await screen.findByRole("link", { name: "View Trail tent" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Grid view" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "List view" }));
    expect(screen.getByRole("button", { name: "List view" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("link", { name: "View Trail tent" }).firstElementChild).toHaveClass("aspect-auto", "w-full", "min-w-0");
    await user.click(screen.getByRole("button", { name: "Grid view" }));
    expect(screen.getByRole("button", { name: "Grid view" })).toHaveAttribute("aria-pressed", "true");
  });

  it("offers List a similar item for listed catalog items, including the member's own item", async () => {
    api.fetchSupplies.mockResolvedValue([
      workspaceSupply("mine", { title: "My listed stove", ownershipKind: "individual", ownerId: member.id, ownerIsActive: true, custodianId: member.id, custodianName: member.displayName }),
      workspaceSupply("other", { title: "Another tent", ownershipKind: "individual", ownerId: "other", ownerIsActive: true, custodianId: "other", custodianName: "Other Member" }),
    ]);

    renderWithQuery(<CatalogPage membership={member} />, ["/catalog"]);

    const links = await screen.findAllByRole("link", { name: "List a similar item" });
    expect(links).toHaveLength(2);
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/gear/mine/copy", "/gear/other/copy"]);
  });

  it("preserves the catalog category query through copy cancellation", async () => {
    const user = userEvent.setup();
    const source = workspaceSupply("tents-shelters", { title: "Shelter copy source", category: "tents-shelters" });
    api.fetchSupplies.mockResolvedValue([source, workspaceSupply("camp-kitchen", { title: "Cooking item", category: "camp-kitchen" })]);

    renderWithQuery(
      <Routes>
        <Route path="/catalog" element={<CatalogPage membership={member} />} />
        <Route path="/gear/:supplyId/copy" element={<CopyGearPage />} />
      </Routes>,
      ["/catalog?category=tents-shelters"],
    );

    expect(await screen.findByRole("button", { name: "Tents & Shelters" })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByText("Cooking item")).not.toBeInTheDocument();
    await user.click(await screen.findByRole("link", { name: "List a similar item" }));
    expect(await screen.findByDisplayValue("Shelter copy source")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(await screen.findByRole("button", { name: "Tents & Shelters" })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByText("Cooking item")).not.toBeInTheDocument();
  });

  it("loads a copy source by identifier and publishes only reviewed individual fields", async () => {
    const user = userEvent.setup();
    const source = workspaceSupply("source", {
      title: "Coleman stove",
      description: "Two-burner camp stove",
      category: "camp-kitchen",
      quantityTotal: 6,
      imagePaths: ["community/source/stove.jpg"],
    });
    api.fetchSupplies.mockResolvedValue([source]);
    api.createOrResumeIndividualDraft.mockResolvedValue({ id: "copy", communityId: member.communityId, imagePaths: [] });

    renderCopy(source.id, "/catalog");

    expect(await screen.findByLabelText("Name")).toHaveValue("Coleman stove");
    expect(screen.getByLabelText("Description")).toHaveValue("Two-burner camp stove");
    expect(screen.getByLabelText("Identical quantity")).toHaveValue(1);
    expect(screen.getByLabelText("Identical quantity")).toBeDisabled();
    expect(screen.getByText(/Photos, quantity, owner, pickup contact, availability, and loan history were not copied/i)).toBeInTheDocument();
    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "Our Coleman stove");
    const copySelects = document.querySelectorAll("select");
    fireEvent.change(copySelects[1], { target: { value: "good" } });
    await user.click(screen.getByRole("button", { name: "Publish individual listing" }));

    await waitFor(() => expect(api.createOrResumeIndividualDraft).toHaveBeenCalledWith({
      attemptId: expect.any(String),
      title: "Our Coleman stove",
      description: "Two-burner camp stove",
      category: "camp-kitchen",
      condition: "good",
      quantity: 1,
      expectedImages: 0,
      borrowingGuidelines: [],
    }));
    expect(api.uploadGearImagesSequential).not.toHaveBeenCalled();
    expect(api.publishSupplyDraft).toHaveBeenCalledWith("copy", expect.any(String));
    expect(await screen.findByText("Created in My gear")).toBeInTheDocument();
  });

  it("creates nothing when a copy is cancelled and reloads its source without router data", async () => {
    const user = userEvent.setup();
    const source = workspaceSupply("reload-source", { title: "Reloaded tent", description: "Fresh from the authorized query" });
    api.fetchSupplies.mockResolvedValue([source]);

    renderCopy(source.id);
    expect(await screen.findByDisplayValue("Reloaded tent")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(api.createOrResumeIndividualDraft).not.toHaveBeenCalled();
    expect(api.uploadGearImagesSequential).not.toHaveBeenCalled();
    expect(await screen.findByText("Returned to Catalog")).toBeInTheDocument();
  });

  it("returns a cancelled copy to the canonical gear detail that opened it", async () => {
    const user = userEvent.setup();
    const source = workspaceSupply("detail-copy", { title: "Detail source" });
    api.fetchSupplies.mockResolvedValue([source]);

    renderCopy(source.id, `/gear/${source.id}`);
    expect(await screen.findByDisplayValue("Detail source")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(await screen.findByText("Returned to Gear detail")).toBeInTheDocument();
  });

  it("does not prefill a missing, unlisted, or removed copy source", async () => {
    const user = userEvent.setup();
    api.fetchSupplies.mockResolvedValue([workspaceSupply("unlisted", { title: "Protected draft title", listingStatus: "unlisted" })]);

    renderCopy("unlisted", "/catalog");
    expect(await screen.findByRole("heading", { name: "Similar-item source unavailable" })).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Protected draft title")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Start blank listing" }));
    expect(screen.getByLabelText("Name")).toHaveValue("");
    expect(api.createOrResumeIndividualDraft).not.toHaveBeenCalled();
    expect(api.uploadGearImagesSequential).not.toHaveBeenCalled();
  });

  it("shows only borrower actions valid for a pending request", async () => {
    api.fetchLoans.mockResolvedValue([{ id: "loan-1", supplyId: "group", supplyTitle: "Patrol tents", ownershipKind: "group", currentCustodianId: "steward", currentCustodianName: "Current Custodian", borrowerId: member.id, borrowerName: member.displayName, custodianAtRequestId: "steward", quantity: 2, startDate: "2026-09-04", endDate: "2026-09-06", status: "pending", borrowerNote: null }]);
    renderWithQuery(<LoansPage membership={member} />);
    expect(await screen.findByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Record checkout" })).not.toBeInTheDocument();
  });

  it("lets members switch between loan grid and list layouts", async () => {
    const user = userEvent.setup();
    api.fetchLoans.mockResolvedValue([{ id: "loan-layout", supplyId: "group", supplyTitle: "Layout tent", ownershipKind: "group", currentCustodianId: "steward", currentCustodianName: "Current Custodian", borrowerId: member.id, borrowerName: member.displayName, custodianAtRequestId: "steward", quantity: 1, startDate: "2026-09-04", endDate: "2026-09-06", status: "pending", borrowerNote: null }]);

    renderWithQuery(<LoansPage membership={member} />);

    const loanList = await screen.findByRole("list", { name: "My borrowing loans" });
    expect(screen.getByRole("button", { name: "Grid view" })).toHaveAttribute("aria-pressed", "true");
    expect(loanList).toHaveAttribute("data-layout", "grid");
    await user.click(screen.getByRole("button", { name: "List view" }));
    expect(screen.getByRole("button", { name: "List view" })).toHaveAttribute("aria-pressed", "true");
    expect(loanList).toHaveAttribute("data-layout", "list");
  });

  it("shows private coordination details only when the server returns an approved-loan relationship", async () => {
    api.fetchLoans.mockResolvedValue([{ id: "approved-contact", supplyId: "group", supplyTitle: "Pickup tent", ownershipKind: "group", currentCustodianId: "custodian", currentCustodianName: "Current Custodian", borrowerId: member.id, borrowerName: member.displayName, custodianAtRequestId: "custodian", quantity: 1, startDate: "2026-09-04", endDate: "2026-09-06", status: "approved", borrowerNote: null, acceptedGuidelines: ["Return the item clean and dry."] }]);
    api.fetchLoanContactDetails.mockResolvedValue({ displayName: "Handoff Member", email: "handoff@example.test", phoneE164: "+15125550122", coordinationNote: "Text after 5 PM" });

    renderWithQuery(<LoansPage membership={member} />);

    expect(await screen.findByText("Pickup and return contact: Handoff Member")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "handoff@example.test" })).toHaveAttribute("href", "mailto:handoff@example.test");
    expect(screen.getByRole("link", { name: "(512) 555-0122" })).toHaveAttribute("href", "tel:+15125550122");
    expect(screen.getByText("Text after 5 PM")).toBeInTheDocument();
    expect(screen.queryByText("Saved when the request was made.")).not.toBeInTheDocument();
    expect(screen.queryByText(/Only the borrower and pickup contact can see these details/)).not.toBeInTheDocument();
  });

  it("labels the borrower clearly for the active handoff contact", async () => {
    const custodian = { ...member, id: "custodian", accessLevel: "custodian" as const };
    api.fetchLoans.mockResolvedValue([{ id: "checked-out-contact", supplyId: "group", supplyTitle: "Checked out tent", ownershipKind: "group", currentCustodianId: custodian.id, currentCustodianName: custodian.displayName, borrowerId: "borrower", borrowerName: "Mark Test", custodianAtRequestId: custodian.id, handoffContactId: custodian.id, handoffContactName: custodian.displayName, quantity: 1, startDate: "2026-09-04", endDate: "2026-09-06", status: "checked_out", borrowerNote: null }]);
    api.fetchLoanContactDetails.mockResolvedValue({ displayName: "Mark Test", email: "mark@example.test", phoneE164: "+15125550123", coordinationNote: "" });

    renderWithQuery(<LoansPage membership={custodian} />);

    expect(await screen.findByText("Borrower contact: Mark Test")).toBeInTheDocument();
    expect(screen.queryByText("Pickup and return contact: Mark Test")).not.toBeInTheDocument();
  });

  it("shows only the current member's bounded due and overdue reminder notices", async () => {
    api.fetchLoans.mockResolvedValue([]);
    api.fetchLoanReminders.mockResolvedValue([
      { id: "reminder-1", loanId: "loan-1", supplyTitle: "Patrol tents", kind: "weekly_overdue", ordinal: 2, endDate: "2026-09-06", dueAt: "2026-09-07T05:00:00Z", occurredAt: "2026-09-21T05:00:00Z" },
    ]);

    renderWithQuery(<LoansPage membership={member} />);

    expect(await screen.findByRole("heading", { name: "Due and overdue reminders" })).toBeInTheDocument();
    expect(screen.getByText(/Weekly overdue reminder 2 of 3/)).toBeInTheDocument();
    expect(screen.getByText(/return date 2026-09-06/)).toBeInTheDocument();
  });

  it("keeps held gear visible while removing only approval and checkout actions", async () => {
    const administrator = { ...member, id: "steward", accessLevel: "administrator" as const };
    api.fetchLoans.mockResolvedValue([
      { id: "held-pending", supplyId: "tent", supplyTitle: "Held tent", ownershipKind: "group", currentCustodianId: "stored", currentCustodianName: "Stored Member", borrowerId: "borrower", borrowerName: "Borrower", custodianAtRequestId: "stored", quantity: 1, startDate: "2026-09-04", endDate: "2026-09-06", status: "pending", borrowerNote: null, needsAttention: true, needsAttentionReason: "Inspect seam" },
      { id: "held-checked", supplyId: "stove", supplyTitle: "Held checked-out stove", ownershipKind: "group", currentCustodianId: "stored", currentCustodianName: "Stored Member", borrowerId: "borrower", borrowerName: "Borrower", custodianAtRequestId: "stored", quantity: 1, startDate: "2026-09-04", endDate: "2026-09-06", status: "checked_out", borrowerNote: null, needsAttention: true, needsAttentionReason: "Inspect valve" },
    ]);

    renderWithQuery(<LoansPage membership={administrator} />);

    expect(await screen.findByText("Held tent")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Record checkout" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Record return" })).toBeInTheDocument();
    expect(screen.getAllByText(/Needs Attention:/)).toHaveLength(2);
  });

  it("keeps terminal borrowing records out of active requests", async () => {
    api.fetchLoans.mockResolvedValue([
      { id: "active-borrowing", supplyId: "tent", supplyTitle: "Pending tent", ownershipKind: "group", currentCustodianId: "custodian", currentCustodianName: "Custodian", borrowerId: member.id, borrowerName: member.displayName, custodianAtRequestId: "custodian", quantity: 1, startDate: "2026-09-04", endDate: "2026-09-06", status: "pending", borrowerNote: null },
      { id: "past-borrowing", supplyId: "stove", supplyTitle: "Returned stove", ownershipKind: "group", currentCustodianId: "custodian", currentCustodianName: "Custodian", borrowerId: member.id, borrowerName: member.displayName, custodianAtRequestId: "custodian", quantity: 1, startDate: "2026-08-01", endDate: "2026-08-02", status: "returned", borrowerNote: null, acceptedGuidelines: ["Historical guideline"] },
    ]);

    renderWithQuery(<LoansPage membership={member} />);

    expect(await screen.findByText("Pending tent")).toBeInTheDocument();
    expect(screen.queryByText("Returned stove")).not.toBeInTheDocument();
    const historyTab = screen.getByRole("tab", { name: "History (1)" });
    await userEvent.click(historyTab);
    expect(await screen.findByText("Returned stove")).toBeInTheDocument();
    expect(screen.queryByText("Guidelines agreed to for this loan")).not.toBeInTheDocument();
    expect(screen.queryByText("Historical guideline")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Record return" })).not.toBeInTheDocument();
  });

  it("lets a steward administer a pending Group request", async () => {
    api.fetchLoans.mockResolvedValue([{ id: "loan-2", supplyId: "group", supplyTitle: "Patrol tents", ownershipKind: "group", currentCustodianId: "custodian", currentCustodianName: "Current Custodian", borrowerId: "borrower", borrowerName: "Requesting Member", custodianAtRequestId: "custodian", quantity: 2, startDate: "2026-09-04", endDate: "2026-09-06", status: "pending", borrowerNote: null }]);
    renderWithQuery(<LoansPage membership={{ ...member, id: "steward", accessLevel: "administrator" as const }} />);
    expect(await screen.findByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Decline" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.getAllByText("Group-owned").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Current Custodian/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Requesting Member/)).toBeInTheDocument();
  });

  it("keeps actionable group states in the Custodian workspace and terminal states in history", async () => {
    const custodian = { ...member, id: "custodian", accessLevel: "custodian" as const };
    const loanFor = (id: string, status: string) => ({ id, supplyId: id, supplyTitle: `${status} item`, ownershipKind: "group", currentCustodianId: custodian.id, currentCustodianName: "Custodian", borrowerId: "borrower", borrowerName: "Borrower", custodianAtRequestId: custodian.id, quantity: 1, startDate: "2026-09-04", endDate: "2026-09-06", status, borrowerNote: null });
    api.fetchLoans.mockResolvedValue([
      loanFor("pending", "pending"), loanFor("approved", "approved"), loanFor("checked", "checked_out"),
      loanFor("returned", "returned"), loanFor("declined", "declined"), loanFor("cancelled", "cancelled"),
    ]);

    renderWithQuery(<LoansPage membership={custodian} />);

    expect(await screen.findByText("pending item")).toBeInTheDocument();
    expect(screen.getByText("approved item")).toBeInTheDocument();
    expect(screen.getByText("checked_out item")).toBeInTheDocument();
    expect(screen.queryByText("returned item")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Record checkout" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Record return" })).toBeInTheDocument();

    const historyTab = screen.getByRole("tab", { name: "History (3)" });
    expect(historyTab).toHaveAttribute("aria-selected", "false");
    await userEvent.click(historyTab);
    expect(historyTab).toHaveAttribute("aria-selected", "true");
    for (const title of ["returned item", "declined item", "cancelled item"]) {
      const card = screen.getByText(title).closest("[class*='rounded-lg']");
      expect(card).not.toBeNull();
      expect(within(card as HTMLElement).queryByRole("button")).not.toBeInTheDocument();
    }
  });

  it("moves a returned group loan from active work to read-only history after refresh", async () => {
    const user = userEvent.setup();
    const custodian = { ...member, id: "custodian", accessLevel: "custodian" as const };
    const checkedOut = { id: "returning", supplyId: "stove", supplyTitle: "Returning stove", ownershipKind: "group", currentCustodianId: custodian.id, currentCustodianName: "Custodian", borrowerId: "borrower", borrowerName: "Borrower", custodianAtRequestId: custodian.id, quantity: 1, startDate: "2026-09-04", endDate: "2026-09-06", status: "checked_out", borrowerNote: null };
    api.fetchLoans.mockResolvedValueOnce([checkedOut]).mockResolvedValueOnce([{ ...checkedOut, status: "returned" }]);
    api.fetchLoanContactDetails.mockResolvedValue({ displayName: "Private Handoff", email: "private@example.test", phoneE164: "", coordinationNote: "" });
    api.transitionLoan.mockResolvedValue(undefined);

    renderWithQuery(<LoansPage membership={custodian} />);
    expect(await screen.findByText("Borrower contact: Private Handoff")).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Record return" }));
    await user.click(screen.getByRole("button", { name: "Confirm return" }));

    await waitFor(() => expect(api.fetchLoans).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("Borrower contact: Private Handoff")).not.toBeInTheDocument();
    expect(await screen.findByText("No active loan work")).toBeInTheDocument();
    expect(screen.queryByText("Returning stove")).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "History (1)" }));
    expect(await screen.findByText("Returning stove")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Record return" })).not.toBeInTheDocument();
  });

  it("requires explicit return confirmation and passes an optional hold reason atomically", async () => {
    const user = userEvent.setup();
    const custodian = { ...member, id: "custodian", accessLevel: "custodian" as const };
    api.fetchLoans.mockResolvedValue([{ id: "return-attention", supplyId: "stove", supplyTitle: "Camp stove", ownershipKind: "group", currentCustodianId: custodian.id, currentCustodianName: "Custodian", borrowerId: "borrower", borrowerName: "Borrower", custodianAtRequestId: custodian.id, quantity: 1, startDate: "2026-09-04", endDate: "2026-09-06", status: "checked_out", borrowerNote: null }]);
    api.transitionLoan.mockResolvedValue(undefined);

    renderWithQuery(<LoansPage membership={custodian} />);
    await user.click(await screen.findByRole("button", { name: "Record return" }));
    await user.click(screen.getByLabelText("Mark this gear Needs Attention in the same return transaction"));
    await user.type(screen.getByLabelText("Inspection or repair concern"), "Fuel line needs inspection");
    await user.click(screen.getByRole("button", { name: "Confirm return" }));

    expect(api.transitionLoan).toHaveBeenCalledWith("return", "return-attention", expect.objectContaining({ markNeedsAttention: true, attentionReason: "Fuel line needs inspection" }));
  });

  it("preserves an existing hold without offering a redundant return-time hold change", async () => {
    const user = userEvent.setup();
    const custodian = { ...member, id: "custodian", accessLevel: "custodian" as const };
    api.fetchLoans.mockResolvedValue([{ id: "return-held", supplyId: "stove", supplyTitle: "Held stove", ownershipKind: "group", currentCustodianId: custodian.id, currentCustodianName: "Custodian", borrowerId: "borrower", borrowerName: "Borrower", custodianAtRequestId: custodian.id, quantity: 1, startDate: "2026-09-04", endDate: "2026-09-06", status: "checked_out", borrowerNote: null, needsAttention: true, needsAttentionReason: "Inspect valve" }]);

    renderWithQuery(<LoansPage membership={custodian} />);
    await user.click(await screen.findByRole("button", { name: "Record return" }));

    expect(screen.getByText(/already Needs Attention/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Mark this gear Needs Attention in the same return transaction")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm return" })).toBeEnabled();
  });

  it("lets the recorded group handoff reassign coordination to an authorized candidate", async () => {
    const user = userEvent.setup();
    api.fetchHandoffCandidates.mockResolvedValue([
      { id: "current-handoff", displayName: "Current Handoff" },
      { id: "next-handoff", displayName: "Next Handoff" },
    ]);
    api.fetchLoans.mockResolvedValue([{ id: "handoff-loan", supplyId: "tent", supplyTitle: "Handoff tent", ownershipKind: "group", currentCustodianId: "stored", currentCustodianName: "Stored Member", borrowerId: "borrower", borrowerName: "Borrower", custodianAtRequestId: "stored", quantity: 1, startDate: "2026-09-04", endDate: "2026-09-06", status: "approved", borrowerNote: null, handoffContactId: "current-handoff", handoffContactName: "Current Handoff" }]);
    api.reassignLoanHandoff.mockResolvedValue(undefined);

    renderWithQuery(<LoansPage membership={{ ...member, id: "current-handoff", accessLevel: "custodian" }} />);
    expect((await screen.findAllByText("Current Handoff")).length).toBeGreaterThan(0);
    await waitFor(() => expect(api.fetchHandoffCandidates).toHaveBeenCalledWith("handoff-loan"));
    await user.selectOptions(await screen.findByRole("combobox"), "next-handoff");
    await user.click(screen.getByRole("button", { name: "Reassign handoff" }));

    expect(api.reassignLoanHandoff).toHaveBeenCalledWith("handoff-loan", "next-handoff");
  });

  it("preserves the recorded handoff as an Administrator's default selection", async () => {
    api.fetchHandoffCandidates.mockResolvedValue([
      { id: "administrator", displayName: "Administrator" },
      { id: "recorded-handoff", displayName: "Recorded Handoff" },
    ]);
    api.fetchLoans.mockResolvedValue([{ id: "admin-handoff-loan", supplyId: "tent", supplyTitle: "Handoff tent", ownershipKind: "group", currentCustodianId: "stored", currentCustodianName: "Stored Member", borrowerId: "borrower", borrowerName: "Borrower", custodianAtRequestId: "stored", quantity: 1, startDate: "2026-09-04", endDate: "2026-09-06", status: "approved", borrowerNote: null, handoffContactId: "recorded-handoff", handoffContactName: "Recorded Handoff" }]);

    renderWithQuery(<LoansPage membership={{ ...member, id: "administrator", accessLevel: "administrator" }} />);

    expect(await screen.findByRole("combobox")).toHaveValue("recorded-handoff");
  });

  it("does not offer approved-loan handoff reassignment to an unrelated Custodian", async () => {
    const custodian = { ...member, id: "unrelated-custodian", accessLevel: "custodian" as const };
    api.fetchLoans.mockResolvedValue([{ id: "other-handoff-loan", supplyId: "tent", supplyTitle: "Other handoff tent", ownershipKind: "group", currentCustodianId: custodian.id, currentCustodianName: "Stored Member", borrowerId: "borrower", borrowerName: "Borrower", custodianAtRequestId: custodian.id, quantity: 1, startDate: "2026-09-04", endDate: "2026-09-06", status: "approved", borrowerNote: null, handoffContactId: "recorded-handoff", handoffContactName: "Recorded Handoff" }]);

    renderWithQuery(<LoansPage membership={custodian} />);

    expect(await screen.findByText("Other handoff tent")).toBeInTheDocument();
    expect(api.fetchHandoffCandidates).not.toHaveBeenCalled();
    expect(screen.queryByText("Reassign pickup and return handoff")).not.toBeInTheDocument();
  });

  it("shows a coordinator's own request once with both borrower and manager actions", async () => {
    const coordinator = { ...member, id: "coordinator", accessLevel: "administrator" as const };
    api.fetchLoans.mockResolvedValue([{ id: "own-group-request", supplyId: "tent", supplyTitle: "Borrowed group tent", ownershipKind: "group", currentCustodianId: "other-manager", currentCustodianName: "Other Manager", borrowerId: coordinator.id, borrowerName: "Coordinator", custodianAtRequestId: "other-manager", quantity: 1, startDate: "2026-09-04", endDate: "2026-09-06", status: "pending", borrowerNote: null }]);

    renderWithQuery(<LoansPage membership={coordinator} />);

    expect(await screen.findByText("Borrowed group tent")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled());
    expect(screen.queryByRole("heading", { name: "Group-owned loan work" })).not.toBeInTheDocument();
  });

  it("uses keyboard-operable Active and History tabs with one empty state per mode", async () => {
    const user = userEvent.setup();
    api.fetchLoans.mockResolvedValue([]);

    renderWithQuery(
      <LoansPage
        membership={{ ...member, accessLevel: "administrator" as const }}
      />,
    );

    expect(await screen.findByText("No active loan work")).toBeInTheDocument();
    expect(screen.getAllByText("No active loan work")).toHaveLength(1);
    const activeTab = screen.getByRole("tab", { name: "Active (0)" });
    activeTab.focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "History (0)" })).toHaveFocus();
    expect(await screen.findByText("No loan history yet")).toBeInTheDocument();
    expect(screen.getAllByText("No loan history yet")).toHaveLength(1);
  });

  it("shows the authoritative current custodian before reassignment", async () => {
    const steward = { ...member, id: "steward", displayName: "Acting Steward", accessLevel: "administrator" as const };
    api.fetchPendingMembers.mockResolvedValue([]);
    api.fetchActiveMembers.mockResolvedValue([
      { id: "steward", display_name: "Acting Steward" },
      { id: "current-custodian", display_name: "Current Custodian" },
    ]);
    api.fetchMemberAdministration.mockResolvedValue([]);
    api.fetchSupplies.mockResolvedValue([{ id: "group-item", communityId: member.communityId, title: "Group stove", description: "Shared", category: "camp-kitchen", ownershipKind: "group", ownerId: null, ownerIsActive: false, custodianId: "current-custodian", custodianName: "Current Custodian", quantityTotal: 2, listingStatus: "listed", imagePaths: [] }]);

    renderWithQuery(<MembershipAdministration membership={steward} />);

    expect(await screen.findByText("Pickup contact: Current Custodian")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Edit" })).toHaveAttribute("href", "/gear/group-item/manage");
  });

  it("renders retired individual gear as history without impossible controls", async () => {
    api.fetchSupplies.mockResolvedValue([{ id: "retired", communityId: member.communityId, title: "Retired tent", description: "History", category: "tents-shelters", ownershipKind: "individual", ownerId: member.id, ownerIsActive: true, custodianId: member.id, custodianName: member.displayName, quantityTotal: 1, listingStatus: "retired", imagePaths: [] }]);

    renderWithQuery(<MyGearPage membership={member} />);

    expect(await screen.findByRole("button", { name: "Show removed history (1)" })).toBeInTheDocument();
    expect(screen.queryByText(/removed from active inventory permanently/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Show removed history (1)" }));
    expect(await screen.findByText(/removed from active inventory permanently/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove from inventory" })).not.toBeInTheDocument();
  });

  it("refreshes status after approval without any email-service credential", async () => {
    const user = userEvent.setup();
    const pendingLoan = { id: "loan-refresh", supplyId: "group", supplyTitle: "Refresh tents", ownershipKind: "group", currentCustodianId: "steward", currentCustodianName: "Current Custodian", borrowerId: "borrower", borrowerName: "Requesting Member", custodianAtRequestId: "steward", quantity: 2, startDate: "2026-09-04", endDate: "2026-09-06", status: "pending", borrowerNote: null };
    api.fetchLoans
      .mockResolvedValueOnce([pendingLoan])
      .mockResolvedValueOnce([{ ...pendingLoan, status: "approved" }]);
    api.transitionLoan.mockResolvedValue(undefined);

    renderWithQuery(<LoansPage membership={{ ...member, id: "steward", accessLevel: "administrator" as const }} />);
    await user.click(await screen.findByRole("button", { name: "Approve" }));

    await waitFor(() => expect(api.fetchLoans).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("button", { name: "Record checkout" })).toBeInTheDocument();
    expect(api.transitionLoan).toHaveBeenCalledWith("approve", "loan-refresh", expect.objectContaining({ handoffContactId: "steward" }));
  });

  it("lets a gear manager process their own Group gear request", async () => {
    const user = userEvent.setup();
    const manager = {
      ...member,
      id: "manager-borrower",
      displayName: "Gear Manager",
      accessLevel: "custodian" as const,
    };
    const pendingLoan = {
      id: "manager-self-loan",
      supplyId: "group",
      supplyTitle: "Group cook kit",
      ownershipKind: "group",
      currentCustodianId: manager.id,
      currentCustodianName: manager.displayName,
      borrowerId: manager.id,
      borrowerName: manager.displayName,
      custodianAtRequestId: manager.id,
      quantity: 1,
      startDate: "2026-09-04",
      endDate: "2026-09-06",
      status: "pending",
      borrowerNote: null,
    };
    api.fetchLoans.mockResolvedValue([pendingLoan]);
    api.fetchHandoffCandidates.mockResolvedValue([
      { id: manager.id, displayName: manager.displayName },
    ]);
    api.transitionLoan.mockResolvedValue(undefined);

    renderWithQuery(<LoansPage membership={manager} />);

    expect(await screen.findByRole("heading", { name: "My borrowing" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled());
    expect(screen.getByRole("button", { name: "Decline" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(api.transitionLoan).toHaveBeenCalledWith(
      "approve",
      "manager-self-loan",
      expect.objectContaining({ handoffContactId: manager.id }),
    ));
  });

  it("does not derive group-loan access from the Stored with contact", async () => {
    api.fetchLoans.mockResolvedValue([{ id: "loan-reassigned", supplyId: "group", supplyTitle: "Reassigned stove", ownershipKind: "group", currentCustodianId: "new-custodian", currentCustodianName: "Current Custodian", borrowerId: "borrower", borrowerName: "Requesting Member", custodianAtRequestId: "old-custodian", quantity: 1, startDate: "2026-10-01", endDate: "2026-10-02", status: "approved", borrowerNote: null }]);

    const formerView = renderWithQuery(<LoansPage membership={{ ...member, id: "old-custodian" }} />);
    await waitFor(() => expect(api.fetchLoans).toHaveBeenCalled());
    expect(screen.queryByText("Reassigned stove")).not.toBeInTheDocument();
    formerView.unmount();

    renderWithQuery(<LoansPage membership={{ ...member, id: "new-custodian" }} />);
    await waitFor(() => expect(api.fetchLoans).toHaveBeenCalled());
    expect(screen.queryByText("Reassigned stove")).not.toBeInTheDocument();
  });

  it("shows capacity-conflict feedback and leaves the request actionable", async () => {
    const user = userEvent.setup();
    api.fetchLoans.mockResolvedValue([{ id: "loan-conflict", supplyId: "group", supplyTitle: "Contested tents", ownershipKind: "group", currentCustodianId: "steward", currentCustodianName: "Current Custodian", borrowerId: "borrower", borrowerName: "Requesting Member", custodianAtRequestId: "steward", quantity: 4, startDate: "2026-09-04", endDate: "2026-09-06", status: "pending", borrowerNote: null }]);
    api.transitionLoan.mockRejectedValue(new Error("insufficient date-sensitive availability"));

    renderWithQuery(<LoansPage membership={{ ...member, id: "steward", accessLevel: "administrator" as const }} />);
    await user.click(await screen.findByRole("button", { name: "Approve" }));

    expect(await screen.findByText("insufficient date-sensitive availability")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled();
  });

  it("does not offer relisting for inactive-owner individual gear", async () => {
    const user = userEvent.setup();
    const steward = { ...member, id: "steward", displayName: "Successor Steward", accessLevel: "administrator" as const };
    api.fetchPendingMembers.mockResolvedValue([]);
    api.fetchActiveMembers.mockResolvedValue([{ id: steward.id, display_name: steward.displayName, accessLevel: "administrator" as const }]);
    api.fetchMemberAdministration.mockResolvedValue([{ id: steward.id, display_name: steward.displayName, accessLevel: "administrator" as const }]);
    api.fetchSupplies.mockResolvedValue([{
      id: "inactive-individual",
      communityId: member.communityId,
      title: "Inactive individual stove",
      description: "Awaiting donation or retirement",
      category: "camp-kitchen",
      ownershipKind: "individual",
      ownerId: "inactive-owner",
      ownerIsActive: false,
      custodianId: steward.id,
      custodianName: steward.displayName,
      quantityTotal: 1,
      listingStatus: "unlisted",
      imagePaths: [],
    }]);
    api.convertIndividualDonation.mockResolvedValue(undefined);

    renderManagement(steward, "inactive-individual", "/manage?view=inventory");

    expect(await screen.findByRole("button", { name: "Remove inactive member listing" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review group donation" })).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Inactive individual stove")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Publish in catalog" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Review group donation" }));
    await user.click(await screen.findByRole("button", { name: "Confirm donation" }));
    await waitFor(() => expect(api.convertIndividualDonation).toHaveBeenCalledWith("inactive-individual", steward.id));
  });

  it("does not surface management merely because group gear is Stored with a Regular user", async () => {
    api.fetchSupplies.mockResolvedValue([{
      id: "managed-group", communityId: member.communityId, title: "Managed tents", description: "Group tents", category: "tents-shelters",
      ownershipKind: "group", ownerId: null, ownerIsActive: false, custodianId: member.id, custodianName: member.displayName,
      quantityTotal: 6, listingStatus: "listed", imagePaths: [],
    }]);

    const catalog = renderWithQuery(<CatalogPage membership={member} />, ["/catalog"]);
    expect(await screen.findByText("Managed tents")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Manage availability" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View Managed tents" })).toBeInTheDocument();
    catalog.unmount();

    renderWithQuery(<MyGearPage membership={member} />, ["/my-gear"]);
    await waitFor(() => expect(api.fetchSupplies).toHaveBeenCalled());
    expect(screen.queryByText("Managed tents")).not.toBeInTheDocument();
  });

  it("gives a global Custodian the canonical full group editor", async () => {
    const custodian = { ...member, accessLevel: "custodian" as const };
    api.fetchSupplies.mockResolvedValue([{
      id: "managed-group", communityId: member.communityId, title: "Managed tents", description: "Group tents", category: "tents-shelters",
      ownershipKind: "group", ownerId: null, ownerIsActive: false, custodianId: member.id, custodianName: member.displayName,
      quantityTotal: 6, listingStatus: "listed", imagePaths: [],
    }]);
    renderManagement(custodian, "managed-group");
    expect(await screen.findByRole("heading", { name: "Edit Managed tents" })).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    expect(screen.getByLabelText("Add photos")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hide from catalog" })).toBeInTheDocument();
  });

  it("does not surface inventory management for an unrelated member", async () => {
    api.fetchSupplies.mockResolvedValue([{
      id: "unrelated", communityId: member.communityId, title: "Another member's stove", description: "Private", category: "camp-kitchen",
      ownershipKind: "individual", ownerId: "owner", ownerIsActive: true, custodianId: "owner", custodianName: "Owner",
      quantityTotal: 1, listingStatus: "listed", imagePaths: [],
    }]);

    renderWithQuery(<CatalogPage membership={member} />, ["/catalog"]);
    expect(await screen.findByRole("link", { name: "View Another member's stove" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Manage availability" })).not.toBeInTheDocument();
  });

  it("lets a coordinator edit another active individual's details but not availability or removal", async () => {
    const user = userEvent.setup();
    const coordinator = { ...member, id: "coordinator", displayName: "Coordinator", accessLevel: "administrator" as const };
    api.fetchActiveMembers.mockResolvedValue([{ id: coordinator.id, display_name: coordinator.displayName }]);
    api.fetchSupplies.mockResolvedValue([{
      id: "active-individual", communityId: member.communityId, title: "Owner tent", description: "Original", category: "tents-shelters",
      ownershipKind: "individual", ownerId: "owner", ownerIsActive: true, custodianId: "owner", custodianName: "Owner",
      quantityTotal: 1, listingStatus: "listed", imagePaths: ["community/active-individual/original.jpg"],
    }]);
    api.getSignedImageUrl.mockResolvedValue("https://signed.invalid/photo");
    api.removeGearImage.mockResolvedValue(undefined);

    renderManagement(coordinator, "active-individual", "/catalog");
    expect(await screen.findByDisplayValue("Owner tent")).toBeInTheDocument();
    expect(screen.getByLabelText("Add photos")).toBeInTheDocument();
    expect(screen.getByText("The individual owner controls whether this item appears in the catalog.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Hide from catalog" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove from inventory" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review group donation" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove photo" }));
    await waitFor(() => expect(api.removeGearImage).toHaveBeenCalledWith(expect.objectContaining({ id: "active-individual" }), "community/active-individual/original.jpg"));
    const photo = new File(["photo"], "owner-tent.jpg", { type: "image/jpeg" });
    await user.upload(screen.getByLabelText("Add photos"), photo);
    expect(await screen.findByAltText("Prepared owner-tent.jpg")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add photos" }));
    await waitFor(() => expect(api.uploadGearImagesSequential).toHaveBeenCalledWith(expect.objectContaining({ id: "active-individual" }), [expect.objectContaining({ name: "owner-tent.jpg" })], 1, expect.any(Function), expect.any(Function)));
  });

  it("keeps ordinary Stored with editing independent from donation confirmation and returns after save", async () => {
    const user = userEvent.setup();
    const coordinator = { ...member, id: "coordinator", displayName: "Coordinator", accessLevel: "administrator" as const };
    api.fetchActiveMembers.mockResolvedValue([
      { id: "owner", display_name: "Owner" },
      { id: "storage-contact", display_name: "Storage Contact" },
      { id: "donation-contact", display_name: "Donation Contact" },
    ]);
    api.fetchSupplies.mockResolvedValue([{
      id: "donation-item", communityId: member.communityId, title: "Donation tent", description: "Original", category: "tents-shelters", condition: "good",
      ownershipKind: "individual", ownerId: "owner", ownerIsActive: true, custodianId: "owner", custodianName: "Owner",
      quantityTotal: 1, listingStatus: "listed", imagePaths: [],
    }]);
    api.updateSupply.mockResolvedValue(undefined);
    api.setSupplyContact.mockResolvedValue(undefined);
    api.convertIndividualDonation.mockResolvedValue(undefined);

    renderManagement(coordinator, "donation-item", "/catalog");
    expect(await screen.findByDisplayValue("Donation tent")).toBeInTheDocument();
    expect(await screen.findAllByRole("option", { name: "Donation Contact" })).toHaveLength(2);
    const selects = document.querySelectorAll("select");
    fireEvent.change(selects.item(2), { target: { value: "storage-contact" } });
    fireEvent.change(selects.item(3), { target: { value: "donation-contact" } });
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(api.setSupplyContact).toHaveBeenCalledWith("donation-item", "storage-contact"));
    expect(await screen.findByText("Returned to Catalog")).toBeInTheDocument();
    expect(api.convertIndividualDonation).not.toHaveBeenCalled();
  });

  it("preserves unsaved editor fields when a photo refreshes the same item", async () => {
    const user = userEvent.setup();
    const item = {
      id: "photo-draft", communityId: member.communityId, title: "Original tent", description: "Original description", category: "tents-shelters",
      ownershipKind: "individual", ownerId: member.id, ownerIsActive: true, custodianId: member.id, custodianName: member.displayName,
      quantityTotal: 1, listingStatus: "listed", imagePaths: [],
    };
    api.fetchSupplies
      .mockResolvedValueOnce([item])
      .mockResolvedValueOnce([{ ...item, description: "Server refresh after upload", imagePaths: ["community/photo-draft/photo.jpg"] }]);
    renderManagement(member, "photo-draft");
    const title = await screen.findByLabelText("Name");
    await user.clear(title);
    await user.type(title, "Unsaved tent name");
    await user.upload(screen.getByLabelText("Add photos"), new File(["photo"], "tent.jpg", { type: "image/jpeg" }));
    expect(await screen.findByAltText("Prepared tent.jpg")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add photos" }));
    await waitFor(() => expect(api.fetchSupplies).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText("Name")).toHaveValue("Unsaved tent name");
    expect(screen.getByLabelText("Description")).toHaveValue("Original description");
  });

  it("preserves coordinator group assignment and removal controls in the shared editor", async () => {
    const user = userEvent.setup();
    const coordinator = { ...member, id: "coordinator", displayName: "Coordinator", accessLevel: "administrator" as const };
    api.fetchActiveMembers.mockResolvedValue([
      { id: coordinator.id, display_name: coordinator.displayName },
      { id: "next-manager", display_name: "Next Manager" },
    ]);
    api.fetchSupplies.mockResolvedValue([{
      id: "group", communityId: member.communityId, title: "Group tents", description: "Six tents", category: "tents-shelters",
      condition: "good", custodianPostalCode: null,
      ownershipKind: "group", ownerId: null, ownerIsActive: false, custodianId: coordinator.id, custodianName: coordinator.displayName,
      quantityTotal: 6, listingStatus: "listed", imagePaths: [],
    }]);
    api.updateSupply.mockResolvedValue(undefined);
    api.setSupplyContact.mockResolvedValue(undefined);

    renderManagement(coordinator, "group", "/manage?view=inventory");
    expect(await screen.findByRole("button", { name: "Remove from inventory" })).toBeInTheDocument();
    expect(await screen.findByRole("option", { name: "Next Manager" })).toBeInTheDocument();
    const managerSelect = document.querySelectorAll("select").item(2);
    expect(managerSelect).not.toBeNull();
    fireEvent.change(managerSelect!, { target: { value: "next-manager" } });
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(api.setSupplyContact).toHaveBeenCalledWith("group", "next-manager"));
  });

  it("keeps borrowing available when a coordinator can edit gear managed by someone else", async () => {
    const coordinator = { ...member, id: "coordinator", displayName: "Coordinator", accessLevel: "administrator" as const };
    api.fetchSupplies.mockResolvedValue([{
      id: "owner-item", communityId: member.communityId, title: "Owner stove", description: "Borrowable", category: "camp-kitchen",
      ownershipKind: "individual", ownerId: "owner", ownerIsActive: true, custodianId: "owner", custodianName: "Owner",
      quantityTotal: 1, listingStatus: "listed", imagePaths: [],
    }]);

    renderWithQuery(<CatalogPage membership={coordinator} />, ["/catalog"]);
    expect(await screen.findByRole("link", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View Owner stove" })).toBeInTheDocument();
  });

  it("saves through the canonical editor and returns to the originating route", async () => {
    const user = userEvent.setup();
    api.fetchActiveMembers.mockResolvedValue([]);
    api.fetchSupplies.mockResolvedValue([{
      id: "mine", communityId: member.communityId, title: "My tent", description: "Original", category: "tents-shelters",
      condition: "good", custodianPostalCode: null,
      ownershipKind: "individual", ownerId: member.id, ownerIsActive: true, custodianId: member.id, custodianName: member.displayName,
      quantityTotal: 1, listingStatus: "listed", imagePaths: [],
    }]);
    api.updateSupply.mockResolvedValue(undefined);

    renderManagement(member, "mine", "/catalog");
    const title = await screen.findByLabelText("Name");
    await user.clear(title);
    await user.type(title, "Updated tent");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(api.updateSupply).toHaveBeenCalledWith({
      id: "mine", title: "Updated tent", description: "Original", category: "tents-shelters", condition: "good", quantity: 1, status: "listed", guidelineVersion: 0, borrowingGuidelines: [],
    }));
    await waitFor(() => expect(api.fetchSupplies.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(await screen.findByText("Returned to Catalog")).toBeInTheDocument();
  });

  it("returns to Group inventory with the saved values already refreshed", async () => {
    const user = userEvent.setup();
    const coordinator = { ...member, id: "coordinator", displayName: "Coordinator", accessLevel: "administrator" as const };
    const original = workspaceSupply("group", { title: "Old patrol tents" });
    const updated = { ...original, title: "Updated patrol tents" };
    api.fetchActiveMembers.mockResolvedValue([{ id: coordinator.id, display_name: coordinator.displayName }]);
    api.fetchSupplies.mockResolvedValueOnce([original]).mockResolvedValue([updated]);
    api.updateSupply.mockResolvedValue(undefined);

    renderManagement(coordinator, "group", "/inventory");
    const title = await screen.findByLabelText("Name");
    await user.clear(title);
    await user.type(title, updated.title);
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByRole("heading", { name: "Group inventory" })).toBeInTheDocument();
    expect(screen.getByText(updated.title)).toBeInTheDocument();
    expect(screen.queryByText(original.title)).not.toBeInTheDocument();
  });

  it("returns a cancelled edit to the canonical gear detail that opened it", async () => {
    const user = userEvent.setup();
    api.fetchActiveMembers.mockResolvedValue([]);
    api.fetchSupplies.mockResolvedValue([{
      id: "mine", communityId: member.communityId, title: "My tent", description: "Original", category: "tents-shelters",
      ownershipKind: "individual", ownerId: member.id, ownerIsActive: true, custodianId: member.id, custodianName: member.displayName,
      quantityTotal: 1, listingStatus: "listed", imagePaths: [],
    }]);

    renderManagement(member, "mine", "/gear/mine");
    expect(await screen.findByLabelText("Name")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(await screen.findByText("Returned to Gear detail")).toBeInTheDocument();
  });

  it("uses a safe fallback for arbitrary return state and hides stale controls", async () => {
    api.fetchSupplies.mockResolvedValue([]);

    renderManagement(member, "missing", "https://attacker.invalid/");
    expect(await screen.findByRole("heading", { name: "Listing unavailable" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to inventory" })).toHaveAttribute("href", "/my-gear");
  });

  it("re-checks authority before showing controls from a direct management link", async () => {
    api.fetchSupplies.mockResolvedValue([{
      id: "unrelated", communityId: member.communityId, title: "Private stove", description: "Not managed here", category: "camp-kitchen",
      ownershipKind: "individual", ownerId: "owner", ownerIsActive: true, custodianId: "owner", custodianName: "Owner",
      quantityTotal: 1, listingStatus: "listed", imagePaths: [],
    }]);

    renderManagement(member, "unrelated");
    expect(await screen.findByRole("heading", { name: "Listing unavailable" })).toBeInTheDocument();
    expect(screen.getByText(/no longer authorized to manage it/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Hide from catalog" })).not.toBeInTheDocument();
  });

  it("cancels an unsaved edit without mutating inventory", async () => {
    const user = userEvent.setup();
    api.fetchSupplies.mockResolvedValue([{
      id: "mine", communityId: member.communityId, title: "My stove", description: "Original", category: "camp-kitchen",
      ownershipKind: "individual", ownerId: member.id, ownerIsActive: true, custodianId: member.id, custodianName: member.displayName,
      quantityTotal: 1, listingStatus: "listed", imagePaths: [],
    }]);

    renderManagement(member, "mine", "/my-gear");
    const title = await screen.findByLabelText("Name");
    await user.clear(title);
    await user.type(title, "Unsaved name");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(await screen.findByText("Returned to My gear")).toBeInTheDocument();
    expect(api.updateSupply).not.toHaveBeenCalled();
    expect(api.uploadGearImagesSequential).not.toHaveBeenCalled();
    expect(api.retireSupply).not.toHaveBeenCalled();
  });

  it("separates coordinator Inventory and Members while preserving URL-backed inventory context", async () => {
    const user = userEvent.setup();
    const coordinator = { ...member, id: "steward", displayName: "Coordinator", accessLevel: "administrator" as const };
    api.fetchSupplies.mockResolvedValue([
      workspaceSupply("tent", { title: "Patrol tent" }),
      workspaceSupply("personal", { title: "Personal tent", ownershipKind: "individual", ownerId: coordinator.id, ownerIsActive: true }),
    ]);
    api.fetchActiveMembers.mockResolvedValue([{ id: coordinator.id, display_name: coordinator.displayName, accessLevel: "administrator" as const }]);
    api.fetchPendingMembers.mockResolvedValue([]);
    api.fetchMemberAdministration.mockResolvedValue([{ id: coordinator.id, display_name: coordinator.displayName, accessLevel: "administrator" as const }]);

    renderWithQuery(<><MembershipAdministration membership={coordinator} /><LocationProbe /></>, ["/steward?view=inventory&q=tent"]);
    expect(await screen.findByRole("heading", { name: "Group inventory" })).toBeInTheDocument();
    expect(await screen.findByText("Patrol tent")).toBeInTheDocument();
    expect(screen.queryByText("Personal tent")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Ownership")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "People waiting for approval" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Members" }));
    expect(await screen.findByRole("heading", { name: "People waiting for approval" })).toBeInTheDocument();
    expect(screen.getByLabelText("Current route")).toHaveTextContent("/steward?view=members&q=tent");
    expect(screen.queryByRole("heading", { name: "Group inventory" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Inventory" }));
    expect(await screen.findByLabelText("Search inventory")).toHaveValue("tent");
  });

  it("lets an Administrator send a personal invitation without a second approval", async () => {
    const user = userEvent.setup();
    const administrator = { ...member, id: "steward", displayName: "Administrator", accessLevel: "administrator" as const };
    api.fetchPendingMembers.mockResolvedValue([]);
    api.fetchMemberAdministration.mockResolvedValue([{ id: administrator.id, display_name: administrator.displayName, membership_status: "active", accessLevel: "administrator" as const }]);

    renderWithQuery(<MembershipAdministration membership={administrator} />, ["/steward?view=members"]);

    expect(await screen.findByRole("heading", { name: "Invite a member directly" })).toBeInTheDocument();
    expect(screen.getByText(/will join as a Regular member and will not need another approval/i)).toBeInTheDocument();
    await user.type(screen.getByLabelText("Email address"), "new.member@example.com");
    await user.type(screen.getByLabelText("Display name (optional)"), "New Member");
    await user.click(screen.getByRole("button", { name: "Send personal invitation" }));

    await waitFor(() => expect(api.sendPreapprovedMemberInvitation).toHaveBeenCalledWith("new.member@example.com", "New Member"));
    expect(await screen.findByRole("status")).toHaveTextContent("Invitation sent");
    expect(screen.getByLabelText("Email address")).toHaveValue("");
    expect(screen.getByLabelText("Display name (optional)")).toHaveValue("");
  });

  it("paginates coordinator inventory and resets the page when search or status changes", async () => {
    const user = userEvent.setup();
    const coordinator = { ...member, id: "steward", displayName: "Coordinator", accessLevel: "administrator" as const };
    const supplies = [
      ...Array.from({ length: 27 }, (_, index) => workspaceSupply(String(index).padStart(2, "0"), { title: `Group item ${String(index).padStart(2, "0")}` })),
      workspaceSupply("removed", { title: "Removed lantern", listingStatus: "retired" }),
    ];
    api.fetchSupplies.mockResolvedValue(supplies);
    api.fetchActiveMembers.mockResolvedValue([{ id: coordinator.id, display_name: coordinator.displayName, accessLevel: "administrator" as const }]);

    renderWithQuery(<><MembershipAdministration membership={coordinator} /><LocationProbe /></>, ["/steward?view=inventory"]);
    await user.click(await screen.findByRole("button", { name: "Next" }));
    expect(await screen.findByText("Page 2 of 2")).toHaveAttribute("aria-live", "polite");
    expect(screen.getByLabelText("Current route")).toHaveTextContent("page=2");
    await user.type(screen.getByLabelText("Search inventory"), "Group item 01");
    await waitFor(() => expect(screen.getByLabelText("Current route")).toHaveTextContent("q=Group+item+01"));
    expect(screen.getByLabelText("Current route")).not.toHaveTextContent("page=");
    expect(await screen.findByText("Group item 01")).toBeInTheDocument();
    expect(screen.queryByText("Page 2 of 2")).not.toBeInTheDocument();
    await user.clear(screen.getByLabelText("Search inventory"));
    const selects = document.querySelectorAll("select");
    fireEvent.change(selects[1], { target: { value: "retired" } });
    expect(await screen.findByText("Removed lantern")).toBeInTheDocument();
    expect(screen.queryByText("Group item 00")).not.toBeInTheDocument();
  });

  it("cancels and publishes group gear without losing the coordinator's inventory context", async () => {
    const user = userEvent.setup();
    const coordinator = { ...member, id: "steward", displayName: "Coordinator", accessLevel: "administrator" as const };
    const created = { id: "created-group", communityId: member.communityId, imagePaths: [] };
    api.fetchSupplies.mockResolvedValue([]);
    api.fetchActiveMembers.mockResolvedValue([{ id: coordinator.id, display_name: coordinator.displayName, accessLevel: "administrator" as const }]);
    api.createOrResumeGroupDraft.mockResolvedValue(created);

    renderWithQuery(<><MembershipAdministration membership={coordinator} /><LocationProbe /></>, ["/steward?view=inventory&q=tent&category=Shelter"]);
    await user.click(await screen.findByRole("button", { name: "Add group gear" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Name"), "Cancelled tents");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(api.createOrResumeGroupDraft).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Current route")).toHaveTextContent("q=tent&category=Shelter");

    await user.click(screen.getByRole("button", { name: "Add group gear" }));
    await user.type(screen.getByLabelText("Name"), "New patrol tents");
    const groupSelects = document.querySelectorAll("select");
    fireEvent.change(groupSelects[groupSelects.length - 3], { target: { value: "tents-shelters" } });
    fireEvent.change(groupSelects[groupSelects.length - 2], { target: { value: "good" } });
    const photo = new File(["photo"], "patrol.jpg", { type: "image/jpeg" });
    await user.upload(screen.getByLabelText("Start with photos (optional)"), photo);
    expect(await screen.findByAltText("Prepared patrol.jpg")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Publish group listing" }));
    await waitFor(() => expect(api.createOrResumeGroupDraft).toHaveBeenCalledWith({ attemptId: expect.any(String), title: "New patrol tents", description: "", category: "tents-shelters", condition: "good", quantity: 1, custodianId: coordinator.id, expectedImages: 1, borrowingGuidelines: [] }));
    expect(api.uploadGearImagesSequential).toHaveBeenCalledWith(created, [expect.objectContaining({ name: "patrol.jpg" })], 0, expect.any(Function), expect.any(Function));
    expect(api.publishSupplyDraft).toHaveBeenCalledWith("created-group", expect.any(String));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByLabelText("Current route")).toHaveTextContent("q=tent&category=Shelter");
  });

  it("offers the same photo-first AI suggestions when adding group gear", async () => {
    const user = userEvent.setup();
    const coordinator = { ...member, id: "steward", displayName: "Coordinator", accessLevel: "administrator" as const };
    api.fetchSupplies.mockResolvedValue([]);
    api.fetchActiveMembers.mockResolvedValue([{ id: coordinator.id, display_name: coordinator.displayName, accessLevel: "administrator" as const }]);
    api.fetchAiDraftingAvailability.mockResolvedValue(true);
    api.draftGearListingsWithAi.mockResolvedValue([{ kind: "draft", title: "Suggested patrol tent", description: "A roomy group tent.", category: "tents-shelters" }]);

    renderWithQuery(<MembershipAdministration membership={coordinator} />, ["/steward?view=inventory"]);
    await user.click(await screen.findByRole("button", { name: "Add group gear" }));

    const photoField = await screen.findByLabelText("Start with photos (optional)");
    const nameField = screen.getByLabelText("Name");
    expect(photoField.compareDocumentPosition(nameField) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const photo = new File(["photo"], "patrol.jpg", { type: "image/jpeg" });
    await user.upload(photoField, photo);
    await user.click(screen.getByRole("button", { name: "Suggest listing details" }));

    await waitFor(() => expect(api.draftGearListingsWithAi).toHaveBeenCalledWith([[expect.objectContaining({ name: "patrol.jpg" })]], "single"));
    expect(screen.getByLabelText("Name")).toHaveValue("Suggested patrol tent");
    expect(screen.getByLabelText("Description")).toHaveValue("A roomy group tent.");
  });

  it("renders signed coordinator thumbnails and a consistent fallback", async () => {
    const coordinator = { ...member, id: "steward", displayName: "Coordinator", accessLevel: "administrator" as const };
    api.fetchSupplies.mockResolvedValue([
      workspaceSupply("photo", { title: "Photo tent", imagePaths: ["community/photo/tent.jpg"] }),
      workspaceSupply("fallback", { title: "Fallback stove", category: "camp-kitchen" }),
    ]);
    api.fetchActiveMembers.mockResolvedValue([{ id: coordinator.id, display_name: coordinator.displayName, accessLevel: "administrator" as const }]);
    api.getSignedImageUrl.mockResolvedValue("https://signed.invalid/tent.jpg");

    renderWithQuery(<MembershipAdministration membership={coordinator} />, ["/steward?view=inventory"]);
    expect(await screen.findByRole("img", { name: "Photo tent" })).toHaveAttribute("src", "https://signed.invalid/tent.jpg");
    expect(screen.getByText("No photo")).toBeInTheDocument();
  });

  it("keeps coordinator filters, results, and creation reachable at a narrow viewport", async () => {
    const user = userEvent.setup();
    const coordinator = { ...member, id: "steward", displayName: "Coordinator", accessLevel: "administrator" as const };
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 375 });
    window.dispatchEvent(new Event("resize"));
    api.fetchSupplies.mockResolvedValue([workspaceSupply("narrow", { title: "Narrow-screen tent" })]);
    api.fetchActiveMembers.mockResolvedValue([{ id: coordinator.id, display_name: coordinator.displayName, accessLevel: "administrator" as const }]);

    renderWithQuery(<MembershipAdministration membership={coordinator} />, ["/steward?view=inventory"]);
    expect(await screen.findByLabelText("Search inventory")).toBeVisible();
    expect(await screen.findByText("Narrow-screen tent")).toBeVisible();
    expect(screen.getByRole("link", { name: "Edit" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Add group gear" }));
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(screen.getByRole("button", { name: "Publish group listing" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Add group gear" })).toHaveFocus());
  });

  it("requires successor and impact confirmation while explaining bounded reactivation", async () => {
    const user = userEvent.setup();
    const steward = { ...member, id: "steward", displayName: "Acting Steward", accessLevel: "administrator" as const };
    api.fetchPendingMembers.mockResolvedValue([]);
    api.fetchSupplies.mockResolvedValue([]);
    api.fetchActiveMembers.mockResolvedValue([{ id: "successor", display_name: "Successor Steward" }]);
    api.fetchMemberAdministration.mockResolvedValue([
      { id: "target", display_name: "Departing Individual", account_email: "departing@example.test", accessLevel: "regular" },
      { id: "successor", display_name: "Successor Steward", account_email: "successor@example.test", accessLevel: "administrator" as const },
    ]);
    api.getDeactivationImpact.mockResolvedValue({
      affectedListings: 2,
      requestsToCancel: 3,
      checkedOutLoans: 1,
    });

    renderWithQuery(<MembershipAdministration membership={steward} />, ["/manage?view=members"]);
    expect(await screen.findByText("departing@example.test")).toBeInTheDocument();
    expect(screen.queryByText(/Account email:/)).not.toBeInTheDocument();
    await user.click((await screen.findAllByRole("button", { name: "Deactivate" }))[0]);

    const confirmationDialog = screen.getByRole("dialog", { name: "Deactivate Departing Individual" });
    expect(confirmationDialog).toBeVisible();
    expect(confirmationDialog.contains(document.activeElement)).toBe(true);
    expect(within(confirmationDialog).getByText(/former Administrator or custodian access will not come back automatically/i)).toBeInTheDocument();
    expect(within(confirmationDialog).getByRole("button", { name: "Confirm deactivation" })).toBeDisabled();

    const successorSelector = confirmationDialog.querySelector("select");
    expect(successorSelector).not.toBeNull();
    fireEvent.change(successorSelector!, { target: { value: "successor" } });
    await waitFor(() => expect(api.getDeactivationImpact).toHaveBeenCalledWith("target", "successor"));

    expect(await screen.findByText("2 affected listings")).toBeInTheDocument();
    expect(screen.getByText("3 pending or approved individual requests will be cancelled")).toBeInTheDocument();
    expect(screen.getByText("1 checked-out individual loans remain open for any Administrator to record return")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm deactivation" })).toBeEnabled();
    await user.click(within(confirmationDialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect((screen.getAllByRole("button", { name: "Deactivate" }))[0]).toHaveFocus());
  });

  it("requires an exact preview and reason before restoring Regular membership", async () => {
    const user = userEvent.setup();
    const steward = { ...member, id: "steward", displayName: "Acting Steward", accessLevel: "administrator" as const };
    api.fetchPendingMembers.mockResolvedValue([]);
    api.fetchSupplies.mockResolvedValue([]);
    api.fetchActiveMembers.mockResolvedValue([]);
    api.fetchMemberAdministration.mockResolvedValue([
      { id: "target", display_name: "Former Custodian", membership_status: "deactivated", accessLevel: "regular" },
    ]);
    api.fetchReactivationImpact.mockResolvedValue({
      targetId: "target", displayName: "Former Custodian", membershipStatus: "deactivated",
      priorAccessLevel: "custodian", cancelledLoans: 2, individualOwnedListings: 1,
      storedWithListings: 0, notificationConsequence: "Restores active Regular membership; prior consequences remain unchanged.",
      previewVersion: "a".repeat(64),
    });
    api.reactivateMember.mockResolvedValue("audit");

    renderWithQuery(<MembershipAdministration membership={steward} />, ["/manage?view=members"]);
    const reviewButton = await screen.findByRole("button", { name: "Review reactivation" });
    await user.click(reviewButton);
    const reactivationDialog = screen.getByRole("dialog", { name: "Review reactivation for Former Custodian" });
    expect(reactivationDialog).toBeVisible();
    expect(reactivationDialog.contains(document.activeElement)).toBe(true);
    expect(await within(reactivationDialog).findByText("2 cancelled loans will stay cancelled")).toBeInTheDocument();
    expect(within(reactivationDialog).getByText("Previous role: custodian")).toBeInTheDocument();
    expect(within(reactivationDialog).getByRole("button", { name: "Restore as member" })).toBeDisabled();
    await user.type(within(reactivationDialog).getByLabelText("Reason for restoring membership"), "Reviewed consequences");
    await user.click(within(reactivationDialog).getByRole("button", { name: "Restore as member" }));
    await waitFor(() => expect(api.reactivateMember).toHaveBeenCalledWith("target", "a".repeat(64), "Reviewed consequences"));
  });

  it("requires explicit irreversible confirmation before deleting a deactivated account", async () => {
    const user = userEvent.setup();
    const steward = { ...member, id: "steward", displayName: "Acting Steward", accessLevel: "administrator" as const };
    api.fetchPendingMembers.mockResolvedValue([]);
    api.fetchSupplies.mockResolvedValue([]);
    api.fetchActiveMembers.mockResolvedValue([]);
    api.fetchMemberAdministration.mockResolvedValue([
      { id: "target", display_name: "Former Member", account_email: "former@example.test", membership_status: "deactivated", accessLevel: "regular" },
    ]);

    renderWithQuery(<MembershipAdministration membership={steward} />, ["/manage?view=members"]);
    const deleteButton = await screen.findByRole("button", { name: "Delete account" });
    await user.click(deleteButton);
    const dialog = screen.getByRole("dialog", { name: "Delete Former Member's account?" });
    expect(dialog).toBeVisible();
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(within(dialog).getByText(/Past loans and administrative records will remain/i)).toBeInTheDocument();
    const confirm = within(dialog).getByRole("button", { name: "Delete account permanently" });
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByLabelText("Type DELETE to confirm"), "DELETE");
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    await waitFor(() => expect(api.deleteDeactivatedMember).toHaveBeenCalledWith("target"));
  });

  it("lets an Administrator return a rejected applicant to a fresh application", async () => {
    const user = userEvent.setup();
    const administrator = { ...member, id: "administrator", accessLevel: "administrator" as const };
    api.fetchPendingMembers.mockResolvedValue([]);
    api.fetchSupplies.mockResolvedValue([]);
    api.fetchActiveMembers.mockResolvedValue([]);
    api.fetchMemberAdministration.mockResolvedValue([
      { id: "rejected", display_name: "Rejected Applicant", membership_status: "rejected", accessLevel: "regular" },
    ]);
    api.allowMembershipReapplication.mockResolvedValue(undefined);

    renderWithQuery(<MembershipAdministration membership={administrator} />, ["/manage?view=members"]);
    expect(await screen.findByRole("heading", { name: "Rejected applications" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Allow new application" }));
    expect(screen.getByText(/prior answers will be cleared/i)).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: "Allow new application" })[1]);
    await waitFor(() => expect(api.allowMembershipReapplication).toHaveBeenCalledWith("rejected"));
  });

  it("presents new-member questions in the same settings card pattern", async () => {
    api.fetchJoinQuestions.mockResolvedValue({
      communityName: "Gear Share",
      versionId: "version-2",
      questions: [{ id: "q1", prompt: "Which group are you part of?", required: true }],
    });

    renderWithQuery(<JoinQuestionEditor />);

    const heading = await screen.findByRole("heading", { name: "Questions for new members" });
    const settingsCard = heading.closest(".rounded-lg.border.bg-card");
    expect(settingsCard).not.toBeNull();
    expect(within(settingsCard as HTMLElement).getByText("Ask up to three questions on the membership application.")).toBeInTheDocument();
    expect(await within(settingsCard as HTMLElement).findByLabelText("Question 1")).toHaveValue("Which group are you part of?");
    expect(within(settingsCard as HTMLElement).getByRole("button", { name: "Save questions" })).toBeInTheDocument();
  });
});
