import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { configuredJoinUrl, isDevelopmentInviteUrl } from "@/config/publicOrigin";
import {
  fetchCommunitySettings,
  checkAiActivation,
  fetchNotificationDeliveryDiagnostics,
  setAdministratorEmailSuppression,
  setAiDraftingEnabled,
  updateCommunityDisplayName,
} from "@/lib/gearShareApi";
import { JoinQuestionEditor, MembershipWorkspace } from "@/pages/app/MembershipAdministration";
import type { Membership } from "@/types/gear";

const emailEventLabels: Record<string, string> = {
  membership_application_submitted: "Membership application received",
  membership_approved: "Membership approved",
  membership_rejected: "Membership decision",
  membership_reapplication_allowed: "New application invited",
  membership_reactivated: "Membership restored",
  membership_reactivated_admin: "Member membership restored",
  role_promoted: "Access level changed",
  role_promoted_admin: "Member access increased",
  role_demoted: "Access level changed",
  role_demoted_admin: "Member access reduced",
  membership_deactivated: "Membership deactivated",
  membership_deactivated_admin: "Member membership paused",
  loan_requested: "Loan requested",
  loan_approved: "Loan approved",
  loan_declined: "Loan declined",
  loan_checked_out: "Loan checked out",
  loan_cancelled: "Loan cancelled",
  loan_returned: "Loan returned",
  loan_due_soon: "Loan due soon",
  loan_overdue: "Loan overdue",
  wanted_request_created: "Wanted request posted",
  wanted_offer_created: "Gear offered",
  wanted_offer_selected: "Offer selected",
  wanted_offer_invalidated: "Offer no longer available",
  wanted_request_moderated: "Wanted request moderated",
  wanted_request_restored: "Wanted request restored",
};

const emailStatusLabels: Record<string, string> = {
  pending: "Waiting to send",
  claimed: "Sending",
  retry: "Will retry",
  sent: "Sent",
  suppressed: "Paused",
  permanent_failure: "Could not be delivered",
  ambiguous: "Delivery needs review",
};

function friendlyLabel(value: string, labels: Record<string, string>) {
  return labels[value] ?? value.replace(/_/g, " ").replace(/^./, (character) => character.toUpperCase());
}

function DeliveryWorkspace() {
  const client = useQueryClient();
  const diagnostics = useQuery({ queryKey: ["notification-delivery-diagnostics"], queryFn: fetchNotificationDeliveryDiagnostics });
  const suppress = useMutation({
    mutationFn: ({ userId, value }: { userId: string; value: boolean }) => setAdministratorEmailSuppression(userId, value),
    onSuccess: () => client.invalidateQueries({ queryKey: ["notification-delivery-diagnostics"] }),
  });
  return <Card><CardHeader><CardTitle>Email activity</CardTitle></CardHeader><CardContent className="space-y-3">
    <p className="text-sm text-muted-foreground">See whether recent member emails were sent. Email addresses and message text stay private.</p>
    {diagnostics.isLoading ? <p>Loading email activity…</p> : null}
    {diagnostics.error ? <p role="alert" className="text-sm text-destructive">{(diagnostics.error as Error).message}</p> : null}
    {diagnostics.data?.length === 0 ? <p className="text-sm text-muted-foreground">No delivery records yet.</p> : null}
    {diagnostics.data?.map((row) => <div key={row.outboxId} className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1"><p className="font-medium">{row.recipientDisplayName}</p><p className="text-sm text-muted-foreground">{friendlyLabel(row.eventType, emailEventLabels)} · {friendlyLabel(row.status, emailStatusLabels)}</p><p className="text-xs text-muted-foreground">{row.attemptCount === 0 ? "Not attempted yet" : `${row.attemptCount} delivery attempt${row.attemptCount === 1 ? "" : "s"}`}</p>{row.suppressionReason ? <p className="text-sm">Email paused: {friendlyLabel(row.suppressionReason, { administrator: "Paused by an Administrator", complaint: "Recipient complaint", permanent_bounce: "Address could not receive email" })}</p> : null}</div>
      {!row.suppressionReason ? <Button size="sm" variant="outline" disabled={suppress.isPending} onClick={() => suppress.mutate({ userId: row.recipientUserId, value: true })}>Pause email</Button> : null}
      {row.suppressionReason === "administrator" ? <Button size="sm" variant="outline" disabled={suppress.isPending} onClick={() => suppress.mutate({ userId: row.recipientUserId, value: false })}>Resume email</Button> : null}
    </div>)}
    {suppress.error ? <p role="alert" className="text-sm text-destructive">{(suppress.error as Error).message}</p> : null}
  </CardContent></Card>;
}

function administrationSection(hash: string) {
  return hash === "#settings" ? "community" : hash === "#setup" ? "setup" : hash === "#email" ? "email" : "members";
}

function InviteWorkspace({ communityName }: { communityName: string }) {
  const joinUrl = configuredJoinUrl();
  const invitationText = `You're invited to join ${communityName} Gear Share. Submit an application using the link below. An administrator will review it before granting access.`;
  const message = `${invitationText}\n\n${joinUrl}`;
  const [status, setStatus] = useState("");
  const copy = async (value: string, label: string) => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(value);
      setStatus(`${label} copied.`);
    } catch {
      setStatus("Automatic copy was unavailable. Select and copy the invitation below.");
    }
  };
  const share = async () => {
    if (!navigator.share) {
      setStatus("Sharing is unavailable here. Use a copy button instead.");
      return;
    }
    try {
      await navigator.share({ title: `${communityName} invitation`, text: invitationText, url: joinUrl });
      setStatus("Invitation shared.");
    } catch (error) {
      setStatus((error as Error).name === "AbortError" ? "Sharing cancelled. The copy options remain available." : "Sharing failed. Use a copy button instead.");
    }
  };
  return <Card><CardHeader><CardTitle>Invite new members</CardTitle></CardHeader><CardContent className="space-y-3">
    <p className="text-sm text-muted-foreground">Share this invitation in a newsletter, email, or message. An administrator will review each application before granting access.</p>
    {isDevelopmentInviteUrl(joinUrl) ? <p role="note" className="rounded-md border border-amber-500 bg-amber-50 p-2 text-sm text-amber-950">Development-only link. It will not work for newsletter recipients.</p> : null}
    <Label htmlFor="invite-message">Message preview</Label>
    <textarea id="invite-message" className="min-h-24 w-full rounded-md border bg-background p-3 text-sm" readOnly value={message} />
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" onClick={() => void copy(joinUrl, "Application link")}>Copy application link</Button>
      <Button variant="outline" onClick={() => void copy(message, "Invitation")}>Copy invitation</Button>
      <Button variant="outline" onClick={() => void share()}>Share invitation</Button>
    </div>
    {status ? <p role="status" className="text-sm text-muted-foreground">{status}</p> : null}
  </CardContent></Card>;
}

function CommunitySettingsWorkspace() {
  const client = useQueryClient();
  const settings = useQuery({ queryKey: ["community-settings"], queryFn: fetchCommunitySettings });
  const [name, setName] = useState("");
  const [aiStatus, setAiStatus] = useState("");
  useEffect(() => { if (settings.data) setName(settings.data.displayName); }, [settings.data]);
  const rename = useMutation({
    mutationFn: () => updateCommunityDisplayName(name, settings.data!.configurationVersion),
    onSuccess: () => client.invalidateQueries({ queryKey: ["community-settings"] }),
  });
  const ai = useMutation({
    mutationFn: async (enabled: boolean) => {
      if (enabled) await checkAiActivation();
      return setAiDraftingEnabled(enabled, settings.data!.configurationVersion);
    },
    onSuccess: async (result) => {
      setAiStatus(result.aiDraftingEnabled ? "AI suggestions are ready for members." : "AI suggestions are not ready yet. Members can still add gear without them.");
      await client.invalidateQueries({ queryKey: ["community-settings"] });
    },
  });
  return <Card><CardHeader><CardTitle>Community settings</CardTitle></CardHeader><CardContent className="space-y-5">
    {settings.isLoading ? <p>Loading settings…</p> : null}
    {settings.error ? <p role="alert" className="text-sm text-destructive">{(settings.error as Error).message}</p> : null}
    {settings.data ? <>
      <div className="space-y-2"><Label htmlFor="community-display-name">Community display name</Label><div className="flex flex-col gap-2 sm:flex-row"><Input id="community-display-name" maxLength={80} value={name} onChange={(event) => setName(event.target.value)} /><Button disabled={rename.isPending || !name.trim()} onClick={() => rename.mutate()}>Save name</Button></div></div>
      <div className="rounded-md border p-3"><p className="font-medium">AI listing suggestions</p><p className="mb-3 text-sm text-muted-foreground">{settings.data.aiDraftingEnabled ? "Members can choose AI help for a listing." : "AI help is off. Members can still add gear manually."}</p><Button variant="outline" disabled={ai.isPending} onClick={() => ai.mutate(!settings.data.aiDraftingEnabled)}>{ai.isPending ? "Checking connection…" : settings.data.aiDraftingEnabled ? "Turn off AI suggestions" : "Test connection and turn on"}</Button>{aiStatus ? <p role="status" className="mt-2 text-sm">{aiStatus}</p> : null}</div>
      {rename.isSuccess ? <p role="status" className="text-sm">Community name saved.</p> : null}
      {rename.error || ai.error ? <p role="alert" className="text-sm text-destructive">{((rename.error || ai.error) as Error).message}</p> : null}
    </> : null}
  </CardContent></Card>;
}

function OrientationWorkspace() {
  const setup = [
    { title: "Set the community name", description: "Choose the name members will see throughout the gear share.", to: "/administration#settings", action: "Open community settings" },
    { title: "Choose application questions", description: "Ask only what you need to decide whether someone should join.", to: "/administration#settings", action: "Review application questions" },
    { title: "Review privacy and terms", description: "See what members can view and how their information is handled.", to: "/privacy", action: "Read privacy and terms" },
  ];
  const ongoing = [
    { title: "Membership requests", description: "Review and decide new applications.", to: "/administration#members", action: "Manage members" },
    { title: "Group gear", description: "Add gear owned by the group and choose who handles pickup.", to: "/inventory", action: "Manage group gear" },
    { title: "Loans", description: "Handle requests, pickups, returns, and items that need attention.", to: "/loans", action: "Manage loans" },
    { title: "Email activity", description: "Check whether member emails were sent or paused.", to: "/administration#email", action: "View email activity" },
  ];
  const links = (items: typeof setup) => <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{items.map((item) => <div key={item.title} className="flex h-full flex-col rounded-md border p-4"><h3 className="font-semibold">{item.title}</h3><p className="mb-4 mt-1 flex-1 text-sm text-muted-foreground">{item.description}</p><Link className="text-sm font-medium text-terracotta underline" to={item.to}>{item.action}</Link></div>)}</div>;
  return <div className="space-y-6">
    <Card><CardHeader><CardTitle>Set up your community</CardTitle></CardHeader><CardContent className="space-y-4"><p className="text-sm text-muted-foreground">These are useful when you first open the gear share. You can return to them whenever something changes.</p>{links(setup)}</CardContent></Card>
    <Card><CardHeader><CardTitle>Regular administrator work</CardTitle></CardHeader><CardContent className="space-y-4"><p className="text-sm text-muted-foreground">Use these shortcuts for the work you’ll return to regularly.</p>{links(ongoing)}</CardContent></Card>
  </div>;
}

export default function AdministrationPage({ membership }: { membership: Membership }) {
  const settings = useQuery({ queryKey: ["community-settings"], queryFn: fetchCommunitySettings });
  const location = useLocation();
  const navigate = useNavigate();
  const [section, setSection] = useState(() => administrationSection(location.hash));
  useEffect(() => setSection(administrationSection(location.hash)), [location.hash]);
  const changeSection = (next: string) => {
    setSection(next);
    const hash = next === "community" ? "#settings" : next === "setup" ? "#setup" : next === "email" ? "#email" : "#members";
    navigate({ pathname: location.pathname, search: location.search, hash }, { replace: true });
  };
  return <main className="container mx-auto p-4 md:p-8 space-y-6">
    <div className="mb-6"><h1 className="font-serif text-3xl font-bold">Administration</h1><p className="text-muted-foreground">Manage people, community settings, and member email.</p></div>
    <Tabs value={section} onValueChange={changeSection}><TabsList className="grid h-auto w-full grid-cols-2 sm:grid-cols-4" aria-label="Administration sections"><TabsTrigger value="members">Members</TabsTrigger><TabsTrigger value="community">Community</TabsTrigger><TabsTrigger value="setup">Admin guide</TabsTrigger><TabsTrigger value="email">Email activity</TabsTrigger></TabsList>
      <TabsContent value="members" id="members" className="mt-6"><MembershipWorkspace membership={membership} includeJoinQuestions={false} /></TabsContent>
      <TabsContent value="community" id="settings" className="mt-6 space-y-6"><InviteWorkspace communityName={settings.data?.displayName ?? "the private gear share"} /><CommunitySettingsWorkspace /><JoinQuestionEditor /></TabsContent>
      <TabsContent value="setup" className="mt-6"><OrientationWorkspace /></TabsContent>
      <TabsContent value="email" className="mt-6"><DeliveryWorkspace /></TabsContent>
    </Tabs>
  </main>;
}
