import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ fetchPrivateNotifications: vi.fn(), setNotificationRead: vi.fn(), dismissNotification: vi.fn(), dismissAllNotifications: vi.fn() }));
vi.mock("@/lib/gearShareApi", () => api);
import NotificationsPage from "./NotificationsPage";

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter><NotificationsPage /></MemoryRouter></QueryClientProvider>);
}

const row = (id: string, readAt: string | null = null) => ({
  id, eventType: "loan_requested", title: `Loan ${id}`, body: "A loan changed.", appRoute: "/loans", occurredAt: `2026-08-14T12:00:${id.padStart(2, "0")}Z`, readAt,
});

describe("private notification center", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    api.setNotificationRead.mockResolvedValue(undefined);
    api.dismissNotification.mockResolvedValue(undefined);
    api.dismissAllNotifications.mockResolvedValue(1);
  });

  it("shows an empty state and a recoverable load error", async () => {
    api.fetchPrivateNotifications.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText("You have no notifications yet.")).toBeInTheDocument();
  });

  it("shows a load error with an explicit retry", async () => {
    const user = userEvent.setup();
    api.fetchPrivateNotifications.mockRejectedValueOnce(new Error("Notification center unavailable")).mockResolvedValue([]);
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("Notification center unavailable");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("You have no notifications yet.")).toBeInTheDocument();
    expect(api.fetchPrivateNotifications).toHaveBeenCalledTimes(2);
  });

  it("uses canonical app links and bounded read and dismiss actions", async () => {
    const user = userEvent.setup();
    api.fetchPrivateNotifications.mockResolvedValue([row("1")]);
    renderPage();
    expect(await screen.findByRole("link", { name: "Loan 1" })).toHaveAttribute("href", "/loans");
    await user.click(screen.getByRole("button", { name: "Mark read" }));
    await waitFor(() => expect(api.setNotificationRead).toHaveBeenCalledWith("1", true));
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(api.dismissNotification).toHaveBeenCalledWith("1"));
  });

  it("confirms before dismissing every notification", async () => {
    const user = userEvent.setup();
    api.fetchPrivateNotifications.mockResolvedValue([row("1")]);
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Dismiss all" }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("including older notifications you have not loaded");
    expect(api.dismissAllNotifications).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Dismiss all" }));
    await waitFor(() => expect(api.dismissAllNotifications).toHaveBeenCalledOnce());
  });

  it("paginates from the final row of an exact 30-row page", async () => {
    const user = userEvent.setup();
    const first = Array.from({ length: 30 }, (_, index) => row(String(index)));
    api.fetchPrivateNotifications.mockResolvedValueOnce(first).mockResolvedValueOnce([row("older", "2026-08-14T13:00:00Z")]);
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Load older notifications" }));
    await waitFor(() => expect(api.fetchPrivateNotifications).toHaveBeenLastCalledWith({ occurredAt: first[29].occurredAt, id: first[29].id }));
    expect(await screen.findByRole("link", { name: "Loan older" })).toBeInTheDocument();
  });
});
