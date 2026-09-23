import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/config/community", () => ({ communityName: "Community", gearShareName: "Community Gear Share", communityLogoUrl: "/favicon.png" }));

const auth = vi.hoisted(() => ({
  resetPasswordForEmail: vi.fn(), signInWithOAuth: vi.fn(), signInWithPassword: vi.fn(), signUp: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth } }));
vi.mock("@/config/publicOrigin", () => ({ configuredPublicOrigin: () => "https://gear.example.test" }));

import { Auth } from "./Auth";

describe("password recovery request", () => {
  beforeEach(() => vi.resetAllMocks());

  it("uses one fixed callback and gives a non-enumerating response on provider error", async () => {
    const user = userEvent.setup();
    auth.resetPasswordForEmail.mockResolvedValue({ error: new Error("unknown account") });
    render(<Auth />);
    await user.click(screen.getByRole("button", { name: "Forgot password?" }));
    await user.type(screen.getByLabelText("Email"), " MEMBER@Example.Test ");
    await user.click(screen.getByRole("button", { name: "Request password reset" }));

    await waitFor(() => expect(auth.resetPasswordForEmail).toHaveBeenCalledWith("member@example.test", { redirectTo: "https://gear.example.test/reset-password" }));
    expect(await screen.findByText(/If the address can receive a reset message/)).toBeInTheDocument();
    expect(screen.queryByText("unknown account")).not.toBeInTheDocument();
  });

  it("does not request a reset for a syntactically invalid address but returns the same response", async () => {
    const user = userEvent.setup();
    render(<Auth />);
    await user.click(screen.getByRole("button", { name: "Forgot password?" }));
    const email = screen.getByLabelText("Email");
    await user.type(email, "invalid@example");
    email.removeAttribute("type");
    await user.click(screen.getByRole("button", { name: "Request password reset" }));

    expect(await screen.findByText(/If the address can receive a reset message/)).toBeInTheDocument();
    expect(auth.resetPasswordForEmail).not.toHaveBeenCalled();
  });
});

describe("sign in", () => {
  beforeEach(() => vi.resetAllMocks());

  it("starts Google authentication with only the fixed configured origin", async () => {
    const user = userEvent.setup();
    auth.signInWithOAuth.mockResolvedValue({ data: { provider: "google", url: "https://accounts.google.test" }, error: null });
    render(<Auth />);

    expect(screen.getByText("Google sign-in alone does not approve membership.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continue with Google" }));

    await waitFor(() => expect(auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: { redirectTo: "https://gear.example.test" },
    }));
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeEnabled();
  });

  it("replaces Google provider details with one retryable error", async () => {
    const user = userEvent.setup();
    auth.signInWithOAuth.mockResolvedValue({ data: { provider: "google", url: null }, error: new Error("client_secret rejected") });
    render(<Auth />);

    await user.click(screen.getByRole("button", { name: "Continue with Google" }));

    expect(await screen.findByText("Google sign-in couldn't start. Check your connection and try again.")).toBeInTheDocument();
    expect(screen.queryByText(/client_secret rejected/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeEnabled();
  });

  it("bounds thrown Google provider failures and allows retry", async () => {
    const user = userEvent.setup();
    auth.signInWithOAuth.mockRejectedValue(new TypeError("network provider detail"));
    render(<Auth />);

    await user.click(screen.getByRole("button", { name: "Continue with Google" }));

    expect(await screen.findByText("Google sign-in couldn't start. Check your connection and try again.")).toBeInTheDocument();
    expect(screen.queryByText(/network provider detail/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeEnabled();
  });

  it("keeps Google authentication out of password recovery", async () => {
    const user = userEvent.setup();
    render(<Auth />);

    await user.click(screen.getByRole("button", { name: "Forgot password?" }));

    expect(screen.queryByRole("button", { name: "Continue with Google" })).not.toBeInTheDocument();
  });

  it("recovers from a network failure and lets the member try again", async () => {
    const user = userEvent.setup();
    auth.signInWithPassword.mockRejectedValueOnce(new TypeError("Load failed"));
    render(<Auth />);

    await user.type(screen.getByLabelText("Email"), "member@example.test");
    await user.type(screen.getByLabelText("Password"), "a-long-test-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("We couldn't reach the account service. Check your connection and try again.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
    expect(screen.queryByText("Load failed")).not.toBeInTheDocument();
  });
});

describe("membership signup", () => {
  beforeEach(() => vi.resetAllMocks());

  it("gives a truthful non-enumerating next step when signup is accepted", async () => {
    const user = userEvent.setup();
    auth.signUp.mockResolvedValue({ data: { user: { identities: [] } }, error: null });
    render(<Auth />);

    await user.click(screen.getByRole("button", { name: "New member? Request membership" }));
    await user.type(screen.getByLabelText("Member display name"), "Existing Member");
    await user.type(screen.getByLabelText("Email"), "existing@example.test");
    await user.type(screen.getByLabelText("Password"), "a-long-test-password");
    await user.click(screen.getByRole("button", { name: "Request membership" }));

    expect(await screen.findByRole("heading", { name: "Check your next step" })).toBeInTheDocument();
    expect(screen.getByText(/If this address needs confirmation/)).toBeInTheDocument();
    expect(screen.queryByText(/Check your email to confirm your account/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Reset password" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Use a different email" })).toBeEnabled();
  });

  it("moves from the signup next step to password recovery without losing the email", async () => {
    const user = userEvent.setup();
    auth.signUp.mockResolvedValue({ data: { user: { identities: [] } }, error: null });
    render(<Auth />);

    await user.click(screen.getByRole("button", { name: "New member? Request membership" }));
    await user.type(screen.getByLabelText("Member display name"), "Existing Member");
    await user.type(screen.getByLabelText("Email"), "existing@example.test");
    await user.type(screen.getByLabelText("Password"), "a-long-test-password");
    await user.click(screen.getByRole("button", { name: "Request membership" }));
    await user.click(await screen.findByRole("button", { name: "Reset password" }));

    expect(screen.getByRole("heading", { name: "Reset your password" })).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveValue("existing@example.test");
    expect(screen.getByRole("button", { name: "Request password reset" })).toBeEnabled();
  });

  it("shows the neutral community brand on account access", () => {
    render(<Auth />);
    expect(screen.getByText("Community")).toBeInTheDocument();
    expect(screen.getByText("Gear Share")).toBeInTheDocument();
  });
});
