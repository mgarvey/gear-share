import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { PrivatePhotoPicker } from "@/components/gear/PrivatePhotoPicker";

const convert = vi.hoisted(() => vi.fn());
vi.mock("@/lib/safeImage", () => ({ convertSelectedImage: convert }));

beforeEach(() => {
  convert.mockImplementation(async (file: File) => {
    if (file.name === "bad.png") throw new Error("Malformed image header");
    return { blob: new Blob(["converted"], { type: "image/jpeg" }), header: { format: "jpeg", width: 10, height: 10 } };
  });
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:prepared") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
});

it("keeps successful sequential conversions and lets a failed file be reselected", async () => {
  const user = userEvent.setup();
  const changed = vi.fn();
  function Harness() {
    const [files, setFiles] = useState<File[]>([]);
    return <PrivatePhotoPicker id="photos" value={files} onChange={(next) => { changed(next); setFiles(next); }} />;
  }
  render(<Harness />);

  await user.upload(screen.getByLabelText("Photos (optional)"), [
    new File(["good"], "good.png", { type: "image/png" }),
    new File(["bad"], "bad.png", { type: "image/png" }),
  ]);

  expect(await screen.findByAltText("Prepared good.png")).toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("bad.png: Malformed image header");
  expect(screen.getByRole("alert")).toHaveTextContent("Reselect a failed photo to retry it");
  expect(changed).toHaveBeenLastCalledWith([expect.objectContaining({ name: "good.jpg", type: "image/jpeg" })]);
  expect(convert.mock.calls.map(([file]) => file.name)).toEqual(["good.png", "bad.png"]);
  expect(screen.getByLabelText("Photos (optional)")).toBeEnabled();
});
import { useState } from "react";
