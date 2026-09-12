import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const recordTeacherPresence = vi.fn(async () => ({ ok: true as const }));

vi.mock("@/lib/actions/presence", () => ({
  recordTeacherPresence: () => recordTeacherPresence(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/teacher/dashboard",
}));

import { TeacherPresenceHeartbeat } from "@/components/presence/teacher-presence-heartbeat";

let visible = true;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-12T10:00:00.000Z"));
  visible = true;
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => (visible ? "visible" : "hidden"),
  });
  recordTeacherPresence.mockClear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("TeacherPresenceHeartbeat", () => {
  it("records once when a visible teacher shell mounts", () => {
    render(<TeacherPresenceHeartbeat />);

    expect(recordTeacherPresence).toHaveBeenCalledTimes(1);
  });

  it("stays silent while hidden and records when the page becomes visible", () => {
    visible = false;
    render(<TeacherPresenceHeartbeat />);
    expect(recordTeacherPresence).not.toHaveBeenCalled();

    visible = true;
    fireEvent(document, new Event("visibilitychange"));
    expect(recordTeacherPresence).toHaveBeenCalledTimes(1);
  });

  it("coalesces activity inside one minute and records the next eligible activity", () => {
    render(<TeacherPresenceHeartbeat />);
    fireEvent.pointerDown(document);
    fireEvent.keyDown(document, { key: "Enter" });
    fireEvent.touchStart(document);
    fireEvent.focus(window);
    expect(recordTeacherPresence).toHaveBeenCalledTimes(1);

    act(() => vi.advanceTimersByTime(60_000));
    fireEvent.pointerDown(document);
    expect(recordTeacherPresence).toHaveBeenCalledTimes(2);
  });

  it("never records when disabled for impersonation", () => {
    render(<TeacherPresenceHeartbeat disabled />);
    fireEvent.pointerDown(document);
    act(() => vi.advanceTimersByTime(60_000));
    fireEvent.keyDown(document, { key: "A" });

    expect(recordTeacherPresence).not.toHaveBeenCalled();
  });
});
