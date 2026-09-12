import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  APP_VERSION,
  RELEASES,
  compareVersions,
  latestRelease,
  unseenReleases,
  visibleFixes,
  type Release,
} from "@/lib/releases";

const rel = (version: string, announce = true): Release => ({
  version,
  date: "2026-09-12",
  title: `Release ${version}`,
  announce,
  fixes: ["A fix"],
});

describe("visibleFixes", () => {
  const release: Release = {
    ...rel("1.0.0"),
    fixes: [
      "Everyone reads this",
      { text: "Admins only", roles: ["SUPER_ADMIN"] },
      { text: "Admins and heads", roles: ["SUPER_ADMIN", "SCHOOL_HEAD"] },
    ],
  };

  it("gives a teacher only the unrestricted notes", () => {
    expect(visibleFixes(release, "TEACHER")).toEqual(["Everyone reads this"]);
  });

  it("gives each role the notes written for it", () => {
    expect(visibleFixes(release, "SCHOOL_HEAD")).toEqual([
      "Everyone reads this",
      "Admins and heads",
    ]);
    expect(visibleFixes(release, "SUPER_ADMIN")).toEqual([
      "Everyone reads this",
      "Admins only",
      "Admins and heads",
    ]);
  });

  it("gives an unknown reader only the unrestricted notes", () => {
    // The safe direction: a restricted note is restricted because reading it
    // discloses something.
    expect(visibleFixes(release, null)).toEqual(["Everyone reads this"]);
  });

  it("keeps the authored order", () => {
    expect(visibleFixes(release, "SUPER_ADMIN")).toEqual(
      release.fixes.map((f) => (typeof f === "string" ? f : f.text))
    );
  });
});

describe("the committed release notes", () => {
  it("announces the current release through the read-once modal", () => {
    expect(RELEASES[0].announce).toBe(true);
  });

  it("never tells a School Head that their own password can be read back", () => {
    // The 1.3.0 privacy case, pinned: this capability is a Super Admin note.
    for (const release of RELEASES) {
      for (const role of ["TEACHER", "SCHOOL_HEAD"] as const) {
        for (const fix of visibleFixes(release, role)) {
          expect(fix.toLowerCase()).not.toMatch(/password .*(recover|reveal|view|read back)/);
        }
      }
    }
  });

  it("leaves every reader at least one note in the current release", () => {
    // A release nobody can read is a release nobody is told about.
    for (const role of ["TEACHER", "SCHOOL_HEAD", "SUPER_ADMIN"] as const) {
      expect(visibleFixes(RELEASES[0], role).length).toBeGreaterThan(0);
    }
  });
});

describe("unseenReleases", () => {
  const history = [
    rel("1.0.10"),
    rel("1.0.9"),
    rel("1.0.8", false),
    rel("1.0.7"),
    rel("1.0.0"),
  ];
  const versions = (lastSeen: string | null) =>
    unseenReleases(lastSeen, history).map((r) => r.version);

  it("returns nothing to a user already on the current version", () => {
    expect(versions("1.0.10")).toEqual([]);
  });

  it("returns every announcing release they skipped, newest first", () => {
    // 1.0.8 does not announce, so it is not listed.
    expect(versions("1.0.0")).toEqual(["1.0.10", "1.0.9", "1.0.7"]);
  });

  it("compares numerically, so 1.0.10 counts as newer than 1.0.9", () => {
    expect(versions("1.0.9")).toEqual(["1.0.10"]);
  });

  it("returns only the current release to a user who has seen none", () => {
    expect(versions(null)).toEqual(["1.0.10"]);
  });

  it("returns only the current release after a rollback or an unknown version", () => {
    expect(versions("2.0.0")).toEqual(["1.0.10"]);
    expect(versions("0.9.9")).toEqual(["1.0.10"]);
  });

  it("returns nothing when the current release does not announce", () => {
    expect(unseenReleases(null, [rel("1.1.0", false), rel("1.0.0")])).toEqual([]);
  });

  it("reads the committed history by default", () => {
    expect(unseenReleases(APP_VERSION)).toEqual([]);
  });
});

describe("compareVersions", () => {
  it("orders by major, then minor, then patch", () => {
    expect(compareVersions("1.0.0", "2.0.0")).toBeLessThan(0);
    expect(compareVersions("1.2.0", "1.10.0")).toBeLessThan(0);
    expect(compareVersions("1.0.9", "1.0.10")).toBeLessThan(0);
    expect(compareVersions("2.0.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
  });

  it("compares numerically, not as strings", () => {
    // "10" < "9" as strings. This is the bug the test exists to catch.
    expect(compareVersions("1.0.10", "1.0.9")).toBeGreaterThan(0);
  });
});

describe("RELEASES", () => {
  it("is not empty", () => {
    expect(RELEASES.length).toBeGreaterThan(0);
  });

  it("is strictly descending by version, newest first", () => {
    for (let i = 1; i < RELEASES.length; i++) {
      expect(
        compareVersions(RELEASES[i - 1].version, RELEASES[i].version)
      ).toBeGreaterThan(0);
    }
  });

  it("has no duplicate versions", () => {
    const seen = new Set(RELEASES.map((r) => r.version));
    expect(seen.size).toBe(RELEASES.length);
  });

  it("carries a YYYY-MM-DD date on every entry", () => {
    for (const r of RELEASES) {
      expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // Rejects 2026-13-01 and 2026-02-30, which the regex alone accepts.
      expect(new Date(`${r.date}T00:00:00Z`).toISOString().slice(0, 10)).toBe(r.date);
    }
  });

  it("carries a semver version with no leading v on every entry", () => {
    for (const r of RELEASES) {
      expect(r.version).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it("lists at least one fix per entry, none of them blank", () => {
    for (const r of RELEASES) {
      expect(r.fixes.length).toBeGreaterThan(0);
      for (const fix of r.fixes) {
        const text = typeof fix === "string" ? fix : fix.text;
        expect(text.trim().length).toBeGreaterThan(0);
        if (typeof fix !== "string") expect(fix.roles.length).toBeGreaterThan(0);
      }
    }
  });

  it("carries a non-blank title on every entry", () => {
    for (const r of RELEASES) {
      expect(r.title.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("APP_VERSION", () => {
  it("is the newest release", () => {
    expect(APP_VERSION).toBe(RELEASES[0].version);
    expect(latestRelease()).toBe(RELEASES[0]);
  });

  it("matches package.json, so the two can never drift", () => {
    const pkg = JSON.parse(
      readFileSync(resolve(process.cwd(), "package.json"), "utf8")
    ) as { version: string };
    expect(pkg.version).toBe(APP_VERSION);
  });
});
