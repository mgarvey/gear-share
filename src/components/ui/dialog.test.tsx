import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./dialog";

describe("DialogContent mobile viewport", () => {
  it("stays inset from the mobile viewport and owns its scroll surface", () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Add gear</DialogTitle>
          <DialogDescription>Complete the listing.</DialogDescription>
          <button type="button">Last action</button>
        </DialogContent>
      </Dialog>,
    );

    expect(screen.getByRole("dialog")).toHaveClass(
      "inset-x-3",
      "top-[max(0.5rem,env(safe-area-inset-top))]",
      "bottom-[max(0.5rem,env(safe-area-inset-bottom))]",
      "w-auto",
      "overflow-y-auto",
      "sm:w-full",
    );
  });
});
