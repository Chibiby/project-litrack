import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

describe("impersonation notice wiring", () => {
  it("renders only a verified bound context for the current target", () => {
    const notice = read("src/components/admin/impersonation-notice.tsx");

    expect(notice).toContain("impersonation?: ImpersonationContext | null");
    expect(notice).toContain("impersonation === undefined");
    expect(notice).toContain("context?.ticket.targetUserId !== userId");
  });

  it.each([
    "src/app/school-head/(app)/layout.tsx",
    "src/app/teacher/(app)/layout.tsx",
  ])("uses one bound result for the notice and shell decisions in %s", (file) => {
    const layout = read(file);

    expect(layout).toContain("const impersonation = await readBoundImpersonationSession(supabase.auth);");
    expect(layout).toContain("const impersonating = impersonation?.ticket.targetUserId === user.id;");
    expect(layout).toContain("impersonation={impersonation}");
    expect(layout).toContain(
      "lastSeenReleaseVersion={impersonating ? undefined : user.lastSeenReleaseVersion}"
    );
  });

  it("keeps an expired bound session visible with only a safe sign-out exit", () => {
    const banner = read("src/components/admin/impersonation-banner.tsx");

    expect(banner).toContain("The return window has expired; sign out to leave this session.");
    expect(banner).toContain("<form action={logoutAction}>");
    expect(banner).toContain("<SignOutButton");
    expect(banner).toContain("{expired ? (");
  });

  it("does not track teacher presence while a Super Admin impersonates the teacher", () => {
    const layout = read("src/app/teacher/(app)/layout.tsx");

    expect(layout).toContain("trackTeacherPresence={!impersonating}");
  });

  it.each([
    ["src/app/school-head/(app)/layout.tsx", 'role="SCHOOL_HEAD"'],
    ["src/app/teacher/(app)/layout.tsx", 'role="TEACHER"'],
  ])("passes schoolId and role to the notice in %s, for Test Lab banner (T8)", (file, roleProp) => {
    const layout = read(file);

    expect(layout).toContain("schoolId={user.schoolId}");
    expect(layout).toContain(roleProp);
  });

  it("computes the Test Lab checklist only from a verified server-side test-lab session", () => {
    const notice = read("src/components/admin/impersonation-notice.tsx");

    expect(notice).toContain("readTestLabSession({ id: userId, schoolId: schoolId ?? null })");
    expect(notice).toContain("testLab={testLab}");
  });

  it("keeps a non-Test-Lab impersonation banner unchanged", () => {
    const banner = read("src/components/admin/impersonation-banner.tsx");

    expect(banner).toContain("Signed in as <strong className=\"font-semibold\">{accountName}</strong> — anything you");
    expect(banner).toContain('{testLab ? "Back to Test Lab" : "Return to admin"}');
  });
});
