import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { CoordinatorInventory } from "@/components/gear/CoordinatorInventory";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  allowMembershipReapplication,
  deactivateMember,
  deleteDeactivatedMember,
  decideMembership,
  fetchActiveMembers,
  fetchMemberAdministration,
  fetchPendingMembers,
  fetchReactivationImpact,
  fetchJoinQuestions,
  fetchSupplies,
  getDeactivationImpact,
  publishJoinQuestions,
  reactivateMember,
  sendPreapprovedMemberInvitation,
  setAccessLevel,
} from "@/lib/gearShareApi";
import type { AccessLevel, JoinQuestion, MemberAdministrationRecord, Membership } from "@/types/gear";

type ActiveMember = MemberAdministrationRecord;

export default function MembershipAdministration({ membership }: { membership: Membership }) {
  const [params, setParams] = useSearchParams();
  const isAdministrator = membership.accessLevel === "administrator";
  const requestedView = params.get("view");
  const view = isAdministrator && requestedView === "members" ? "members" : "inventory";
  const supplies = useQuery({ queryKey: ["gear-share-supplies"], queryFn: fetchSupplies, enabled: view === "inventory" });
  const activeMembers = useQuery({ queryKey: ["active-members"], queryFn: () => fetchActiveMembers() });

  const inventory = (
    <CoordinatorInventory
      membership={membership}
      supplies={supplies.data ?? []}
      members={activeMembers.data ?? []}
      isLoading={supplies.isLoading}
      error={supplies.error as Error | null}
    />
  );

  if (!isAdministrator) {
    return <main className="container mx-auto p-4 md:p-8">
      <div className="mb-6"><h1 className="font-serif text-3xl font-bold">Inventory</h1><p className="text-muted-foreground">Manage group-owned gear and inventory details.</p></div>
      {inventory}
    </main>;
  }

  const changeView = (nextView: string) => {
    const next = new URLSearchParams(params);
    next.set("view", nextView === "members" ? "members" : "inventory");
    setParams(next);
  };

  return <main className="container mx-auto p-4 md:p-8">
    <div className="mb-6"><h1 className="font-serif text-3xl font-bold">Administration</h1><p className="text-muted-foreground">Manage inventory, membership, and access in separate workspaces.</p></div>
    <Tabs value={view} onValueChange={changeView}>
      <TabsList aria-label="Administration workspaces"><TabsTrigger value="inventory">Inventory</TabsTrigger><TabsTrigger value="members">Members</TabsTrigger></TabsList>
      <TabsContent value="inventory" className="mt-6">{inventory}</TabsContent>
      <TabsContent value="members" className="mt-6"><MembershipWorkspace membership={membership} /></TabsContent>
    </Tabs>
  </main>;
}

export function MembershipWorkspace({ membership, includeJoinQuestions = true }: { membership: Membership; includeJoinQuestions?: boolean }) {
  const client = useQueryClient();
  const pending = useQuery({
    queryKey: ["pending-members", membership.id], queryFn: fetchPendingMembers,
    staleTime: 0, gcTime: 0, refetchInterval: 10_000, refetchOnWindowFocus: true,
  });
  const administration = useQuery({ queryKey: ["member-administration", membership.id], queryFn: fetchMemberAdministration });
  const pendingRows = pending.error ? [] : pending.data ?? [];
  const decision = useMutation({
    mutationFn: ({ id, approve }: { id: string; approve: boolean }) => decideMembership(id, approve),
    onSuccess: () => Promise.all([
      client.invalidateQueries({ queryKey: ["pending-members"] }),
      client.invalidateQueries({ queryKey: ["active-members"] }),
      client.invalidateQueries({ queryKey: ["member-administration"] }),
    ]),
  });

  return <div className="space-y-10">
    <PersonalInvitationForm membershipId={membership.id} />
    <section aria-labelledby="approvals-heading">
      <h2 id="approvals-heading" className="mb-2 font-serif text-2xl font-bold">People waiting for approval</h2>
      <div className="space-y-3">
        {pendingRows.map((person) => <Card key={person.id}><CardContent className="pt-6"><div className="flex flex-wrap items-center justify-between gap-3"><div><p>{person.display_name}</p><p className="text-sm text-muted-foreground">Confirmed account: {person.confirmed_email}</p></div><div className="flex gap-2"><Button size="sm" onClick={() => decision.mutate({ id: person.id, approve: true })}>Approve</Button><Button size="sm" variant="outline" onClick={() => decision.mutate({ id: person.id, approve: false })}>Reject</Button></div></div>{person.answer_snapshot.length ? <dl className="mt-4 space-y-3 border-t pt-4 text-sm">{person.answer_snapshot.map((answer) => <div key={answer.id}><dt className="font-medium">{answer.prompt}</dt><dd className="whitespace-pre-wrap text-muted-foreground">{answer.answer || "No optional answer"}</dd></div>)}</dl> : <p className="mt-3 text-sm text-muted-foreground">No join questions were configured when this application was submitted.</p>}</CardContent></Card>)}
        {pending.error ? <p role="alert" className="text-destructive">Pending applications are unavailable. Refresh after confirming Administrator access.</p> : null}
        {decision.error ? <p className="text-destructive">{(decision.error as Error).message}</p> : null}
        {!pending.isLoading && !pending.error && pendingRows.length === 0 ? <p className="rounded-md border border-dashed p-6 text-center text-muted-foreground">No one is waiting for approval.</p> : null}
      </div>
    </section>
    {includeJoinQuestions ? <JoinQuestionEditor /> : null}
    <MemberAdministration members={administration.data ?? []} currentUserId={membership.id} />
  </div>;
}

function PersonalInvitationForm({ membershipId }: { membershipId: string }) {
  const client = useQueryClient();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const invitation = useMutation({
    mutationFn: () => sendPreapprovedMemberInvitation(email, displayName),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ["member-administration", membershipId] }),
        client.invalidateQueries({ queryKey: ["active-members"] }),
      ]);
      setEmail("");
      setDisplayName("");
    },
  });
  return <Card aria-labelledby="personal-invitation-heading">
    <CardHeader><CardTitle id="personal-invitation-heading">Invite a member directly</CardTitle></CardHeader>
    <CardContent className="space-y-4">
      <p className="text-sm text-muted-foreground">Use this when you have already decided to admit someone. They will join as a Regular member and will not need another approval.</p>
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); invitation.mutate(); }}>
        <div><Label htmlFor="personal-invitation-email">Email address</Label><Input id="personal-invitation-email" type="email" autoComplete="email" maxLength={254} required value={email} onChange={(event) => setEmail(event.target.value)} /></div>
        <div><Label htmlFor="personal-invitation-name">Display name (optional)</Label><Input id="personal-invitation-name" autoComplete="name" maxLength={80} value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></div>
        <div className="sm:col-span-2"><Button type="submit" disabled={invitation.isPending || !email.trim()}>{invitation.isPending ? "Sending invitation…" : "Send personal invitation"}</Button></div>
      </form>
      {invitation.error ? <p role="alert" className="text-sm text-destructive">{(invitation.error as Error).message}</p> : null}
      {invitation.isSuccess ? <p role="status" className="text-sm">Invitation sent. They can finish setting up their account from the email.</p> : null}
    </CardContent>
  </Card>;
}

export function JoinQuestionEditor() {
  const client = useQueryClient();
  const current = useQuery({ queryKey: ["join-questions"], queryFn: fetchJoinQuestions });
  const [questions, setQuestions] = useState<JoinQuestion[]>([]);
  useEffect(() => { if (current.data) setQuestions(current.data.questions); }, [current.data]);
  const save = useMutation({
    mutationFn: () => publishJoinQuestions(questions),
    onSuccess: () => client.invalidateQueries({ queryKey: ["join-questions"] }),
  });
  const update = (index: number, next: Partial<JoinQuestion>) => setQuestions((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, ...next } : item));
  return <Card aria-labelledby="join-questions-heading">
    <CardHeader><CardTitle id="join-questions-heading">Questions for new members</CardTitle></CardHeader>
    <CardContent className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">Ask up to three questions on the membership application.</p>
      <div className="flex flex-col gap-3">{questions.map((question, index) => <div key={`${question.id}-${index}`} className="flex flex-col gap-3 rounded-md border p-4"><div><Label htmlFor={`join-question-${index}`}>Question {index + 1}</Label><Input id={`join-question-${index}`} maxLength={200} value={question.prompt} onChange={(event) => update(index, { prompt: event.target.value })} /></div><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={question.required} onChange={(event) => update(index, { required: event.target.checked })} />Required</label><Button className="self-start" size="sm" variant="outline" onClick={() => setQuestions((items) => items.filter((_, itemIndex) => itemIndex !== index))}>Remove question {index + 1}</Button></div>)}</div>
      <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={questions.length >= 3} onClick={() => setQuestions((items) => [...items, { id: `q${items.length + 1}`, prompt: "", required: false }])}>Add question</Button><Button disabled={save.isPending || questions.some((question) => !question.prompt.trim())} onClick={() => save.mutate()}>Save questions</Button></div>
      {save.error ? <p role="alert" className="text-sm text-destructive">{(save.error as Error).message}</p> : null}{save.isSuccess ? <p role="status" className="text-sm">Questions updated.</p> : null}
    </CardContent>
  </Card>;
}

function MemberAdministration({ members, currentUserId }: { members: ActiveMember[]; currentUserId: string }) {
  const client = useQueryClient();
  const memberActionTrigger = useRef<HTMLButtonElement | null>(null);
  const [target, setTarget] = useState<ActiveMember | null>(null);
  const [successorId, setSuccessorId] = useState("");
  const [reactivationTarget, setReactivationTarget] = useState<ActiveMember | null>(null);
  const [reactivationReason, setReactivationReason] = useState("");
  const [reapplicationTarget, setReapplicationTarget] = useState<ActiveMember | null>(null);
  const [deletionTarget, setDeletionTarget] = useState<ActiveMember | null>(null);
  const [deletionConfirmation, setDeletionConfirmation] = useState("");
  const role = useMutation({
    mutationFn: ({ id, accessLevel }: { id: string; accessLevel: AccessLevel }) => setAccessLevel(id, accessLevel),
    onSuccess: () => Promise.all([
      client.invalidateQueries({ queryKey: ["member-administration"] }),
      client.invalidateQueries({ queryKey: ["active-members"] }),
      client.invalidateQueries({ queryKey: ["gear-share-membership"] }),
    ]),
  });
  const impact = useQuery({
    queryKey: ["deactivation-impact", target?.id, successorId],
    queryFn: () => getDeactivationImpact(target!.id, successorId),
    enabled: Boolean(target && successorId),
  });
  const deactivate = useMutation({
    mutationFn: () => deactivateMember(target!.id, successorId),
    onSuccess: async () => {
      setTarget(null);
      setSuccessorId("");
      await Promise.all([
        client.invalidateQueries({ queryKey: ["member-administration"] }),
        client.invalidateQueries({ queryKey: ["active-members"] }),
        client.invalidateQueries({ queryKey: ["gear-share-membership"] }),
        client.invalidateQueries({ queryKey: ["gear-share-supplies"] }),
        client.invalidateQueries({ queryKey: ["gear-share-loans"] }),
      ]);
    },
  });
  const reactivationImpact = useQuery({
    queryKey: ["reactivation-impact", reactivationTarget?.id],
    queryFn: () => fetchReactivationImpact(reactivationTarget!.id),
    enabled: Boolean(reactivationTarget),
  });
  const reactivate = useMutation({
    mutationFn: () => reactivateMember(reactivationTarget!.id, reactivationImpact.data!.previewVersion, reactivationReason),
    onSuccess: async () => {
      setReactivationTarget(null);
      setReactivationReason("");
      await Promise.all([
        client.invalidateQueries({ queryKey: ["member-administration"] }),
        client.invalidateQueries({ queryKey: ["active-members"] }),
        client.invalidateQueries({ queryKey: ["gear-share-membership"] }),
        client.invalidateQueries({ queryKey: ["notifications"] }),
      ]);
    },
  });
  const reapply = useMutation({
    mutationFn: () => allowMembershipReapplication(reapplicationTarget!.id),
    onSuccess: async () => {
      setReapplicationTarget(null);
      await Promise.all([
        client.invalidateQueries({ queryKey: ["member-administration"] }),
        client.invalidateQueries({ queryKey: ["pending-members"] }),
        client.invalidateQueries({ queryKey: ["gear-share-membership"] }),
      ]);
    },
  });
  const deleteAccount = useMutation({
    mutationFn: () => deleteDeactivatedMember(deletionTarget!.id),
    onSuccess: async () => {
      setDeletionTarget(null);
      setDeletionConfirmation("");
      await Promise.all([
        client.invalidateQueries({ queryKey: ["member-administration"] }),
        client.invalidateQueries({ queryKey: ["active-members"] }),
        client.invalidateQueries({ queryKey: ["notifications"] }),
      ]);
    },
  });
  const rejectedApplicants = members.filter((person) => person.membership_status === "rejected");
  const currentMembers = members.filter((person) => person.membership_status !== "rejected");
  const activeMembers = currentMembers.filter((person) => person.membership_status !== "deactivated");
  const successors = activeMembers.filter((person) => person.id !== target?.id);

  return <div className="space-y-10">
    {rejectedApplicants.length ? <section aria-labelledby="rejected-applicants-heading"><h2 id="rejected-applicants-heading" className="mb-2 font-serif text-2xl font-bold">Rejected applications</h2><p className="mb-4 text-sm text-muted-foreground">Allow someone to submit a fresh application if you want to reconsider the decision.</p><div className="space-y-3">{rejectedApplicants.map((person) => <Card key={person.id}><CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6"><div><p>{person.display_name}</p><p className="text-sm text-muted-foreground">{person.account_email ?? "Email unavailable"}</p></div><Button size="sm" variant="outline" onClick={() => setReapplicationTarget(person)}>Allow new application</Button></CardContent></Card>)}</div>{reapplicationTarget ? <Card className="mt-4"><CardHeader><CardTitle>Allow {reapplicationTarget.display_name} to apply again?</CardTitle></CardHeader><CardContent className="space-y-4"><p className="text-sm text-muted-foreground">Their prior answers will be cleared. They will need to complete the current questions and still require Administrator approval.</p>{reapply.error ? <p role="alert" className="text-sm text-destructive">{(reapply.error as Error).message}</p> : null}<div className="flex flex-wrap gap-2"><Button disabled={reapply.isPending} onClick={() => reapply.mutate()}>Allow new application</Button><Button variant="outline" onClick={() => setReapplicationTarget(null)}>Cancel</Button></div></CardContent></Card> : null}</section> : null}
    <section aria-labelledby="members-heading">
    <h2 id="members-heading" className="mb-2 font-serif text-2xl font-bold">Current members</h2>
    <div className="mb-4 grid gap-2 rounded-md bg-muted/50 p-4 text-sm sm:grid-cols-3"><p><strong>Regular member</strong><br /><span className="text-muted-foreground">Can list personal gear and borrow.</span></p><p><strong>Gear custodian</strong><br /><span className="text-muted-foreground">Can also manage group gear and loans.</span></p><p><strong>Administrator</strong><br /><span className="text-muted-foreground">Can also manage members and settings.</span></p></div>
    <div className="space-y-3">
      {currentMembers.map((person) => <Card key={person.id}><CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
        <div><p>{person.display_name}{person.membership_status === "deactivated" ? <span className="ml-2 text-sm text-muted-foreground">Deactivated</span> : null}</p><p className="text-sm text-muted-foreground">{person.account_email ?? "Email unavailable"}</p></div>
        <div className="flex flex-wrap items-center gap-2">
          {person.membership_status !== "deactivated" ? <><Select value={person.accessLevel ?? "regular"} disabled={role.isPending} onValueChange={(value: AccessLevel) => role.mutate({ id: person.id, accessLevel: value })}>
            <SelectTrigger className="w-40" aria-label={`Access level for ${person.display_name}`}><SelectValue /></SelectTrigger>
            <SelectContent><SelectGroup><SelectItem value="regular">Regular member</SelectItem><SelectItem value="custodian">Gear custodian</SelectItem><SelectItem value="administrator">Administrator</SelectItem></SelectGroup></SelectContent>
          </Select>
          <Button size="sm" variant="destructive" disabled={person.id === currentUserId} onClick={(event) => { memberActionTrigger.current = event.currentTarget; setTarget(person); }}>Deactivate</Button></> : <><Button size="sm" variant="outline" onClick={(event) => { memberActionTrigger.current = event.currentTarget; setReactivationTarget(person); setReactivationReason(""); }}>Review reactivation</Button><Button size="sm" variant="destructive" onClick={(event) => { memberActionTrigger.current = event.currentTarget; setDeletionTarget(person); setDeletionConfirmation(""); deleteAccount.reset(); }}>Delete account</Button></>}
        </div>
      </CardContent></Card>)}
    </div>
    {role.error ? <p className="mt-3 text-destructive">{(role.error as Error).message}</p> : null}
    <Dialog open={target !== null} onOpenChange={(open) => { if (!open) { setTarget(null); setSuccessorId(""); deactivate.reset(); } }}>
      <DialogContent className="sm:max-w-xl" onCloseAutoFocus={(event) => { event.preventDefault(); memberActionTrigger.current?.focus(); }}>
        <DialogHeader>
          <DialogTitle>Deactivate {target?.display_name}</DialogTitle>
          <DialogDescription>Review what will happen and choose a new pickup contact before continuing.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-destructive">If this member returns later, cancelled loans, reassigned gear, and former Administrator or custodian access will not come back automatically.</p>
          <div><Label htmlFor="replacement-pickup-contact">New pickup contact</Label><Select value={successorId} onValueChange={setSuccessorId}><SelectTrigger id="replacement-pickup-contact" aria-label="Replacement pickup contact"><SelectValue placeholder="Choose a pickup contact" /></SelectTrigger><SelectContent><SelectGroup>{successors.map((person) => <SelectItem key={person.id} value={person.id}>{person.display_name}</SelectItem>)}</SelectGroup></SelectContent></Select></div>
          {impact.isFetching ? <p className="text-sm text-muted-foreground">Checking what will change…</p> : null}
          {impact.data ? <ul className="list-disc pl-5 text-sm"><li>{impact.data.affectedListings} affected listings</li><li>{impact.data.requestsToCancel} pending or approved individual requests will be cancelled</li><li>{impact.data.checkedOutLoans} checked-out individual loans remain open for any Administrator to record return</li></ul> : null}
          {deactivate.error ? <p role="alert" className="text-sm text-destructive">{(deactivate.error as Error).message}</p> : null}
        </div>
        <DialogFooter><Button variant="outline" onClick={() => { setTarget(null); setSuccessorId(""); deactivate.reset(); }}>Cancel</Button><Button variant="destructive" disabled={!successorId || deactivate.isPending} onClick={() => deactivate.mutate()}>Confirm deactivation</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={reactivationTarget !== null} onOpenChange={(open) => { if (!open) { setReactivationTarget(null); setReactivationReason(""); reactivate.reset(); } }}>
      <DialogContent className="sm:max-w-xl" onCloseAutoFocus={(event) => { event.preventDefault(); memberActionTrigger.current?.focus(); }}>
        <DialogHeader>
          <DialogTitle>Review reactivation for {reactivationTarget?.display_name}</DialogTitle>
          <DialogDescription>Restoring access makes this person a Regular member. Previous roles and other changes stay as they are.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {reactivationImpact.isLoading ? <p>Checking what will change…</p> : null}
          {reactivationImpact.data ? <><p className="text-sm">{reactivationImpact.data.notificationConsequence}</p><ul className="list-disc pl-5 text-sm"><li>Previous role: {reactivationImpact.data.priorAccessLevel}</li><li>{reactivationImpact.data.cancelledLoans} cancelled loans will stay cancelled</li><li>{reactivationImpact.data.individualOwnedListings} personal listings will keep their current status and pickup contact</li><li>{reactivationImpact.data.storedWithListings} listings still name this person as pickup contact</li></ul><div><Label htmlFor="reactivation-reason">Reason for restoring membership</Label><Input id="reactivation-reason" maxLength={240} value={reactivationReason} onChange={(event) => setReactivationReason(event.target.value)} /></div></> : null}
          {reactivationImpact.error || reactivate.error ? <p role="alert" className="text-sm text-destructive">{((reactivationImpact.error || reactivate.error) as Error).message}</p> : null}
        </div>
        <DialogFooter><Button variant="outline" onClick={() => { setReactivationTarget(null); setReactivationReason(""); reactivate.reset(); }}>Cancel</Button><Button disabled={reactivate.isPending || !reactivationReason.trim() || !reactivationImpact.data} onClick={() => reactivate.mutate()}>Restore as member</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={deletionTarget !== null} onOpenChange={(open) => { if (!open) { setDeletionTarget(null); setDeletionConfirmation(""); deleteAccount.reset(); } }}>
      <DialogContent className="sm:max-w-xl" onCloseAutoFocus={(event) => { event.preventDefault(); memberActionTrigger.current?.focus(); }}>
        <DialogHeader>
          <DialogTitle>Delete {deletionTarget?.display_name}&apos;s account?</DialogTitle>
          <DialogDescription>This cannot be undone.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm">Their sign-in, contact details, ZIP code, application answers, and notification email data will be removed. They will disappear from member lists.</p>
          <p className="text-sm text-muted-foreground">Past loans and administrative records will remain, labeled “Deleted member,” so the community keeps an accurate history.</p>
          <div><Label htmlFor="delete-member-confirmation">Type DELETE to confirm</Label><Input id="delete-member-confirmation" autoComplete="off" value={deletionConfirmation} onChange={(event) => setDeletionConfirmation(event.target.value)} /></div>
          {deleteAccount.error ? <p role="alert" className="text-sm text-destructive">{(deleteAccount.error as Error).message}</p> : null}
        </div>
        <DialogFooter><Button variant="outline" onClick={() => { setDeletionTarget(null); setDeletionConfirmation(""); deleteAccount.reset(); }}>Cancel</Button><Button variant="destructive" disabled={deletionConfirmation !== "DELETE" || deleteAccount.isPending} onClick={() => deleteAccount.mutate()}>{deleteAccount.isPending ? "Deleting…" : "Delete account permanently"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </section></div>;
}
