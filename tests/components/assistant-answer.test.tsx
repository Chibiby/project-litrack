import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * One question, one answer, written once.
 *
 * The panel used to answer from the offline help index the moment Enter was
 * pressed and then replace that bubble with Gemini's prose a second later, so a
 * teacher watched an answer they had started reading get rewritten underneath
 * them. These tests pin the fix from the reader's side: while the model is
 * thinking there is no prose on screen at all, and when it arrives it is the
 * only prose there has ever been.
 *
 * The curated index is still the model's reference material — on the server, in
 * the prompt. What it must never do again is speak here.
 */

const askAssistant = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  usePathname: () => "/teacher/attendance",
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({ children, href, prefetch: _p, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/actions/assistant", () => ({ askAssistant }));
vi.mock("@/lib/actions/support", () => ({
  fetchMyTickets: vi.fn(async () => ({ ok: true, data: [] })),
}));
vi.mock("@/lib/actions/chat", () => ({
  getMyChatUnread: vi.fn(async () => ({ ok: true, data: { school: false, admin: false } })),
}));

import { AssistantPanel } from "@/components/assistant/assistant-panel";

// jsdom does not implement Element.scrollTo; the log autoscrolls on update.
Element.prototype.scrollTo = Element.prototype.scrollTo ?? (() => {});

afterEach(() => {
  askAssistant.mockReset();
  cleanup();
});

function renderPanel() {
  render(
    <AssistantPanel
      role="TEACHER"
      userName="Marivic Acibar"
      aiEnabled
      active
      onMinimize={vi.fn()}
      onClose={vi.fn()}
    />
  );
}

function ask(question: string) {
  fireEvent.change(screen.getByLabelText("Ask about LITRACK"), {
    target: { value: question },
  });
  fireEvent.submit(screen.getByLabelText("Ask about LITRACK").closest("form")!);
}

describe("AssistantPanel answers", () => {
  it("shows nothing but a thinking indicator until the model answers", async () => {
    let release: (value: unknown) => void = () => {};
    askAssistant.mockReturnValue(new Promise((resolve) => (release = resolve)));

    renderPanel();
    ask("why is last week locked");

    // The question is on screen. An answer is not — not a curated one, not a
    // placeholder sentence, nothing that could later be rewritten.
    await waitFor(() => expect(screen.getByText("why is last week locked")).not.toBeNull());
    expect(screen.getByRole("status").textContent).toContain("Thinking");
    expect(screen.queryByText(/deadline/i)).toBeNull();

    release({ ok: true, data: { text: "Deadlines are off right now.", links: [] } });

    await waitFor(() =>
      expect(screen.getByText("Deadlines are off right now.")).not.toBeNull()
    );
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("leaves exactly one answer bubble behind", async () => {
    askAssistant.mockResolvedValue({
      ok: true,
      data: { text: "Open Weekly Attendance and pick the week.", links: [] },
    });

    renderPanel();
    ask("how do I mark attendance");

    await waitFor(() =>
      expect(screen.getAllByText("Open Weekly Attendance and pick the week.")).toHaveLength(1)
    );
    // The action is asked once per question. A second call is how the same
    // question came to have two authors in the first place.
    expect(askAssistant).toHaveBeenCalledTimes(1);
  });

  it("sends a greeting to the model rather than answering it from a canned string", async () => {
    askAssistant.mockResolvedValue({
      ok: true,
      data: { text: "Hello Marivic. What would you like to know?", links: [] },
    });

    renderPanel();
    ask("hello");

    await waitFor(() => expect(askAssistant).toHaveBeenCalledTimes(1));
    expect(askAssistant.mock.calls[0][0]).toMatchObject({ question: "hello" });
  });

  it("renders the app's own links under the answer", async () => {
    askAssistant.mockResolvedValue({
      ok: true,
      data: {
        text: "Your learners live on the Learners page.",
        links: [{ label: "Open Learners", href: "/teacher/learners" }],
      },
    });

    renderPanel();
    ask("where are my learners");

    const link = await screen.findByText("Open Learners");
    expect(link.closest("a")?.getAttribute("href")).toBe("/teacher/learners");
  });

  it("says it cannot answer, and offers a person, rather than guessing", async () => {
    askAssistant.mockResolvedValue({ ok: false, error: "That is a lot of questions." });

    renderPanel();
    ask("what happens when the term closes");

    await waitFor(() => expect(screen.getByText("That is a lot of questions.")).not.toBeNull());
    expect(screen.getByRole("button", { name: /Send it to the division admin/i })).not.toBeNull();
  });

  it("survives the action failing outright", async () => {
    askAssistant.mockRejectedValue(new Error("connection lost"));

    renderPanel();
    ask("anything at all");

    await waitFor(() => expect(screen.getByText(/could not reach the assistant/i)).not.toBeNull());
    // The reader is never shown the exception behind it.
    expect(screen.queryByText(/connection lost/)).toBeNull();
  });
});
