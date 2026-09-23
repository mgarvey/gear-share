import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Bell, Grid2X2, List } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  partitionLoansByPrimaryRole,
  splitLoanActivity,
} from "@/lib/loanWorkspace";
import { formatUsPhone } from "@/lib/phone";
import {
  fetchHandoffCandidates,
  fetchLoanContactDetails,
  fetchLoanReminders,
  fetchLoans,
  reassignLoanHandoff,
  transitionLoan,
} from "@/lib/gearShareApi";
import type { Loan, Membership } from "@/types/gear";

export default function LoansPage({
  membership,
}: {
  membership: Membership;
}) {
  const [view, setView] = useState<"grid" | "list">("grid");
  const loans = useQuery({
    queryKey: ["gear-share-loans", membership.id],
    queryFn: fetchLoans,
  });
  const reminders = useQuery({
    queryKey: ["loan-reminders", membership.id],
    queryFn: fetchLoanReminders,
    staleTime: 0,
  });
  const partition = partitionLoansByPrimaryRole(loans.data ?? [], membership);
  const borrower = splitLoanActivity(partition.borrower);
  const owner = splitLoanActivity(partition.owner);
  const groupManager = splitLoanActivity(partition.groupManager);
  const oversight = splitLoanActivity(partition.administratorOversight);
  const groups: LoanGroup[] = [
    { title: "My borrowing", mode: "borrower", activity: borrower },
    { title: "Requests for my gear", mode: "owner", activity: owner },
    ...(membership.accessLevel !== "regular"
      ? [
          {
            title: "Group-owned loan work",
            mode: "group-manager" as const,
            activity: groupManager,
          },
        ]
      : []),
    ...(membership.accessLevel === "administrator"
      ? [
          {
            title: "Individual-loan oversight",
            mode: "oversight" as const,
            activity: oversight,
          },
        ]
      : []),
  ];
  const activeCount = groups.reduce(
    (count, group) => count + group.activity.actionable.length,
    0,
  );
  const historyCount = groups.reduce(
    (count, group) => count + group.activity.terminal.length,
    0,
  );
  return (
    <main className="container mx-auto space-y-8 p-4 md:p-8">
      <div>
        <h1 className="font-serif text-3xl font-bold">Loans</h1>
        <p className="text-muted-foreground">
          Track your borrowing and the requests you currently manage.
        </p>
      </div>
      {reminders.error ? (
        <p className="text-sm text-destructive" role="alert">
          Due and overdue reminders could not be loaded.
        </p>
      ) : (
        <ReminderNotices reminders={reminders.data ?? []} />
      )}
      <Tabs defaultValue="active" className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList
            aria-label="Loan views"
            className="grid h-auto w-full grid-cols-2 sm:w-fit sm:min-w-72"
          >
            <TabsTrigger value="active">Active ({activeCount})</TabsTrigger>
            <TabsTrigger value="history">History ({historyCount})</TabsTrigger>
          </TabsList>
          <div role="group" aria-label="Loan layout" className="flex rounded-md border bg-background p-0.5">
            <Button type="button" size="icon" variant={view === "grid" ? "default" : "ghost"} className="h-9 w-9" aria-label="Grid view" aria-pressed={view === "grid"} onClick={() => setView("grid")}>
              <Grid2X2 className="h-4 w-4" />
            </Button>
            <Button type="button" size="icon" variant={view === "list" ? "default" : "ghost"} className="h-9 w-9" aria-label="List view" aria-pressed={view === "list"} onClick={() => setView("list")}>
              <List className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <TabsContent value="active" className="space-y-8">
          {activeCount === 0 ? (
            <LoanEmptyState
              title="No active loan work"
              detail="New borrowing requests and loans that need action will appear here."
            />
          ) : (
            groups
              .filter((group) => group.activity.actionable.length > 0)
              .map((group) => (
                <LoanSection
                  key={`active-${group.mode}`}
                  title={group.title}
                  loans={group.activity.actionable}
                  membership={membership}
                  mode={group.mode}
                  view={view}
                />
              ))
          )}
        </TabsContent>
        <TabsContent value="history" className="space-y-8">
          {historyCount === 0 ? (
            <LoanEmptyState
              title="No loan history yet"
              detail="Returned, declined, and cancelled loans will remain available here."
            />
          ) : (
            groups
              .filter((group) => group.activity.terminal.length > 0)
              .map((group) => (
                <LoanSection
                  key={`history-${group.mode}`}
                  title={group.title}
                  loans={group.activity.terminal}
                  membership={membership}
                  mode="history"
                  headingKey={group.mode}
                  view={view}
                />
              ))
          )}
        </TabsContent>
      </Tabs>
      {loans.error ? (
        <p className="text-destructive">{(loans.error as Error).message}</p>
      ) : null}
    </main>
  );
}

type ActiveLoanMode = "borrower" | "owner" | "group-manager" | "oversight";
interface LoanGroup {
  title: string;
  mode: ActiveLoanMode;
  activity: ReturnType<typeof splitLoanActivity>;
}

function LoanSection({
  title,
  loans,
  membership,
  mode,
  headingKey,
  view,
}: {
  title: string;
  loans: Loan[];
  membership: Membership;
  mode: ActiveLoanMode | "history";
  headingKey?: ActiveLoanMode;
  view: "grid" | "list";
}) {
  const headingId = `${headingKey ?? mode}-${title.toLocaleLowerCase().replace(/ /g, "-")}`;
  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} className="mb-4 font-serif text-2xl font-bold">
        {title}
      </h2>
      <div
        role="list"
        aria-label={`${title} loans`}
        data-layout={view}
        className={view === "grid" ? "grid gap-3 sm:grid-cols-2 xl:grid-cols-3" : "grid gap-3"}
      >
        {loans.map((loan) => (
          <LoanCard
            key={`${mode}-${loan.id}`}
            loan={loan}
            membership={membership}
            mode={mode}
          />
        ))}
      </div>
    </section>
  );
}

function LoanEmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-lg border p-8 text-center">
      <h2 className="font-serif text-xl font-bold">{title}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{detail}</p>
    </div>
  );
}

function LoanCard({
  loan,
  membership,
  mode,
}: {
  loan: Loan;
  membership: Membership;
  mode: "borrower" | "owner" | "group-manager" | "oversight" | "history";
}) {
  const client = useQueryClient();
  const [handoffContactId, setHandoffContactId] = useState("");
  const [returnOpen, setReturnOpen] = useState(false);
  const [markNeedsAttention, setMarkNeedsAttention] = useState(false);
  const [attentionReason, setAttentionReason] = useState("");
  const canManageGroupLoan =
    loan.ownershipKind === "group" && membership.accessLevel !== "regular";
  const handoffContext =
    loan.ownershipKind === "group" &&
    (loan.status === "pending" ||
      loan.status === "approved" ||
      loan.status === "checked_out") &&
    (loan.status === "pending"
      ? canManageGroupLoan
      : membership.accessLevel === "administrator" ||
        loan.handoffContactId === membership.id);
  const handoffCandidates = useQuery({
    queryKey: ["loan-handoff-candidates", membership.id, loan.id],
    queryFn: () => fetchHandoffCandidates(loan.id),
    enabled: handoffContext,
  });
  useEffect(() => {
    if (!handoffContactId && handoffCandidates.data?.length)
      setHandoffContactId(
        handoffCandidates.data.find(
          (candidate) => candidate.id === loan.handoffContactId,
        )?.id ??
          handoffCandidates.data.find(
            (candidate) => candidate.id === membership.id,
          )?.id ??
          handoffCandidates.data[0].id,
      );
  }, [handoffCandidates.data, handoffContactId, loan.handoffContactId, membership.id]);
  const mutation = useMutation({
    mutationFn: ({
      action,
    }: {
      action: "approve" | "decline" | "checkout" | "return" | "cancel";
    }) =>
      transitionLoan(action, loan.id, {
        handoffContactId:
          action === "approve" && loan.ownershipKind === "group"
            ? handoffContactId
            : undefined,
        markNeedsAttention:
          action === "return" ? markNeedsAttention : undefined,
        attentionReason: action === "return" ? attentionReason : undefined,
      }),
    onSuccess: async () => {
      setReturnOpen(false);
      setMarkNeedsAttention(false);
      setAttentionReason("");
      client.removeQueries({
        queryKey: ["loan-contact", membership.id, loan.id],
        exact: true,
      });
      await client.invalidateQueries({
        queryKey: ["gear-share-loans", membership.id],
      });
    },
  });
  const reassign = useMutation({
    mutationFn: () => reassignLoanHandoff(loan.id, handoffContactId),
    onSuccess: async () => {
      client.removeQueries({
        queryKey: ["loan-contact", membership.id, loan.id],
        exact: true,
      });
      await client.invalidateQueries({
        queryKey: ["gear-share-loans", membership.id],
      });
    },
  });
  const actions = validActions(loan, membership, mode);
  const contactEligible =
    loan.status === "approved" || loan.status === "checked_out";
  const contact = useQuery({
    queryKey: ["loan-contact", membership.id, loan.id],
    queryFn: () => fetchLoanContactDetails(loan.id),
    enabled: contactEligible,
    staleTime: 0,
    gcTime: 0,
    refetchInterval: contactEligible ? 10_000 : false,
    refetchOnWindowFocus: true,
  });
  return (
    <Card role="listitem">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-3">
          <span>{loan.supplyTitle}</span>
          <Badge variant="outline" className="capitalize">
            {loan.status.replace("_", " ")}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <span>
            <strong>Borrower:</strong> {loan.borrowerName}
          </span>
          <span>
            <strong>Ownership:</strong>{" "}
            {loan.ownershipKind === "group"
              ? "Group-owned"
              : "Individual-owned"}
          </span>
          <span>
            <strong>Pickup contact:</strong> {loan.currentCustodianName}
          </span>
          {loan.handoffContactName ? (
            <span>
              <strong>Handoff:</strong> {loan.handoffContactName}
            </span>
          ) : null}
        </div>
        <p className="text-sm mb-3">
          Quantity {loan.quantity} · {loan.startDate} through {loan.endDate}{" "}
          (inclusive)
        </p>
        {loan.needsAttention ? (
          <p
            className="mb-3 rounded-md bg-amber-50 p-3 text-sm text-amber-950"
            role="status"
          >
            <AlertTriangle className="mr-2 inline h-4 w-4" aria-hidden="true" />
            <strong>Needs Attention:</strong> approval and checkout are paused.
            {loan.needsAttentionReason ? ` ${loan.needsAttentionReason}` : ""}
          </p>
        ) : null}
        {loan.borrowerNote ? (
          <p className="text-sm text-muted-foreground mb-3">
            “{loan.borrowerNote}”
          </p>
        ) : null}
        {mode !== "history" && loan.acceptedGuidelines?.length ? (
          <section className="mb-4 rounded-md border p-3" aria-label="Accepted borrowing guidelines">
            <p className="font-semibold">Guidelines agreed to for this loan</p>
            <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm">
              {loan.acceptedGuidelines.map((rule, index) => <li key={`${index}-${rule}`}>{rule}</li>)}
            </ol>
          </section>
        ) : null}
        {contactEligible && contact.data && !contact.error ? (
          <div className="mb-4 rounded-md border bg-muted/30 p-3 text-sm">
            <h3 className="font-medium">
              {mode === "borrower" ? "Pickup and return contact" : "Borrower contact"}: {contact.data.displayName}
            </h3>
            {contact.data.email ? (
              <p>
                <a className="underline" href={`mailto:${contact.data.email}`}>
                  {contact.data.email}
                </a>
              </p>
            ) : null}
            {contact.data.phoneE164 ? (
              <p>
                <a className="underline" href={`tel:${contact.data.phoneE164}`}>
                  {formatUsPhone(contact.data.phoneE164)}
                </a>
              </p>
            ) : null}
            {contact.data.coordinationNote ? (
              <p className="mt-2 whitespace-pre-wrap text-muted-foreground">
                {contact.data.coordinationNote}
              </p>
            ) : null}
          </div>
        ) : null}
        {handoffContext && handoffCandidates.data?.length ? (
          <div className="mb-4 max-w-sm space-y-2">
            <Label htmlFor={`handoff-${loan.id}`}>
              {loan.status === "pending"
                ? "Pickup and return handoff"
                : "Reassign pickup and return handoff"}
            </Label>
            <Select
              value={handoffContactId}
              onValueChange={setHandoffContactId}
            >
              <SelectTrigger id={`handoff-${loan.id}`}>
                <SelectValue placeholder="Choose an authorized Custodian or Administrator" />
              </SelectTrigger>
              <SelectContent>
                {handoffCandidates.data.map((candidate) => (
                  <SelectItem key={candidate.id} value={candidate.id}>
                    {candidate.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {loan.status !== "pending" &&
            handoffContactId &&
            handoffContactId !== loan.handoffContactId ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={reassign.isPending}
                onClick={() => reassign.mutate()}
              >
                {reassign.isPending ? "Reassigning…" : "Reassign handoff"}
              </Button>
            ) : null}
            {reassign.error ? (
              <p className="text-sm text-destructive">
                {(reassign.error as Error).message}
              </p>
            ) : null}
          </div>
        ) : null}
        {handoffContext && handoffCandidates.error ? (
          <p className="mb-4 text-sm text-destructive" role="alert">
            Authorized handoff choices could not be loaded.
          </p>
        ) : null}
        {mode === "oversight" && actions.length === 0 ? (
          <p className="mb-3 text-sm text-muted-foreground">
            Read-only Administrator oversight.
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {actions
            .filter((action) => action !== "return")
            .map((action) => (
              <Button
                key={action}
                size="sm"
                variant={
                  action === "decline" || action === "cancel"
                    ? "outline"
                    : "default"
                }
                disabled={
                  mutation.isPending ||
                  (action === "approve" &&
                    loan.ownershipKind === "group" &&
                    !handoffContactId)
                }
                onClick={() => mutation.mutate({ action })}
              >
                {actionLabel(action)}
              </Button>
            ))}
          {actions.includes("return") ? (
            <Button
              size="sm"
              type="button"
              aria-label="Record return"
              disabled={mutation.isPending}
              onClick={() => setReturnOpen((open) => !open)}
            >
              Record return…
            </Button>
          ) : null}
        </div>
        {returnOpen ? (
          <div className="mt-4 rounded-md border p-4">
            {loan.needsAttention ? (
              <p className="text-sm text-muted-foreground">
                This listing is already Needs Attention. Recording the return
                preserves its existing hold and reason.
              </p>
            ) : (
              <>
                <div className="flex items-start gap-2">
                  <Checkbox
                    id={`return-attention-${loan.id}`}
                    checked={markNeedsAttention}
                    onCheckedChange={(checked) =>
                      setMarkNeedsAttention(checked === true)
                    }
                  />
                  <Label htmlFor={`return-attention-${loan.id}`}>
                    Mark this gear Needs Attention in the same return transaction
                  </Label>
                </div>
                {markNeedsAttention ? (
                  <div className="mt-3">
                    <Label htmlFor={`return-reason-${loan.id}`}>
                      Inspection or repair concern
                    </Label>
                    <Textarea
                      id={`return-reason-${loan.id}`}
                      maxLength={500}
                      value={attentionReason}
                      onChange={(event) => setAttentionReason(event.target.value)}
                    />
                  </div>
                ) : null}
              </>
            )}
            <div className="mt-3 flex gap-2">
              <Button
                size="sm"
                type="button"
                disabled={
                  mutation.isPending ||
                  (markNeedsAttention && !attentionReason.trim())
                }
                onClick={() => mutation.mutate({ action: "return" })}
              >
                Confirm return
              </Button>
              <Button
                size="sm"
                type="button"
                variant="outline"
                onClick={() => setReturnOpen(false)}
              >
                Keep checked out
              </Button>
            </div>
          </div>
        ) : null}
        {mutation.error ? (
          <p className="text-sm text-destructive mt-3">
            {(mutation.error as Error).message}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function validActions(
  loan: Loan,
  membership: Membership,
  mode: "borrower" | "owner" | "group-manager" | "oversight" | "history",
) {
  if (mode === "history") return [];
  const actions = new Set<
    "approve" | "decline" | "checkout" | "return" | "cancel"
  >();
  const canManageGroupLoan =
    loan.ownershipKind === "group" && membership.accessLevel !== "regular";
  if (
    mode === "borrower" &&
    loan.borrowerId === membership.id &&
    (loan.status === "pending" || loan.status === "approved")
  )
    actions.add("cancel");
  if (mode === "owner" || mode === "group-manager" || canManageGroupLoan) {
    if (loan.status === "pending") {
      if (!loan.needsAttention) actions.add("approve");
      actions.add("decline");
      actions.add("cancel");
    }
    if (loan.status === "approved") {
      if (!loan.needsAttention) actions.add("checkout");
      actions.add("cancel");
    }
    if (loan.status === "checked_out") actions.add("return");
  }
  if (
    mode === "oversight" &&
    loan.status === "checked_out" &&
    !loan.ownerIsActive
  )
    actions.add("return");
  return [...actions];
}

function ReminderNotices({
  reminders,
}: {
  reminders: Awaited<ReturnType<typeof fetchLoanReminders>>;
}) {
  if (reminders.length === 0) return null;
  return (
    <section
      aria-labelledby="loan-reminders-heading"
      className="rounded-lg border bg-muted/20 p-4"
    >
      <h2 id="loan-reminders-heading" className="font-serif text-xl font-bold">
        <Bell className="mr-2 inline h-5 w-5" aria-hidden="true" />
        Due and overdue reminders
      </h2>
      <ul className="mt-3 space-y-2">
        {reminders.map((reminder) => (
          <li key={reminder.id} className="text-sm">
            <strong>{reminder.supplyTitle}</strong> ·{" "}
            {reminderLabel(reminder.kind, reminder.ordinal)} · return date{" "}
            {reminder.endDate}
          </li>
        ))}
      </ul>
    </section>
  );
}

function reminderLabel(
  kind: "due_soon" | "first_overdue" | "weekly_overdue",
  ordinal: number,
) {
  if (kind === "due_soon") return "Due in about 48 hours";
  if (kind === "first_overdue") return "Overdue";
  return `Weekly overdue reminder ${ordinal} of 3`;
}

function actionLabel(action: string) {
  return (
    {
      approve: "Approve",
      decline: "Decline",
      checkout: "Record checkout",
      return: "Record return",
      cancel: "Cancel",
    } as Record<string, string>
  )[action];
}
