import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  fetchMyProfileSettings: vi.fn(),
  updateMyProfileSettings: vi.fn(),
  fetchTransactionalEmailPreferences: vi.fn(),
  updateTransactionalEmailPreferences: vi.fn(),
  fetchMyPostalCode: vi.fn(),
  setMyPostalCode: vi.fn(),
}));
const auth = vi.hoisted(() => ({ updateUser: vi.fn() }));
vi.mock("@/lib/gearShareApi", () => api);
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth } }));
vi.mock("@/config/publicOrigin", () => ({ configuredPublicOrigin: () => "https://gear.example.test" }));

import AccountPage from "./AccountPage";

function renderAccount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><AccountPage userId="member" /></QueryClientProvider>);
}

describe("private profile and account settings", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    api.fetchMyProfileSettings.mockResolvedValue({
      displayName: "Current Member",
      introduction: "Happy to share gear",
      phoneE164: "+15125550123",
      coordinationNote: "Text after 5 PM",
      confirmedEmail: "confirmed@example.test",
    });
    api.updateMyProfileSettings.mockResolvedValue(undefined);
    api.fetchTransactionalEmailPreferences.mockResolvedValue({ loanActivity: true, loanReminders: true, wantedActivity: false });
    api.updateTransactionalEmailPreferences.mockResolvedValue(undefined);
    api.fetchMyPostalCode.mockResolvedValue("78664");
    api.setMyPostalCode.mockResolvedValue("78664");
    auth.updateUser.mockResolvedValue({ error: null });
  });

  it("saves only the bounded private profile fields", async () => {
    const user = userEvent.setup();
    renderAccount();

    const displayName = await screen.findByLabelText("Display name");
    expect(displayName).toHaveAttribute("maxlength", "80");
    expect(screen.getByLabelText("Pickup and return notes (optional)")).toHaveAttribute("maxlength", "160");
    expect(screen.getByLabelText("Phone for pickup and return (optional)")).toHaveValue("(512) 555-0123");
    expect(screen.queryByText(/country code/i)).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("ZIP code (optional)")).toHaveValue("78664"));
    expect(screen.getAllByText(/Don’t enter a street address/)).toHaveLength(2);

    await user.clear(displayName);
    await user.type(displayName, "Updated Member");
    await user.click(screen.getByRole("button", { name: "Save profile" }));

    await waitFor(() => expect(api.updateMyProfileSettings).toHaveBeenCalledWith({
      displayName: "Updated Member",
      introduction: "Happy to share gear",
      phoneE164: "+15125550123",
      coordinationNote: "Text after 5 PM",
    }));
    expect(api.setMyPostalCode).toHaveBeenCalledWith("78664");
    expect(screen.queryByRole("button", { name: /Save ZIP/ })).not.toBeInTheDocument();
  });

  it("saves exactly the three optional email categories while keeping in-app and access events required", async () => {
    const user = userEvent.setup();
    renderAccount();

    expect(await screen.findByText(/always see notifications in the app/)).toBeInTheDocument();
    expect(screen.getByText(/Important emails about your account and access stay on/)).toBeInTheDocument();
    const loan = screen.getByRole("checkbox", { name: /Loan activity/ });
    const reminders = screen.getByRole("checkbox", { name: /Due and overdue reminders/ });
    const wanted = screen.getByRole("checkbox", { name: /Wanted request activity/ });
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
    expect(loan).toBeChecked();
    expect(reminders).toBeChecked();
    expect(wanted).not.toBeChecked();

    await user.click(reminders);
    await user.click(wanted);
    await user.click(screen.getByRole("button", { name: "Save notifications" }));
    await waitFor(() => expect(api.updateTransactionalEmailPreferences).toHaveBeenCalledWith({ loanActivity: true, loanReminders: false, wantedActivity: true }));
  });

  it("shows only confirmed Auth email and starts its change through the fixed account callback", async () => {
    const user = userEvent.setup();
    renderAccount();

    expect(await screen.findByText("confirmed@example.test")).toBeInTheDocument();
    expect(screen.getByText(/Used to sign in and receive email notifications/)).toBeInTheDocument();
    await user.type(screen.getByLabelText("New email address"), "next@example.test");
    await user.click(screen.getByRole("button", { name: "Change email address" }));

    await waitFor(() => expect(auth.updateUser).toHaveBeenCalledWith(
      { email: "next@example.test" },
      { emailRedirectTo: "https://gear.example.test/account" },
    ));
    expect(await screen.findByText(/current email stays active/)).toBeInTheDocument();
  });
});
