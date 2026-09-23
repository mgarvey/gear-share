import { useEffect, useState } from "react";
import { communityLogoUrl, communityName, gearShareName } from "@/config/community";
import { configuredPublicOrigin } from "@/config/publicOrigin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";

export function Auth({ embedded = false }: { embedded?: boolean }) {
  const [signup, setSignup] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [recoveryCooldown, setRecoveryCooldown] = useState(false);
  const [signupSubmitted, setSignupSubmitted] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!recoveryCooldown) return;
    const timer = window.setTimeout(() => setRecoveryCooldown(false), 60_000);
    return () => window.clearTimeout(timer);
  }, [recoveryCooldown]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    if (forgot) {
      const startedAt = performance.now();
      try {
        const normalizedEmail = email.trim().toLowerCase();
        if (normalizedEmail.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
          await Promise.race([
            supabase.auth.resetPasswordForEmail(normalizedEmail, { redirectTo: `${configuredPublicOrigin()}/reset-password` }),
            new Promise((_, reject) => window.setTimeout(() => reject(new Error("recovery request timeout")), 8_000)),
          ]);
        }
      } catch {
        // The public response intentionally does not reveal configuration,
        // account existence, membership state, throttling, or delivery state.
      }
      const remainingMinimum = Math.max(0, 1_000 - (performance.now() - startedAt));
      await new Promise((resolve) => window.setTimeout(resolve, remainingMinimum));
      setBusy(false);
      setRecoveryCooldown(true);
      setMessage("If the address can receive a reset message, it will arrive with next steps. You may try again in one minute.");
      return;
    }
    try {
      const result = signup
        ? await supabase.auth.signUp({ email: email.trim(), password, options: { data: { display_name: displayName.trim() } } })
        : await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (result.error) setMessage(result.error.message);
      else if (signup) setSignupSubmitted(true);
    } catch {
      setMessage("We couldn't reach the account service. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function continueWithGoogle() {
    setBusy(true);
    setMessage("");
    try {
      const result = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: configuredPublicOrigin() },
      });
      if (result.error) setMessage("Google sign-in couldn't start. Check your connection and try again.");
    } catch {
      setMessage("Google sign-in couldn't start. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const Wrapper = embedded ? "section" : "main";
  const showSignIn = () => {
    setSignup(false);
    setForgot(false);
    setSignupSubmitted(false);
    setMessage("");
    setPassword("");
  };
  const showRecovery = () => {
    setSignup(false);
    setForgot(true);
    setSignupSubmitted(false);
    setMessage("");
    setPassword("");
  };
  const showSignup = () => {
    setSignup(true);
    setForgot(false);
    setSignupSubmitted(false);
    setMessage("");
    setPassword("");
  };

  return (
    <Wrapper aria-label={embedded ? "Account access" : undefined} className={embedded ? "w-full" : "min-h-screen bg-sand grid place-items-center px-5"}>
      <div className="w-full max-w-md overflow-hidden rounded-xl border bg-white shadow-sm">
        <div className="flex items-center gap-4 bg-primary px-6 py-5 text-white sm:px-8">
          <img src={communityLogoUrl} alt="" className="h-16 w-14 shrink-0 object-contain" />
          <div>
            <p className="text-xl font-bold leading-tight">{communityName}</p>
            <p className="text-base font-medium text-white/90">Gear Share</p>
          </div>
        </div>
        <div className="p-6 sm:p-8">
          <h1 className="font-serif text-3xl font-bold text-deep-brown">{signupSubmitted ? "Check your next step" : forgot ? "Reset your password" : signup ? "Request membership" : "Welcome back"}</h1>
          <p className="mt-2 mb-6 text-muted-foreground">{signupSubmitted ? "Your signup request was accepted." : forgot ? "We’ll email instructions if this address can receive a reset message." : signup ? `Create an account to request access to ${gearShareName}.` : "Sign in to share and borrow gear with the community."}</p>
          {signupSubmitted ? (
            <div className="space-y-4">
              <p role="status" className="text-sm leading-relaxed text-foreground">If this address needs confirmation, an email will arrive shortly. If you’ve used Gear Share before, sign in or reset your password instead.</p>
              <Button className="w-full" onClick={showSignIn}>Sign in</Button>
              <Button variant="outline" className="w-full" onClick={showRecovery}>Reset password</Button>
              <Button variant="link" className="w-full" onClick={showSignup}>Use a different email</Button>
            </div>
          ) : (
            <>
              <form onSubmit={submit} className="space-y-4">
                {signup ? <div><Label htmlFor="name">Member display name</Label><Input id="name" maxLength={80} value={displayName} onChange={(e) => setDisplayName(e.target.value)} required /></div> : null}
                <div><Label htmlFor="email">Email</Label><Input id="email" type="email" autoComplete="email" maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
                {!forgot ? <div><Label htmlFor="password">Password</Label><Input id="password" type="password" minLength={12} autoComplete={signup ? "new-password" : "current-password"} value={password} onChange={(e) => setPassword(e.target.value)} required /></div> : null}
                {message ? <p role="status" className="text-sm text-muted-foreground">{message}</p> : null}
                <Button className="w-full" disabled={busy || (forgot && recoveryCooldown)}>{busy ? "Working…" : forgot && recoveryCooldown ? "Try again in one minute" : forgot ? "Request password reset" : signup ? "Request membership" : "Sign in"}</Button>
              </form>
              {!forgot ? <><div className="my-5 flex items-center gap-3" aria-hidden="true"><span className="h-px flex-1 bg-border" /><span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">or</span><span className="h-px flex-1 bg-border" /></div>
              <Button type="button" variant="outline" className="w-full" disabled={busy} onClick={() => void continueWithGoogle()}>{busy ? "Connecting…" : "Continue with Google"}</Button>
              <p className="mt-2 text-center text-xs text-muted-foreground">Google sign-in alone does not approve membership.</p>
              <Button variant="link" className="w-full mt-3" onClick={signup ? showSignIn : showSignup}>
                {signup ? "Already registered? Sign in" : "New member? Request membership"}
              </Button>{!signup ? <Button variant="link" className="w-full" onClick={showRecovery}>Forgot password?</Button> : null}</> : <Button variant="link" className="w-full mt-3" onClick={showSignIn}>Back to sign in</Button>}
            </>
          )}
        </div>
      </div>
    </Wrapper>
  );
}
