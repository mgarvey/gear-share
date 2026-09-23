import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/config/publicOrigin", () => ({ configuredBackupRetentionDays: () => 30, configuredPrivacyContactUrl: () => "https://gear.example.test/privacy-contact" }));
import PrivacyTermsPage from "./PrivacyTermsPage";

describe("gear share privacy and terms", () => {
  it("publishes gear share-specific private handling and highlights exact exclusions", () => {
    render(<MemoryRouter><PrivacyTermsPage /></MemoryRouter>);
    expect(screen.getByRole("heading", { name: "Privacy notice" })).toBeInTheDocument();
    expect(screen.getByText(/Every member must be approved by an Administrator/)).toBeInTheDocument();
    expect(screen.getByText(/Google supplies Supabase a provider identifier, confirmed email, and basic profile information/i)).toBeInTheDocument();
    expect(screen.getByText(/does not use the Google profile image or request access to Google Drive, contacts, calendar, photos, messages/i)).toBeInTheDocument();
    expect(screen.getByText(/Google authentication never approves membership/i)).toBeInTheDocument();
    expect(screen.getByText(/OpenAI/)).toBeInTheDocument();
    expect(screen.getByText(/Amazon SES/)).toBeInTheDocument();
    expect(screen.getByText(/up to 90 days while an application is pending/)).toBeInTheDocument();
    expect(screen.getByText(/other notifications after 365 days/)).toBeInTheDocument();
    expect(screen.getByText(/Encrypted backups may remain for up to 30 days/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "public privacy contact page" })).toHaveAttribute("href", "https://gear.example.test/privacy-contact");
    expect(screen.getByRole("heading", { name: "Not included in this gear share" })).toBeInTheDocument();
    expect(screen.getByText(/automatic membership admission/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "About" })).toHaveAttribute("href", "/about");
    expect(screen.getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/terms");
    expect(screen.queryByText(/indemnif|governing law|publicly visible/i)).not.toBeInTheDocument();
  });
});
