import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ fetchJoinQuestions: vi.fn(), fetchMyMembershipApplication: vi.fn(), submitJoinApplication: vi.fn() }));
vi.mock("@/lib/gearShareApi", () => api);

import { MembershipApplication } from "./MembershipApplication";

function renderApplication() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><MembershipApplication userId="applicant" /></QueryClientProvider>);
}

describe("membership application", () => {
  beforeEach(() => { vi.resetAllMocks(); api.fetchMyMembershipApplication.mockResolvedValue(null); });

  it("submits only answers for the current immutable question version", async () => {
    const user = userEvent.setup();
    api.fetchJoinQuestions.mockResolvedValue({ communityName: "Gear Share", versionId: "version-2", questions: [
      { id: "q1", prompt: "How are you connected?", required: true },
      { id: "q2", prompt: "Anything else?", required: false },
    ] });
    api.submitJoinApplication.mockResolvedValue(undefined);
    renderApplication();

    await user.type(await screen.findByLabelText("How are you connected? (required)"), "Local family");
    await user.click(screen.getByRole("button", { name: "Submit for Administrator review" }));

    await waitFor(() => expect(api.submitJoinApplication).toHaveBeenCalledWith("version-2", { q1: "Local family" }));
    expect(await screen.findByText("Your membership application is awaiting Administrator approval.")).toBeInTheDocument();
  });

  it("still requires explicit submission when no questions are configured", async () => {
    const user = userEvent.setup();
    api.fetchJoinQuestions.mockResolvedValue({ communityName: "Gear Share", versionId: "version-1", questions: [] });
    api.submitJoinApplication.mockResolvedValue(undefined);
    renderApplication();

    expect(await screen.findByText("No additional questions are currently required.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Submit for Administrator review" }));
    await waitFor(() => expect(api.submitJoinApplication).toHaveBeenCalledWith("version-1", {}));
  });

  it("does not remap answers when the immutable question version changes", async () => {
    const user = userEvent.setup();
    api.fetchJoinQuestions
      .mockResolvedValueOnce({ communityName: "Gear Share", versionId: "version-1", questions: [
        { id: "q1", prompt: "What unit are you connected with?", required: true },
      ] })
      .mockResolvedValueOnce({ communityName: "Gear Share", versionId: "version-2", questions: [
        { id: "q1", prompt: "How are you connected to the community?", required: true },
      ] });
    api.submitJoinApplication.mockRejectedValue(new Error("Join questions changed; review the current questions before resubmitting."));
    renderApplication();

    await user.type(await screen.findByLabelText("What unit are you connected with? (required)"), "Group 123");
    await user.click(screen.getByRole("button", { name: "Submit for Administrator review" }));

    expect(await screen.findByText("Your previous text is shown only for reference and will not be mapped or submitted.", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("Group 123")).toBeInTheDocument();
    const currentAnswer = await screen.findByLabelText("How are you connected to the community? (required)");
    expect(currentAnswer).toHaveValue("");
  });
});
