import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/config/publicOrigin", () => ({ configuredPrivacyContactUrl: () => "https://gear.example.test/contact" }));
vi.mock("@/config/community", () => ({ communityName: "Community", gearShareName: "Community Gear Share", communityLogoUrl: "/favicon.png" }));

import AboutPage from "./AboutPage";

describe("public Gear Share overview", () => {
  it("explains the private service, approval boundary, and limited Google identity purpose", () => {
    render(<MemoryRouter><AboutPage /></MemoryRouter>);

    expect(screen.getByRole("heading", { name: "Community Gear Share" })).toBeInTheDocument();
    expect(screen.getByText(/catalog, gear photos, member details, and loan activity are not public/i)).toBeInTheDocument();
    expect(screen.getByText(/Every applicant remains pending until a Community Administrator/i)).toBeInTheDocument();
    expect(screen.getByText(/does not give Gear Share access to your Google Drive, contacts, calendar, photos, or messages/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Request membership" })).toHaveAttribute("href", "/join");
    expect(screen.getByRole("link", { name: "Privacy notice" })).toHaveAttribute("href", "/privacy");
    expect(screen.getByRole("link", { name: "Terms of use" })).toHaveAttribute("href", "/terms");
  });
});
