import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

const api = vi.hoisted(() => ({
  fetchNotificationDeliveryDiagnostics: vi.fn(), setAdministratorEmailSuppression: vi.fn(),
  fetchCommunitySettings: vi.fn(), updateCommunityDisplayName: vi.fn(), setAiDraftingEnabled: vi.fn(), checkAiActivation: vi.fn(),
  fetchAdministratorOrientation: vi.fn(), setAdministratorOrientation: vi.fn(),
}));
vi.mock("@/lib/gearShareApi", () => api);
vi.mock("@/pages/app/MembershipAdministration", () => ({ MembershipWorkspace: () => <section>Membership controls</section>, JoinQuestionEditor: () => <section>Questions for new members</section> }));
const origin = vi.hoisted(() => ({ development: false }));
vi.mock("@/config/publicOrigin", () => ({ configuredJoinUrl: () => "https://gear.example.test/join", isDevelopmentInviteUrl: () => origin.development }));
import AdministrationPage from "./AdministrationPage";

const membership = { id: "admin", communityId: "community", displayName: "Admin", status: "active", accessLevel: "administrator" } as const;
function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter><AdministrationPage membership={membership} /></MemoryRouter></QueryClientProvider>);
}

describe("administrator delivery diagnostics", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    api.setAdministratorEmailSuppression.mockResolvedValue(undefined);
    api.fetchCommunitySettings.mockResolvedValue({ communityId: "community", displayName: "Trail Group", configurationVersion: 1, aiDraftingEnabled: false });
    api.updateCommunityDisplayName.mockResolvedValue({ communityId: "community", displayName: "Renamed", configurationVersion: 2, aiDraftingEnabled: false });
    api.setAiDraftingEnabled.mockResolvedValue({ configurationVersion: 1, aiDraftingEnabled: false, alreadyReservedRequests: 0, statusReason: "AI drafting remains disabled until activation gates are current." });
    api.checkAiActivation.mockResolvedValue(undefined);
    origin.development = false;
    api.fetchAdministratorOrientation.mockResolvedValue([{ registryVersion: 1, itemId: "review_privacy", label: "Review privacy", helpText: "Read it.", routeId: "privacy", displayOrder: 1, required: true, applicableRole: "administrator", status: null, changedAt: null }]);
    api.setAdministratorOrientation.mockResolvedValue(undefined);
  });

  it("keeps selectable fallback when clipboard and native sharing are unavailable", async () => {
    const user = userEvent.setup();
    api.fetchNotificationDeliveryDiagnostics.mockResolvedValue([]);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
    renderPage();
    await user.click(screen.getByRole("tab", { name: "Community" }));
    await user.click(await screen.findByRole("button", { name: "Copy invitation" }));
    expect(screen.getByRole("status")).toHaveTextContent(/Select and copy/);
    const invitation = (screen.getByLabelText("Message preview") as HTMLTextAreaElement).value;
    expect(invitation).toContain("You're invited to join Trail Group Gear Share.");
    expect(invitation).toContain("An administrator will review it before granting access.");
    expect(invitation).toContain("https://gear.example.test/join");
    await user.click(screen.getByRole("button", { name: "Share invitation" }));
    expect(screen.getByRole("status")).toHaveTextContent(/Use a copy button/);
  });

  it("handles native share success, cancellation, failure, and development labeling", async () => {
    const user = userEvent.setup();
    api.fetchNotificationDeliveryDiagnostics.mockResolvedValue([]);
    const share = vi.fn().mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(Object.assign(new Error("cancelled"), { name: "AbortError" }))
      .mockRejectedValueOnce(new Error("failed"));
    Object.defineProperty(navigator, "share", { configurable: true, value: share });
    origin.development = true;
    renderPage();
    await user.click(screen.getByRole("tab", { name: "Community" }));
    expect(await screen.findByRole("note")).toHaveTextContent(/Development-only link/);
    const button = screen.getByRole("button", { name: "Share invitation" });
    await user.click(button);
    expect(screen.getByRole("status")).toHaveTextContent("Invitation shared.");
    await user.click(button);
    expect(screen.getByRole("status")).toHaveTextContent(/Sharing cancelled/);
    await user.click(button);
    expect(screen.getByRole("status")).toHaveTextContent(/Sharing failed/);
  });

  it("shows bounded diagnostics without recipient email or message content", async () => {
    api.fetchNotificationDeliveryDiagnostics.mockResolvedValue([{ outboxId: "outbox", recipientUserId: "member", recipientDisplayName: "Member Name", eventType: "loan_requested", status: "pending", attemptCount: 0, suppressionReason: null, createdAt: "created", updatedAt: "updated" }]);
    renderPage();
    await userEvent.setup().click(screen.getByRole("tab", { name: "Email activity" }));
    expect(await screen.findByText("Member Name")).toBeInTheDocument();
    expect(screen.getByText(/Email addresses and message text stay private/)).toBeInTheDocument();
    expect(screen.queryByText(/@/)).not.toBeInTheDocument();
  });

  it("can set and clear only administrator suppression", async () => {
    const user = userEvent.setup();
    api.fetchNotificationDeliveryDiagnostics
      .mockResolvedValueOnce([{ outboxId: "one", recipientUserId: "member", recipientDisplayName: "Member", eventType: "loan_requested", status: "pending", attemptCount: 0, suppressionReason: null, createdAt: "created", updatedAt: "updated" }])
      .mockResolvedValue([{ outboxId: "one", recipientUserId: "member", recipientDisplayName: "Member", eventType: "loan_requested", status: "suppressed", attemptCount: 0, suppressionReason: "administrator", createdAt: "created", updatedAt: "updated" }]);
    renderPage();
    await user.click(screen.getByRole("tab", { name: "Email activity" }));
    await user.click(await screen.findByRole("button", { name: "Pause email" }));
    await waitFor(() => expect(api.setAdministratorEmailSuppression).toHaveBeenCalledWith("member", true));
    await user.click(await screen.findByRole("button", { name: "Resume email" }));
    await waitFor(() => expect(api.setAdministratorEmailSuppression).toHaveBeenCalledWith("member", false));
  });

  it("does not offer a client-side clear for provider suppression", async () => {
    api.fetchNotificationDeliveryDiagnostics.mockResolvedValue([{ outboxId: "outbox", recipientUserId: "member", recipientDisplayName: "Member", eventType: "loan_requested", status: "suppressed", attemptCount: 1, suppressionReason: "complaint", createdAt: "created", updatedAt: "updated" }]);
    renderPage();
    await userEvent.setup().click(screen.getByRole("tab", { name: "Email activity" }));
    expect(await screen.findByText("Email paused: Recipient complaint")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resume email" })).not.toBeInTheDocument();
  });

  it("offers fixed invite sharing, versioned settings, safe-off AI, and a useful administrator guide", async () => {
    const user = userEvent.setup();
    api.fetchNotificationDeliveryDiagnostics.mockResolvedValue([]);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    renderPage();
    await user.click(screen.getByRole("tab", { name: "Community" }));
    expect(await screen.findByDisplayValue(/gear\.example\.test\/join/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Copy application link" }));
    expect(writeText).toHaveBeenCalledWith("https://gear.example.test/join");
    await user.clear(screen.getByLabelText("Community display name"));
    await user.type(screen.getByLabelText("Community display name"), "Renamed Group");
    await user.click(screen.getByRole("button", { name: "Save name" }));
    await waitFor(() => expect(api.updateCommunityDisplayName).toHaveBeenCalledWith("Renamed Group", 1));
    api.setAiDraftingEnabled.mockResolvedValueOnce({ configurationVersion: 2, aiDraftingEnabled: true, alreadyReservedRequests: 0, statusReason: "AI drafting is enabled." });
    await user.click(screen.getByRole("button", { name: "Test connection and turn on" }));
    expect(api.checkAiActivation).toHaveBeenCalledTimes(1);
    expect(api.setAiDraftingEnabled).toHaveBeenCalledWith(true, 1);
    expect(await screen.findByText(/AI suggestions are ready for members/)).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Admin guide" }));
    expect(screen.getByRole("heading", { name: "Set up your community" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Regular administrator work" })).toBeInTheDocument();
    expect(screen.getByText("Use these shortcuts for the work you’ll return to regularly.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Manage members" })).toHaveAttribute("href", "/administration#members");
    expect(screen.getByRole("link", { name: "Manage loans" })).toHaveAttribute("href", "/loans");
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(api.setAdministratorOrientation).not.toHaveBeenCalled();
  });
});
