import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

/**
 * Test Lab dry run (docs/test-lab-spec.md T6): every self-bound form page
 * computes `dryRun` from `readTestLabSession(user)` server-side and passes it
 * down, and both onboarding layouts consult it before their
 * already-profiled → dashboard redirect.
 */
describe("Test Lab dry-run wiring", () => {
  it.each([
    ["src/app/school-head/(onboarding)/profiling/page.tsx", "SchoolHeadProfileForm"],
    ["src/app/teacher/(onboarding)/profiling/page.tsx", "TeacherProfileForm"],
    ["src/app/school-head/(app)/settings/profile/page.tsx", "SchoolHeadProfileForm"],
    ["src/app/teacher/(app)/settings/profile/page.tsx", "TeacherProfileForm"],
    ["src/app/school-head/(app)/settings/security/page.tsx", "PasswordForm"],
    ["src/app/teacher/(app)/settings/security/page.tsx", "PasswordForm"],
    ["src/app/account/set-password/page.tsx", "PasswordForm"],
  ])("computes dryRun from readTestLabSession and passes it into %s's form(s) (%s)", (file) => {
    const page = read(file);

    expect(page).toContain('from "@/lib/auth/test-lab"');
    expect(page).toContain("readTestLabSession");
    expect(page).toMatch(/dryRun(?:\s*[:=])/);
    expect(page).toContain("dryRun={dryRun}");
  });

  it.each([
    "src/app/school-head/(onboarding)/layout.tsx",
    "src/app/teacher/(onboarding)/layout.tsx",
  ])("consults readTestLabSession before the already-profiled redirect in %s", (file) => {
    const layout = read(file);

    expect(layout).toContain('from "@/lib/auth/test-lab"');
    expect(layout).toContain("readTestLabSession");
    expect(layout).toMatch(
      /user\.profileCompleted && !\(await readTestLabSession\(user\)\)/,
    );
  });
});
