import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { processStagedBulkRows } from "@/lib/bulkIntakeProcessing";
import BulkIntakePage from "@/pages/app/BulkIntakePage";

const api = vi.hoisted(() => ({ fetchAiDraftingAvailability: vi.fn(), fetchActiveMembers: vi.fn(), fetchBulkDraftStatuses: vi.fn().mockResolvedValue([]), stageBulkGearDrafts: vi.fn(), digestGearImageFile: vi.fn(), uploadGearImagesSequential: vi.fn(), publishSupplyDraft: vi.fn(), retireSupply: vi.fn(), draftGearListingsWithAi: vi.fn() }));
vi.mock("@/lib/gearShareApi", () => api);
vi.mock("@/components/gear/PrivatePhotoPicker", () => ({ PrivatePhotoPicker: ({ label, max, onChange }: { label: string; max: number; onChange: (files: File[]) => void }) => <div>{label} · up to {max}<button type="button" onClick={() => onChange([new File(["one"], "tent.jpg", { type: "image/jpeg" }), new File(["two"], "stove.jpg", { type: "image/jpeg" })])}>Choose for {label}</button></div> }));

function renderPage() { return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><BulkIntakePage membership={{ id: "member", communityId: "community", displayName: "Member", status: "active", accessLevel: "regular" }} /></QueryClientProvider>); }

describe("BulkIntakePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.fetchAiDraftingAvailability.mockResolvedValue(false);
    api.fetchActiveMembers.mockResolvedValue([]);
    api.fetchBulkDraftStatuses.mockResolvedValue([]);
  });
  it("rejects item eleven explicitly and keeps Regular ownership fixed", async () => {
    const user = userEvent.setup(); renderPage(); await user.click(screen.getByRole("tab", { name: /Enter details yourself/ })); const add = screen.getByRole("button", { name: "Add another item" });
    for (let count = 1; count < 10; count += 1) fireEvent.click(add);
    expect(screen.getByText("Item 10")).toBeInTheDocument(); fireEvent.click(add);
    expect(screen.getByRole("alert")).toHaveTextContent("up to ten items");
    expect(screen.queryByLabelText(/Who owns it/)).not.toBeInTheDocument();
  }, 15_000);
  it("keeps detailed entry available while photo suggestions are disabled", async () => { const user = userEvent.setup(); renderPage(); expect(await screen.findByText(/Photo suggestions aren’t available yet/)).toBeInTheDocument(); expect(screen.getByText(/have not been enabled for this community/)).toBeInTheDocument(); await user.click(screen.getByRole("button", { name: "Enter details yourself" })); expect(screen.getByRole("button", { name: "Save as drafts" })).toBeInTheDocument(); expect(screen.getByText("Item photos · up to 4")).toBeInTheDocument(); });
  it("shows complete per-row validation before any staging mutation", async () => {
    const user = userEvent.setup(); renderPage(); await user.click(screen.getByRole("tab", { name: /Enter details yourself/ }));
    expect(screen.queryByText("Choose 1 to 4 photos.")).not.toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Save as drafts" }));
    expect(await screen.findByText("Choose 1 to 4 photos.")).toBeInTheDocument();
    expect(screen.getByText("Enter a name up to 120 characters.")).toBeInTheDocument();
    expect(screen.getByText("Choose a category.")).toBeInTheDocument();
    expect(screen.getByText("Choose a condition.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save as drafts" })).toBeEnabled();
    expect(api.stageBulkGearDrafts).not.toHaveBeenCalled();
  });
  it("explains AI suggestions and mandatory review when AI is effectively available", async () => {
    api.fetchAiDraftingAvailability.mockResolvedValue(true);
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><BulkIntakePage membership={{ id: "member", communityId: "community", displayName: "Member", status: "active", accessLevel: "regular" }} /></QueryClientProvider>);
    expect(await screen.findByText(/AI will suggest a name, description, and category/i)).toBeInTheDocument();
    expect(screen.queryByText(/OpenAI/i)).not.toBeInTheDocument();
    expect(screen.getByText(/review and correct every item before anything is saved or published/i)).toBeInTheDocument();
  });
  it("turns a batch of photos into one reviewable item per photo", async () => {
    api.fetchAiDraftingAvailability.mockResolvedValue(true);
    api.draftGearListingsWithAi.mockResolvedValue([
      { kind: "draft", title: "Two-person tent", description: "Compact tent", category: "tents-shelters" },
      { kind: "draft", title: "Camp stove", description: "Small stove", category: "camp-kitchen" },
    ]);
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Choose for Choose photos—one item per photo" }));
    await user.click(screen.getByRole("button", { name: "Create 2 suggestions" }));
    await waitFor(() => expect(api.draftGearListingsWithAi).toHaveBeenCalledWith([
      [expect.objectContaining({ name: "tent.jpg" })], [expect.objectContaining({ name: "stove.jpg" })],
    ], "bulk"));
    expect(await screen.findByRole("heading", { name: "Review the suggested items" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("Two-person tent")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Camp stove")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save as drafts" })).toBeInTheDocument();
  });
  it("recovers a staged row with independent retry and authorized discard controls", async () => {
    api.fetchBulkDraftStatuses.mockImplementation(async (attemptIds: string[]) => [{ attemptId: attemptIds[0], supplyId: "supply", communityId: "community", listingStatus: "unlisted", guidelineVersion: 1, expectedImages: 1, committedImages: 0 }]);
    const user = userEvent.setup(); renderPage(); await user.click(screen.getByRole("tab", { name: /Enter details yourself/ })); await user.click(screen.getByRole("button", { name: "Resume unfinished items" }));
    expect(await screen.findByRole("button", { name: "Try this item again" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove draft" })).toBeInTheDocument();
    expect(api.stageBulkGearDrafts).not.toHaveBeenCalled();
  });
  it("preserves a failed row and continues committing its successful sibling", async () => {
    const upload = vi.fn().mockRejectedValueOnce(new Error("sanitizer response lost")).mockResolvedValueOnce(undefined);
    const update = vi.fn(); const file = new File(["photo"], "photo.jpg", { type: "image/jpeg" });
    await processStagedBulkRows({
      results: [
        { index: 0, attemptId: "a", status: "staged", supplyId: "s1", communityId: "c" },
        { index: 1, attemptId: "b", status: "staged", supplyId: "s2", communityId: "c" },
      ],
      rows: [{ photos: [file] }, { photos: [file] }],
      indices: [0,1], paused: () => false, upload, update, progress: vi.fn(),
    });
    expect(upload).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenCalledWith(0, expect.objectContaining({ mediaReady: false, rowError: expect.stringContaining("try this item again") }));
    expect(update).toHaveBeenCalledWith(1, expect.objectContaining({ mediaReady: true, include: false }));
  });
  it("pauses before the next row without discarding its recoverable staged result", async () => {
    const upload = vi.fn(); const update = vi.fn();
    await processStagedBulkRows({ results: [{ index: 0, attemptId: "a", status: "staged", supplyId: "s1", communityId: "c" }], rows: [{ photos: [] }], indices: [0], paused: () => true, upload, update, progress: vi.fn() });
    expect(upload).not.toHaveBeenCalled(); expect(update).toHaveBeenCalledWith(0, expect.objectContaining({ rowError: expect.stringContaining("finish it later") }));
  });
});
