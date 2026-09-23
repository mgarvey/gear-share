import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ user: null as null | { id: string }, isReady: true }));
const api = vi.hoisted(() => ({ fetchMembership: vi.fn(), fetchCommunitySettings: vi.fn() }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => state }));
vi.mock("@/lib/gearShareApi", () => api);
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { signOut: vi.fn() } } }));
vi.mock("@/components/gear/Auth", () => ({ Auth: () => <p>Private account access</p> }));
vi.mock("@/components/ui/toaster", () => ({ Toaster: () => null }));
vi.mock("@/components/ui/sonner", () => ({ Toaster: () => null }));
vi.mock("@/config/publicOrigin", () => ({ configuredPrivacyContactUrl: () => "https://gear.example.test/contact" }));
vi.mock("@/config/community", () => ({ communityName: "Community", gearShareName: "Community Gear Share", communityLogoUrl: "/favicon.png" }));
vi.mock("@/pages/app/JoinPage", () => ({ default: () => <p>Public join route</p> }));
vi.mock("@/pages/app/AboutPage", () => ({ default: () => <p>Public about route</p> }));
vi.mock("@/pages/app/PrivacyTermsPage", () => ({ default: () => <p>Public privacy route</p> }));
vi.mock("@/pages/app/TermsPage", () => ({ default: () => <p>Public terms route</p> }));
vi.mock("@/pages/app/CatalogPage", () => ({ default: () => <p>Catalog workspace</p> }));
vi.mock("@/pages/app/InventoryPage", () => ({ default: () => <p>Inventory workspace</p> }));
vi.mock("@/pages/app/AdministrationPage", () => ({ default: () => <p>Administration workspace</p> }));

import App from "./App";

function renderApp(path: string) {
  window.history.pushState({}, "", path);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { ...render(<QueryClientProvider client={client}><App /></QueryClientProvider>), client };
}

describe("gear share route authority", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    window.scrollTo = vi.fn();
    state.user = null;
    state.isReady = true;
    api.fetchCommunitySettings.mockResolvedValue({ communityId: "community", displayName: "Trail Group", configurationVersion: 1, aiDraftingEnabled: false });
  });

  it.each([["/join", "Public join route"], ["/about", "Public about route"], ["/privacy", "Public privacy route"], ["/terms", "Public terms route"]])("keeps %s public without private membership queries", async (path, copy) => {
    renderApp(path);
    expect(await screen.findByText(copy)).toBeInTheDocument();
    expect(api.fetchMembership).not.toHaveBeenCalled();
  });

  it.each([["regular", "Catalog workspace"], ["custodian", "Inventory workspace"]] as const)("redirects %s members away from Administrator routes", async (accessLevel, destination) => {
    state.user = { id: "member" };
    api.fetchMembership.mockResolvedValue({ id: "member", communityId: "community", displayName: "Member", status: "active", accessLevel });
    renderApp("/administration");
    expect(await screen.findByText(destination)).toBeInTheDocument();
    expect(screen.queryByText("Administration workspace")).not.toBeInTheDocument();
  });

  it("shows the branded shell while the signed-in session is being restored", () => {
    state.isReady = false;
    renderApp("/my-gear");
    expect(screen.getByText("Community")).toBeInTheDocument();
    expect(screen.getByLabelText("Loading your gear")).toBeInTheDocument();
    expect(screen.queryByText("Loading shared gear…")).not.toBeInTheDocument();
  });

  it("does not clear newly started work on the signed-out to signed-in transition", async () => {
    const rendered = renderApp("/catalog");
    rendered.client.setQueryData(["newly-started-work"], { retained: true });
    state.user = { id: "member" };
    api.fetchMembership.mockResolvedValue({ id: "member", communityId: "community", displayName: "Member", status: "active", accessLevel: "regular" });
    rendered.rerender(<QueryClientProvider client={rendered.client}><App /></QueryClientProvider>);
    expect(rendered.client.getQueryData(["newly-started-work"])).toEqual({ retained: true });
    expect(await screen.findByText("Catalog workspace")).toBeInTheDocument();
  });

  it("returns to the top when login replaces the account screen with the catalog", async () => {
    const rendered = renderApp("/catalog");
    vi.mocked(window.scrollTo).mockClear();
    state.user = { id: "member" };
    api.fetchMembership.mockResolvedValue({ id: "member", communityId: "community", displayName: "Member", status: "active", accessLevel: "regular" });

    rendered.rerender(<QueryClientProvider client={rendered.client}><App /></QueryClientProvider>);

    expect(await screen.findByText("Catalog workspace")).toBeInTheDocument();
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: "auto" });
  });

  it("gives a rejected applicant a real contact path", async () => {
    state.user = { id: "rejected" };
    api.fetchMembership.mockResolvedValue({ id: "rejected", communityId: "community", displayName: "Applicant", status: "rejected", accessLevel: "regular" });
    renderApp("/catalog");
    expect(await screen.findByRole("heading", { name: "Membership request was not approved" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Contact an Administrator" })).toHaveAttribute("href", "https://gear.example.test/contact");
  });

  it("gives a deactivated member a real contact path", async () => {
    state.user = { id: "deactivated" };
    api.fetchMembership.mockResolvedValue({ id: "deactivated", communityId: "community", displayName: "Former member", status: "deactivated", accessLevel: "regular" });
    renderApp("/catalog");
    expect(await screen.findByRole("heading", { name: "Membership deactivated" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Contact an Administrator" })).toHaveAttribute("href", "https://gear.example.test/contact");
  });
});
