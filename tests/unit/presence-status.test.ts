import { describe, expect, it } from "vitest";
import { getPresenceStatus } from "@/lib/presence/status";

const NOW = new Date("2026-09-12T12:00:00.000Z");

describe("getPresenceStatus", () => {
  it("treats the inclusive three-minute boundary as online", () => {
    expect(getPresenceStatus(new Date("2026-09-12T11:57:00.000Z"), NOW)).toEqual({
      online: true,
      label: "Online",
    });
  });

  it.each([
    ["2026-09-12T11:56:59.999Z", "Last online 3m ago"],
    ["2026-09-12T11:10:00.000Z", "Last online 50m ago"],
    ["2026-09-12T09:00:00.000Z", "Last online 3h ago"],
    ["2026-09-10T12:00:00.000Z", "Last online 2d ago"],
  ])("formats recent history at %s", (at, label) => {
    expect(getPresenceStatus(new Date(at), NOW)).toEqual({ online: false, label });
  });

  it("uses a compact date for history at least seven days old", () => {
    expect(getPresenceStatus(new Date("2026-09-01T12:00:00.000Z"), NOW)).toEqual({
      online: false,
      label: "Last online Sep 1",
    });
  });

  it("reports unavailable when no valid timestamp exists", () => {
    expect(getPresenceStatus(null, NOW)).toEqual({
      online: false,
      label: "Last online unavailable",
    });
    expect(getPresenceStatus(new Date("invalid"), NOW)).toEqual({
      online: false,
      label: "Last online unavailable",
    });
  });
});
