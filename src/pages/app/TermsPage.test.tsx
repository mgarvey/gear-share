import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/config/publicOrigin", () => ({ configuredPrivacyContactUrl: () => "https://gear.example.test/contact" }));

import TermsPage from "./TermsPage";

describe("public Gear Share terms", () => {
  it("publishes bounded operational expectations without inventing acceptance or payment terms", () => {
    render(<MemoryRouter><TermsPage /></MemoryRouter>);

    expect(screen.getByRole("heading", { name: "Terms of use" })).toBeInTheDocument();
    expect(screen.getByText(/an Administrator must approve access/i)).toBeInTheDocument();
    expect(screen.getByText(/Inspect gear before use/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Privacy notice" })).toHaveAttribute("href", "/privacy");
    expect(screen.getByText(/does not create automatic membership, a payment obligation, a legal waiver, or a checkbox-based acceptance requirement/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Contact an Administrator" })).toHaveAttribute("href", "https://gear.example.test/contact");
  });
});
