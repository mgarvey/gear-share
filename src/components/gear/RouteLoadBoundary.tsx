import { Component, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

export class RouteLoadBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="grid min-h-screen place-items-center bg-background px-5">
        <section className="w-full max-w-lg rounded-xl border bg-white p-6 text-center shadow-sm sm:p-8">
          <h1 className="font-serif text-2xl font-bold">This page needs a refresh</h1>
          <p className="mt-2 text-muted-foreground">
            The site was updated while this page was open. Refresh to load the current version.
          </p>
          <Button className="mt-5" onClick={() => window.location.reload()}>
            Refresh page
          </Button>
        </section>
      </main>
    );
  }
}
