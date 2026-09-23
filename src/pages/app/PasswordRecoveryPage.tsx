import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export default function PasswordRecoveryPage() {
  const { user, isReady, isPasswordRecovery } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (window.location.search || window.location.hash) window.history.replaceState(null, "", "/reset-password");
  }, []);
  async function replacePassword(event: React.FormEvent) {
    event.preventDefault();
    if (password.length < 12 || password !== confirmation) {
      setMessage("Use at least 12 characters and enter the same password twice.");
      return;
    }
    setBusy(true);
    let updated;
    try {
      updated = await supabase.auth.updateUser({ password });
    } catch {
      setMessage("This recovery session is invalid or expired. Start a new password reset.");
      setBusy(false);
      return;
    }
    if (updated.error) {
      setMessage("This recovery session is invalid or expired. Start a new password reset.");
      setBusy(false);
      return;
    }
    let signedOut;
    try {
      signedOut = await supabase.auth.signOut({ scope: "global" });
    } catch {
      signedOut = { error: new Error("global sign-out unavailable") };
    }
    setPassword(""); setConfirmation(""); setBusy(false);
    if (signedOut.error) {
      setMessage("Your password changed, but global session revocation could not be confirmed. Close this browser and contact an Administrator before signing in again.");
      return;
    }
    navigate("/account", { replace: true });
  }
  return <main className="min-h-screen grid place-items-center bg-sand px-5"><div className="w-full max-w-md rounded-xl border bg-white p-6 shadow-sm sm:p-8"><h1 className="font-serif text-2xl font-bold">Replace your password</h1>
    {!isReady ? <p className="mt-4">Checking recovery link…</p> : !user || !isPasswordRecovery ? <><p className="my-4">This recovery link is invalid, expired, already used, or is not a password-recovery session. No account change was made.</p><Button onClick={() => navigate("/", { replace: true })}>Start again</Button></> : <form className="mt-5 space-y-4" onSubmit={replacePassword}><div><Label htmlFor="recovery-password">New password</Label><Input id="recovery-password" type="password" autoComplete="new-password" minLength={12} required value={password} onChange={(event) => setPassword(event.target.value)} /></div><div><Label htmlFor="recovery-confirmation">Confirm new password</Label><Input id="recovery-confirmation" type="password" autoComplete="new-password" minLength={12} required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></div>{message ? <p role="alert" className="text-sm">{message}</p> : null}<Button disabled={busy}>{busy ? "Replacing…" : "Replace password and sign out other sessions"}</Button></form>}
  </div></main>;
}
