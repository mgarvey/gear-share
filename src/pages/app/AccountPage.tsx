import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { configuredPublicOrigin } from "@/config/publicOrigin";
import { supabase } from "@/integrations/supabase/client";
import { isPostalCode, normalizePostalCode } from "@/lib/catalog";
import {
  fetchMyPostalCode,
  fetchMyProfileSettings,
  fetchTransactionalEmailPreferences,
  setMyPostalCode,
  updateMyProfileSettings,
  updateTransactionalEmailPreferences,
} from "@/lib/gearShareApi";
import { formatUsPhone, toUsPhoneE164 } from "@/lib/phone";
import type { TransactionalEmailPreferences } from "@/types/gear";

export default function AccountPage({ userId }: { userId: string }) {
  const client = useQueryClient();
  const settings = useQuery({ queryKey: ["my-profile-settings", userId], queryFn: fetchMyProfileSettings });
  const postalCode = useQuery({ queryKey: ["my-postal-code", userId], queryFn: fetchMyPostalCode });
  const preferences = useQuery({ queryKey: ["transactional-email-preferences", userId], queryFn: fetchTransactionalEmailPreferences });
  const [form, setForm] = useState({ displayName: "", introduction: "", phoneE164: "", coordinationNote: "", postalCode: "" });
  const [emailPreferences, setEmailPreferences] = useState<TransactionalEmailPreferences>({ loanActivity: true, loanReminders: true, wantedActivity: true });
  const [newEmail, setNewEmail] = useState("");
  const [emailMessage, setEmailMessage] = useState("");
  useEffect(() => {
    if (settings.data) setForm((current) => ({
      ...current,
      displayName: settings.data.displayName,
      introduction: settings.data.introduction,
      phoneE164: formatUsPhone(settings.data.phoneE164),
      coordinationNote: settings.data.coordinationNote,
    }));
  }, [settings.data]);
  useEffect(() => {
    if (postalCode.data !== undefined) setForm((current) => ({ ...current, postalCode: postalCode.data }));
  }, [postalCode.data]);
  useEffect(() => {
    if (preferences.data) setEmailPreferences(preferences.data);
  }, [preferences.data]);
  const save = useMutation({
    mutationFn: async () => {
      const normalizedPostalCode = normalizePostalCode(form.postalCode);
      if (normalizedPostalCode && !isPostalCode(normalizedPostalCode)) throw new Error("Enter one complete ZIP or postal code.");
      await Promise.all([
        updateMyProfileSettings({
          displayName: form.displayName,
          introduction: form.introduction,
          phoneE164: toUsPhoneE164(form.phoneE164),
          coordinationNote: form.coordinationNote,
        }),
        setMyPostalCode(normalizedPostalCode),
      ]);
      setForm((current) => ({ ...current, postalCode: normalizedPostalCode }));
    },
    onSuccess: () => Promise.all([
      client.invalidateQueries({ queryKey: ["my-profile-settings"] }),
      client.invalidateQueries({ queryKey: ["my-postal-code", userId] }),
      client.invalidateQueries({ queryKey: ["gear-share-membership"] }),
      client.invalidateQueries({ queryKey: ["gear-share-catalog"] }),
      client.invalidateQueries({ queryKey: ["gear-share-supplies"] }),
    ]),
  });
  const savePreferences = useMutation({
    mutationFn: () => updateTransactionalEmailPreferences(emailPreferences),
    onSuccess: () => client.invalidateQueries({ queryKey: ["transactional-email-preferences", userId] }),
  });
  async function requestEmailChange(event: React.FormEvent) {
    event.preventDefault();
    setEmailMessage("");
    try {
      const { error } = await supabase.auth.updateUser({ email: newEmail.trim().toLowerCase() }, { emailRedirectTo: `${configuredPublicOrigin()}/account` });
      if (error) throw error;
      setNewEmail("");
      setEmailMessage("Check both confirmation messages. Your current email stays active until the change is complete.");
    } catch (error) {
      setEmailMessage(error instanceof Error ? error.message : "The email change could not be started.");
    }
  }
  if (settings.isLoading || preferences.isLoading || postalCode.isLoading) return <main className="container mx-auto p-4 md:p-8">Loading account settings…</main>;
  if (settings.error || preferences.error || postalCode.error) return <main className="container mx-auto p-4 md:p-8" role="alert">{((settings.error ?? preferences.error ?? postalCode.error) as Error).message}</main>;
  return <main className="container mx-auto max-w-5xl p-4 md:p-8 space-y-6"><div><h1 className="font-serif text-3xl font-bold">Account settings</h1><p className="text-muted-foreground">Update your profile, pickup details, and notifications.</p></div>
    <div className="grid items-start gap-6 lg:grid-cols-2"><Card><CardHeader><CardTitle>Your profile</CardTitle></CardHeader><CardContent><form className="space-y-4" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
      <div><Label htmlFor="profile-name">Display name</Label><Input id="profile-name" maxLength={80} required value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} /></div>
      <div><Label htmlFor="profile-intro">Short introduction (optional)</Label><Textarea id="profile-intro" maxLength={500} value={form.introduction} onChange={(event) => setForm({ ...form, introduction: event.target.value })} /><p className="text-xs text-muted-foreground">Other active members can see this when your name appears with gear or a loan.</p></div>
      <div><Label htmlFor="profile-phone">Phone for pickup and return (optional)</Label><Input id="profile-phone" inputMode="tel" autoComplete="tel-national" maxLength={14} placeholder="(512) 555-0123" value={form.phoneE164} onChange={(event) => setForm({ ...form, phoneE164: formatUsPhone(event.target.value) })} /><p className="text-xs text-muted-foreground">Shared only with the other person after a loan is approved.</p></div>
      <div><Label htmlFor="profile-note">Pickup and return notes (optional)</Label><Textarea id="profile-note" maxLength={160} value={form.coordinationNote} onChange={(event) => setForm({ ...form, coordinationNote: event.target.value })} /><p className="text-xs text-muted-foreground">Don’t enter a street address. These details are shared only with the other person after a loan is approved.</p></div>
      <div><Label htmlFor="my-postal-code">ZIP code (optional)</Label><Input id="my-postal-code" value={form.postalCode} maxLength={10} onChange={(event) => setForm({ ...form, postalCode: event.target.value })} placeholder="ZIP code" /><p className="text-xs text-muted-foreground">Helps nearby members recognize the general pickup area. Don’t enter a street address.</p></div>
      {save.error ? <p role="alert" className="text-sm text-destructive">{(save.error as Error).message}</p> : null}{save.isSuccess ? <p role="status" className="text-sm">Settings saved.</p> : null}
      <Button disabled={save.isPending}>{save.isPending ? "Saving…" : "Save profile"}</Button>
    </form></CardContent></Card>
    <div className="space-y-6"><Card><CardHeader><CardTitle>Email notifications</CardTitle></CardHeader><CardContent><form className="space-y-4" onSubmit={(event) => { event.preventDefault(); savePreferences.mutate(); }}>
      <p className="text-sm text-muted-foreground">You’ll always see notifications in the app. Important emails about your account and access stay on.</p>
      {([
        ["loanActivity", "Loan activity", "Requests, decisions, checkout, cancellation, and return."],
        ["loanReminders", "Due and overdue reminders", "One reminder before the due date, then a few weekly reminders if it’s late."],
        ["wantedActivity", "Wanted request activity", "Relevant request and offer changes."],
      ] as const).map(([key, label, description]) => <label key={key} className="flex items-start gap-3 rounded-md border p-3">
        <input type="checkbox" className="mt-1 h-4 w-4" checked={emailPreferences[key]} onChange={(event) => setEmailPreferences({ ...emailPreferences, [key]: event.target.checked })} />
        <span><span className="block font-medium">{label}</span><span className="block text-sm text-muted-foreground">{description}</span></span>
      </label>)}
      {savePreferences.error ? <p role="alert" className="text-sm text-destructive">{(savePreferences.error as Error).message}</p> : null}
      {savePreferences.isSuccess ? <p role="status" className="text-sm">Email preferences saved.</p> : null}
      <Button type="submit" variant="outline" disabled={savePreferences.isPending}>{savePreferences.isPending ? "Saving…" : "Save notifications"}</Button>
    </form></CardContent></Card>
      <Card><CardHeader><CardTitle>Email address</CardTitle></CardHeader><CardContent><p className="text-sm text-muted-foreground">Used to sign in and receive email notifications.</p><p className="mb-4 mt-2 text-sm"><strong>Current:</strong> {settings.data!.confirmedEmail}</p><form className="space-y-3" onSubmit={requestEmailChange}><div><Label htmlFor="new-email">New email address</Label><Input id="new-email" type="email" autoComplete="email" maxLength={254} required value={newEmail} onChange={(event) => setNewEmail(event.target.value)} /></div><p className="text-xs text-muted-foreground">Your current address stays active until you confirm the new one.</p>{emailMessage ? <p role="status" className="text-sm">{emailMessage}</p> : null}<Button variant="outline">Change email address</Button></form></CardContent></Card></div></div>
  </main>;
}
