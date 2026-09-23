import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RouteLoadBoundary } from "@/components/gear/RouteLoadBoundary";

function BrokenRoute(): never {
  throw new Error("Failed to fetch dynamically imported module");
}

describe("RouteLoadBoundary", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shows a useful refresh action instead of a blank page", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(
      <RouteLoadBoundary>
        <BrokenRoute />
      </RouteLoadBoundary>,
    );

    expect(screen.getByRole("heading", { name: "This page needs a refresh" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh page" })).toBeInTheDocument();
  });
});
