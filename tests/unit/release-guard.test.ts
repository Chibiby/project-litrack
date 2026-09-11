import { describe, expect, it } from "vitest";
import { lacksReleaseEntry, pushSourcesToMain } from "../../.claude/hooks/release-guard.mjs";

/**
 * The push guard behind CLAUDE.md § Releases: a push to main that changes app
 * code must carry a release entry. These pin the two pure halves of the hook;
 * the git calls around them fail open.
 */

describe("pushSourcesToMain", () => {
  it("treats a bare push from main as pushing main", () => {
    expect(pushSourcesToMain("git push", "main")).toEqual(["HEAD"]);
    expect(pushSourcesToMain("git push origin", "main")).toEqual(["HEAD"]);
  });

  it("ignores a bare push from any other branch", () => {
    expect(pushSourcesToMain("git push", "feat/x")).toEqual([]);
    expect(pushSourcesToMain("git push -u origin feat/x", "feat/x")).toEqual([]);
  });

  it("catches an explicit refspec onto main from any branch", () => {
    expect(pushSourcesToMain("git push origin HEAD:main", "feat/x")).toEqual(["HEAD"]);
    expect(pushSourcesToMain("git push origin feat/x:main", "feat/x")).toEqual(["feat/x"]);
    expect(pushSourcesToMain("git push origin feat/x:refs/heads/main", null)).toEqual(["feat/x"]);
    expect(pushSourcesToMain("git push --dry-run origin +HEAD:main", "feat/x")).toEqual(["HEAD"]);
  });

  it("catches `git push origin main`", () => {
    expect(pushSourcesToMain("git push origin main", "main")).toEqual(["HEAD"]);
    expect(pushSourcesToMain("git push origin main", "feat/x")).toEqual(["main"]);
  });

  it("finds the push inside a chained command", () => {
    expect(
      pushSourcesToMain('cd "C:/repo" && git fetch origin && git push origin HEAD:main', "feat/x")
    ).toEqual(["HEAD"]);
  });

  it("ignores commands that are not pushes", () => {
    expect(pushSourcesToMain("git log origin/main", "main")).toEqual([]);
    expect(pushSourcesToMain("npm run test", "main")).toEqual([]);
  });
});

describe("lacksReleaseEntry", () => {
  it("blocks app code with no release entry", () => {
    expect(lacksReleaseEntry(["src/lib/actions/x.ts"])).toBe(true);
    expect(lacksReleaseEntry(["prisma/schema.prisma", "docs/a.md"])).toBe(true);
  });

  it("allows app code that carries a release entry", () => {
    expect(lacksReleaseEntry(["src/lib/actions/x.ts", "src/lib/releases.ts"])).toBe(false);
  });

  it("allows docs, tests and tooling on their own", () => {
    expect(lacksReleaseEntry(["docs/a.md", "tests/unit/a.test.ts", ".claude/agents/x.md"])).toBe(false);
    expect(lacksReleaseEntry([])).toBe(false);
  });
});
