import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ user: { id: "member" }, isReady: true, isPasswordRecovery: false }));
const auth = vi.hoisted(() => ({ updateUser: vi.fn(), signOut: vi.fn() }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => state }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth } }));

import PasswordRecoveryPage from "./PasswordRecoveryPage";

function renderRecovery() {
  render(<MemoryRouter initialEntries={["/reset-password"]}><Routes><Route path="/reset-password" element={<PasswordRecoveryPage />} /><Route path="/account" element={<p>Signed out account route</p>} /></Routes></MemoryRouter>);
}

describe("password replacement callback", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    Object.assign(state, { user: { id: "member" }, isReady: true, isPasswordRecovery: false });
  });

  it("rejects an ordinary signed-in session on the recovery route", () => {
    renderRecovery();
    expect(screen.getByText(/is not a password-recovery session/)).toBeInTheDocument();
    expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
  });

  it("scrubs recovery parameters from browser history before presenting the callback", async () => {
    window.history.replaceState(null, "", "/reset-password?code=one-time-secret#access-token");
    renderRecovery();

    await waitFor(() => expect(window.location.href).not.toMatch(/one-time-secret|access-token/));
    expect(window.location.pathname).toBe("/reset-password");
    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe("");
  });

  it("updates only in a recovery session and globally signs out afterward", async () => {
    const user = userEvent.setup();
    state.isPasswordRecovery = true;
    auth.updateUser.mockResolvedValue({ error: null });
    auth.signOut.mockResolvedValue({ error: null });
    renderRecovery();

    await user.type(screen.getByLabelText("New password"), "correct horse battery staple");
    await user.type(screen.getByLabelText("Confirm new password"), "correct horse battery staple");
    await user.click(screen.getByRole("button", { name: "Replace password and sign out other sessions" }));

    await waitFor(() => expect(auth.updateUser).toHaveBeenCalledWith({ password: "correct horse battery staple" }));
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "global" });
    expect(await screen.findByText("Signed out account route")).toBeInTheDocument();
  });

  it("does not claim completion when global session revocation fails", async () => {
    const user = userEvent.setup();
    state.isPasswordRecovery = true;
    auth.updateUser.mockResolvedValue({ error: null });
    auth.signOut.mockResolvedValue({ error: new Error("revocation unavailable") });
    renderRecovery();

    await user.type(screen.getByLabelText("New password"), "correct horse battery staple");
    await user.type(screen.getByLabelText("Confirm new password"), "correct horse battery staple");
    await user.click(screen.getByRole("button", { name: "Replace password and sign out other sessions" }));

    expect(await screen.findByText(/global session revocation could not be confirmed/)).toBeInTheDocument();
    expect(screen.queryByText("Signed out account route")).not.toBeInTheDocument();
  });
});
