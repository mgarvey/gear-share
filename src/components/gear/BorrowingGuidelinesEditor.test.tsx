import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BorrowingGuidelinesEditor, SUGGESTED_BORROWING_GUIDELINES } from "@/components/gear/BorrowingGuidelinesEditor";

describe("BorrowingGuidelinesEditor", () => {
  it("adds normalized rules and exposes ordered edit controls", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<BorrowingGuidelinesEditor value={["Return dry"]} onChange={onChange} />);
    await user.type(screen.getByLabelText("Add a guideline"), "  No food   inside  ");
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(onChange).toHaveBeenCalledWith(["Return dry", "No food inside"]);
    expect(screen.getByRole("button", { name: "Move guideline 1 up" })).toBeDisabled();
    expect(screen.getByText("1 of 8 guidelines added")).toBeInTheDocument();
  });

  it("blocks a normalized duplicate before the authoritative server check", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<BorrowingGuidelinesEditor value={["Return dry"]} onChange={onChange} />);
    await user.type(screen.getByLabelText("Add a guideline"), "return dry");
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("loads editable suggested guidelines without an AI request", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<BorrowingGuidelinesEditor value={[]} onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "Use suggested guidelines" }));

    expect(onChange).toHaveBeenCalledWith(SUGGESTED_BORROWING_GUIDELINES);
  });

  it("does not offer to replace guidelines already entered", () => {
    render(<BorrowingGuidelinesEditor value={["Return dry"]} onChange={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Use suggested guidelines" })).not.toBeInTheDocument();
  });
});
