import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Auth } from "@/components/gear/Auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchJoinQuestions } from "@/lib/gearShareApi";

export default function JoinPage() {
  const join = useQuery({ queryKey: ["join-questions"], queryFn: fetchJoinQuestions });
  return <main className="min-h-screen bg-sand/50 px-5 py-8">
    <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-[1.1fr_0.9fr]">
      <section aria-labelledby="join-heading" className="space-y-5">
        <div><p className="text-sm font-medium uppercase tracking-wide text-terracotta">Private community gear share</p><h1 id="join-heading" className="mt-2 font-serif text-4xl font-bold">Request membership in {join.data?.communityName ?? "the community"}</h1><p className="mt-3 text-muted-foreground">Every applicant must be approved by an Administrator before the catalog, member information, photos, requests, or loans become available.</p></div>
        <Card><CardHeader><CardTitle>What the application asks</CardTitle></CardHeader><CardContent className="space-y-3">
          {join.isLoading ? <p>Loading the current application…</p> : null}
          {join.error ? <p role="alert" className="text-sm text-destructive">The current application is temporarily unavailable. You can still sign in, but submission remains blocked until the reviewed questions load.</p> : null}
          {join.data?.questions.length ? <ol className="list-decimal space-y-2 pl-5">{join.data.questions.map((question) => <li key={question.id}>{question.prompt}{question.required ? <span className="text-muted-foreground"> (required)</span> : <span className="text-muted-foreground"> (optional)</span>}</li>)}</ol> : !join.isLoading && !join.error ? <p className="text-sm text-muted-foreground">No additional questions are currently published.</p> : null}
          <p className="text-sm">Read the <Link className="text-terracotta underline" to="/privacy">privacy notice</Link> and <Link className="text-terracotta underline" to="/terms">terms of use</Link> before applying.</p>
        </CardContent></Card>
      </section>
      <Auth embedded />
    </div>
  </main>;
}
