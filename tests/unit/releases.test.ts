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
  visibleGuide,
  visibleHighlights,
  welcomeRelease,
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
  it("describes the support email and instant conversation release", () => {
    const release = RELEASES.find((item) => item.version === "1.11.0");
    expect(release).toBeDefined();
    const notes = release!.fixes.map((fix) =>
      typeof fix === "string" ? fix : fix.text
    );
    expect(notes.join(" ").toLowerCase()).toContain("support");
    expect(notes.join(" ").toLowerCase()).toContain("email");
    expect(notes.join(" ").toLowerCase()).toContain("conversation");
  });

  it("describes learner archives and the renamed profiling workspace", () => {
    const archiveRelease = RELEASES.find((item) => item.version === "1.12.0");
    expect(archiveRelease).toBeDefined();
    const notes = archiveRelease!.fixes
      .map((fix) => (typeof fix === "string" ? fix : fix.text))
      .join(" ")
      .toLowerCase();
    expect(notes).toContain("archive");
    expect(notes).toContain("restore");
    expect(notes).toContain("learner profiling");
  });

  it("keeps the announcement decision explicit on the current release", () => {
    // Not "the newest release is always announced": 1.12.1 restores scheduled
    // backups and database routing, which changes nothing a teacher or School
    // Head does, so interrupting every user with a modal would be noise. What
    // must hold is that `announce` is a considered value rather than an
    // omission, and that the modal path still has something to show.
    expect(typeof RELEASES[0].announce).toBe("boolean");
    expect(RELEASES.some((release) => release.announce)).toBe(true);
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

describe("welcomeRelease", () => {
  const landmark: Release = {
    ...rel("2.0.0"),
    welcome: {
      headline: { en: "h", fil: "h" },
      intro: { en: "i", fil: "i" },
      highlightsTitle: { en: "ht", fil: "ht" },
      highlightsSubtitle: { en: "hs", fil: "hs" },
      highlights: [],
      guide: [],
    },
  };
  const history = [rel("2.0.2"), rel("2.0.1"), landmark, rel("1.9.0")];

  it("welcomes a brand-new account even after later patches ship", () => {
    expect(welcomeRelease(null, history)).toBe(landmark);
  });

  it("welcomes someone last on a version before the landmark", () => {
    expect(welcomeRelease("1.9.0", history)).toBe(landmark);
  });

  it("retires once the landmark or anything later is acknowledged", () => {
    expect(welcomeRelease("2.0.0", history)).toBeNull();
    expect(welcomeRelease("2.0.1", history)).toBeNull();
  });

  it("is null when no release carries a welcome", () => {
    expect(welcomeRelease(null, [rel("1.0.0")])).toBeNull();
  });
});

describe("the committed v2 welcome", () => {
  const v2 = RELEASES.find((r) => r.welcome);

  it("exists on 2.0.0", () => {
    expect(v2?.version).toBe("2.0.0");
  });

  it("gives every role at least one card and one tour step", () => {
    for (const role of ["TEACHER", "SCHOOL_HEAD", "SUPER_ADMIN"] as const) {
      expect(visibleHighlights(v2!.welcome!, role).length, role).toBeGreaterThan(0);
      expect(visibleGuide(v2!.welcome!, role).length, role).toBeGreaterThan(0);
    }
  });

  it("has Filipino for every line it shows", () => {
    const w = v2!.welcome!;
    const texts = [w.headline, w.intro, w.highlightsTitle, w.highlightsSubtitle, ...w.highlights.flatMap((h) => [h.title, h.body]), ...w.guide.flatMap((g) => [g.title, g.body])];
    for (const text of texts) {
      expect(text.fil.trim(), text.en).not.toBe("");
      expect(text.fil, text.en).not.toBe(text.en);
    }
  });

  it("links tour steps only to pages inside the reader's own area", () => {
    const area = { TEACHER: "/teacher", SCHOOL_HEAD: "/school-head", SUPER_ADMIN: "/admin" } as const;
    for (const role of ["TEACHER", "SCHOOL_HEAD", "SUPER_ADMIN"] as const) {
      for (const step of visibleGuide(v2!.welcome!, role)) {
        if (step.href) expect(step.href.startsWith(area[role]), step.title.en).toBe(true);
      }
    }
  });

  it("keeps each role's tour short", () => {
    for (const role of ["TEACHER", "SCHOOL_HEAD", "SUPER_ADMIN"] as const) {
      expect(visibleGuide(v2!.welcome!, role).length, role).toBeLessThanOrEqual(5);
    }
  });
});
