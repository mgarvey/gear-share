import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ fetchJoinQuestions: vi.fn() }));
vi.mock("@/lib/gearShareApi", () => api);
vi.mock("@/components/gear/Auth", () => ({ Auth: ({ embedded }: { embedded?: boolean }) => <section>Account access {embedded ? "embedded" : "standalone"}</section> }));
import JoinPage from "./JoinPage";

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter><JoinPage /></MemoryRouter></QueryClientProvider>);
}

describe("public join landing", () => {
  it("shows only the configured name, current questions, mandatory approval, privacy, and account entry", async () => {
    api.fetchJoinQuestions.mockResolvedValue({ communityName: "Trail Group", versionId: "version-4", questions: [{ id: "q1", prompt: "How will you use shared gear?", required: true }] });
    renderPage();
    expect(await screen.findByRole("heading", { name: "Request membership in Trail Group" })).toBeInTheDocument();
    expect(screen.getByText(/Every applicant must be approved by an Administrator/)).toBeInTheDocument();
    expect(screen.getByText(/How will you use shared gear/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "privacy notice" })).toHaveAttribute("href", "/privacy");
    expect(screen.getByRole("link", { name: "terms of use" })).toHaveAttribute("href", "/terms");
    expect(screen.getByText("Account access embedded")).toBeInTheDocument();
    expect(screen.queryByText(/member count|catalog items|loan activity/i)).not.toBeInTheDocument();
  });
});
