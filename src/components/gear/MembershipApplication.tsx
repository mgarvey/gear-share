import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { fetchJoinQuestions, fetchMyMembershipApplication, submitJoinApplication } from "@/lib/gearShareApi";

export function MembershipApplication({ userId }: { userId: string }) {
  const client = useQueryClient();
  const questions = useQuery({ queryKey: ["join-questions"], queryFn: fetchJoinQuestions });
  const existing = useQuery({ queryKey: ["my-membership-application", userId], queryFn: fetchMyMembershipApplication });
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [staleAnswers, setStaleAnswers] = useState<Array<{ prompt: string; answer: string }>>([]);
  const application = useMutation({
    mutationFn: () => submitJoinApplication(questions.data!.versionId, answers),
    onError: async (error) => {
      if (/join questions changed/i.test((error as Error).message)) {
        setStaleAnswers(questions.data!.questions.map((question) => ({ prompt: question.prompt, answer: answers[question.id] ?? "" })));
        setAnswers({});
        await client.invalidateQueries({ queryKey: ["join-questions"] });
      }
    },
  });
  if (questions.isLoading || existing.isLoading) return <p>Loading membership questions…</p>;
  if (questions.error) return <p role="alert">{(questions.error as Error).message}</p>;
  if (existing.error) return <p role="alert">{(existing.error as Error).message}</p>;
  if (existing.data) return <p role="status">Your membership application is awaiting Administrator approval.</p>;
  if (application.isSuccess) return <p role="status">Your membership application is awaiting Administrator approval.</p>;
  return <Card className="w-full max-w-xl text-left"><CardHeader><CardTitle>Complete your membership application</CardTitle></CardHeader><CardContent>
    <p className="mb-5 text-sm text-muted-foreground">Your confirmed account remains pending until an Administrator reviews these answers and approves access.</p>
    {staleAnswers.length ? <aside className="mb-5 rounded-md border p-3 text-sm"><p className="font-medium">The questions changed. Your previous text is shown only for reference and will not be mapped or submitted.</p><dl className="mt-2 space-y-2">{staleAnswers.map((item) => <div key={item.prompt}><dt>{item.prompt}</dt><dd className="whitespace-pre-wrap text-muted-foreground">{item.answer || "No answer"}</dd></div>)}</dl></aside> : null}
    <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); application.mutate(); }}>
      {questions.data!.questions.map((question) => <div key={question.id}><Label htmlFor={question.id}>{question.prompt}{question.required ? " (required)" : " (optional)"}</Label><Textarea id={question.id} maxLength={1000} required={question.required} value={answers[question.id] ?? ""} onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))} /></div>)}
      {questions.data!.questions.length === 0 ? <p className="text-sm">No additional questions are currently required.</p> : null}
      {application.error ? <p role="alert" className="text-sm text-destructive">{(application.error as Error).message}</p> : null}
      <Button disabled={application.isPending}>{application.isPending ? "Submitting…" : "Submit for Administrator review"}</Button>
    </form>
  </CardContent></Card>;
}
