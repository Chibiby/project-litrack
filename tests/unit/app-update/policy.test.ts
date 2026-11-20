import { describe, expect, it } from "vitest";
import {
  VISIBLE_IDLE_MS,
  isNewerDeployment,
  shouldReloadForUpdate,
} from "@/lib/app-update/policy";

const base = {
  updateReady: true,
  hidden: false,
  unsavedWork: false,
  busy: false,
  idleMs: VISIBLE_IDLE_MS,
};

describe("shouldReloadForUpdate", () => {
  it("does nothing until a newer version is live", () => {
    expect(shouldReloadForUpdate({ ...base, updateReady: false, hidden: true })).toBe(false);
  });

  it("never reloads over unsaved work, even in a hidden tab", () => {
    expect(shouldReloadForUpdate({ ...base, unsavedWork: true, hidden: true })).toBe(false);
  });

  it("reloads a hidden tab at once", () => {
    expect(shouldReloadForUpdate({ ...base, hidden: true, idleMs: 0, busy: true })).toBe(true);
  });

  it("waits while the person is active, typing, or in a dialog", () => {
    expect(shouldReloadForUpdate({ ...base, idleMs: VISIBLE_IDLE_MS - 1 })).toBe(false);
    expect(shouldReloadForUpdate({ ...base, busy: true })).toBe(false);
  });

  it("reloads a visible tab after a quiet spell", () => {
    expect(shouldReloadForUpdate(base)).toBe(true);
  });
});

describe("isNewerDeployment", () => {
  it("is true only for a different, non-empty deployment ID", () => {
    expect(isNewerDeployment("v2_76_3-abc", { deploymentId: "v2_76_4-def" })).toBe(true);
    expect(isNewerDeployment("v2_76_3-abc", { deploymentId: "v2_76_3-abc" })).toBe(false);
    expect(isNewerDeployment("v2_76_3-abc", { deploymentId: "" })).toBe(false);
    expect(isNewerDeployment("v2_76_3-abc", null)).toBe(false);
    expect(isNewerDeployment(undefined, { deploymentId: "x" })).toBe(false);
  });
});
