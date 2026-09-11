import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Where the release modal is switched on (§2 of the ten concerns).
 *
 * `RoleShell` renders the modal only when a layout hands it a stamp, and
 * `undefined` deliberately renders nothing. That makes the failure silent: a
 * layout that forgets the prop just never announces to its role, and no
 * behavioural test of the modal would notice. So this reads the three layouts.
 *
 * It also pins the one place the stamp must NOT be passed. While an admin
 * impersonates a School Head, `user` is the head's own account — acknowledging
 * would stamp the head's row, and the real head would never see the release.
 */

const APP = path.resolve(__dirname, "../../src/app");
const read = (file: string) => readFileSync(path.join(APP, file), "utf8");

describe("the role layouts hand RoleShell the release stamp", () => {
  it.each([
    ["admin/layout.tsx"],
    ["school-head/(app)/layout.tsx"],
    ["teacher/(app)/layout.tsx"],
  ])("%s passes lastSeenReleaseVersion", (file) => {
    expect(read(file)).toMatch(/lastSeenReleaseVersion=\{/);
  });

  it("the School Head layout withholds it while an admin impersonates", () => {
    expect(read("school-head/(app)/layout.tsx")).toMatch(
      /lastSeenReleaseVersion=\{impersonating \? undefined : user\.lastSeenReleaseVersion\}/
    );
  });

  it("no layout adds a query for it — it comes off the row already loaded", () => {
    // The plan's rule: the common path (nothing to show) must cost nothing.
    for (const file of [
      "admin/layout.tsx",
      "school-head/(app)/layout.tsx",
      "teacher/(app)/layout.tsx",
    ]) {
      expect(read(file)).not.toMatch(/lastSeenReleaseVersion:\s*true/);
    }
  });
});
