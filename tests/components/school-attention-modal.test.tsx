import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/post-login-flag", () => ({ isPostLoginLoadingCover: () => false }));
vi.mock("@/components/nav/prefetch-link", () => ({
  PrefetchLink: ({ children, href, onClick, className }: {
    children: React.ReactNode;
    href: string;
    onClick?: () => void;
    className?: string;
  }) => (
    <a href={href} onClick={onClick} className={className}>
      {children}
    </a>
  ),
}));

import {
  SchoolAttentionModal,
  attentionSeenKey,
} from "@/components/dashboard/school-head/attention-modal";

/**
 * The School Head's "Needs your attention" pop-up shows once after every
 * sign-in: the key is the session's start time, not the day.
 */

const items = [
  { id: "tasks", label: "Teachers with pending tasks", detail: "7 of 10", href: "/x", badge: "7", tone: "amber" as const },
];

function renderModal(loginKey: string) {
  return render(
    <SchoolAttentionModal schoolId="s1" loginKey={loginKey} figures={[]} items={items} />
  );
}

async function settle() {
  await act(async () => {
    vi.advanceTimersByTime(1000);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("SchoolAttentionModal", () => {
  it("opens after a sign-in it has not been shown for", async () => {
    renderModal("login-1");
    await settle();
    expect(screen.getByRole("dialog", { name: "Needs your attention" })).not.toBeNull();
  });

  it("does not open again in the same sign-in once closed", async () => {
    renderModal("login-1");
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    cleanup();
    renderModal("login-1");
    await settle();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens again after the next sign-in, the same day", async () => {
    renderModal("login-1");
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    cleanup();
    renderModal("login-2");
    await settle();
    expect(screen.getByRole("dialog", { name: "Needs your attention" })).not.toBeNull();
  });

  it("keeps only the newest sign-in's mark in storage", async () => {
    window.localStorage.setItem(attentionSeenKey("s1", "login-0"), "1");
    renderModal("login-1");
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(window.localStorage.getItem(attentionSeenKey("s1", "login-0"))).toBeNull();
    expect(window.localStorage.getItem(attentionSeenKey("s1", "login-1"))).toBe("1");
  });
});
