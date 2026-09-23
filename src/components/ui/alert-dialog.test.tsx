import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "./alert-dialog";

describe("AlertDialogContent mobile viewport", () => {
  it("keeps confirmation content within visible mobile gutters", () => {
    render(
      <AlertDialog open>
        <AlertDialogContent>
          <AlertDialogTitle>Confirm change</AlertDialogTitle>
          <AlertDialogDescription>Review this action.</AlertDialogDescription>
        </AlertDialogContent>
      </AlertDialog>,
    );

    expect(screen.getByRole("alertdialog")).toHaveClass(
      "inset-x-3",
      "w-auto",
      "max-h-[calc(100dvh-1.5rem)]",
      "overflow-y-auto",
      "sm:w-full",
    );
  });
});
