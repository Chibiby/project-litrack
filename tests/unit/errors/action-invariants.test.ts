import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Source-reading invariants for the error-handling overhaul. Nothing here runs
 * an action; it reads the files, the way tests/unit/teachers/fresh-reads.test.ts
 * does, so a regression in a file nobody executes still fails CI.
 *
 * Each rule is a pure function of source text, and each has a "fixture" test
 * that feeds it a violating string and expects it to be caught. Those fixture
 * tests are the proof the invariant can fail: if someone loosens a regex until
 * it matches nothing, the fixture test fails even though the real tree is clean.
 */

const ACTIONS_DIR = "src/lib/actions";
const COMPONENTS_DIR = "src/components";

function walk(dir: string, ext: RegExp): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name).replace(/\\/g, "/");
    if (entry.isDirectory()) return walk(path, ext);
    return ext.test(entry.name) ? [path] : [];
  });
}

/** Drops whole-line comments so prose that mentions `err.message` is not scanned. */
function stripCommentLines(source: string): string {
  let inBlock = false;
  return source
    .split(/\r?\n/)
    .map((line) => {
      const t = line.trim();
      if (inBlock) {
        if (t.includes("*/")) inBlock = false;
        return "";
      }
      if (t.startsWith("/*")) {
        if (!t.includes("*/")) inBlock = true;
        return "";
      }
      if (t.startsWith("//")) return "";
      return line;
    })
    .join("\n");
}

// ---------------------------------------------------------------------------
// (a) Every exported server action is wrapped by action(), or is allowlisted.
// ---------------------------------------------------------------------------

/**
 * Exports that are deliberately NOT `action(...)`. One reason per entry; keep
 * this list short. A new entry needs a reason a reviewer would accept.
 *
 * "code comment" = the export carries a "Deliberately NOT wrapped" style note
 * in src. "lead" = the reason was supplied by the lead and the source has no
 * comment saying so (worth adding one; see the QA report).
 */
const UNWRAPPED_ALLOWLIST: Record<string, string> = {
  "auth.ts:logoutAction":
    "form action (`<form action={logoutAction}>` needs Promise<void>); always redirects [code comment]",
  "presence.ts:recordTeacherPresence":
    "heartbeat: pool hiccups are routine noise, must not write ErrorEvent rows or alert emails [code comment]",
  "notifications.ts:fetchAralAssignmentAlerts":
    "client treats the resolved value as the alert array; a failed read degrades to no alert [code comment]",
  "notifications.ts:fetchUnlockAlerts":
    "same call posture as fetchAralAssignmentAlerts; resolved value is the array itself [code comment]",
  "district-announcements.ts:listMyBroadcasts":
    "called from a server component, not from client code; returns rows, not a result [lead; no code comment]",
  "school.ts:listSchoolsPublic":
    "unauthenticated loader used by pages, returns rows; nothing for the wrapper to add [lead; no code comment]",
  "school.ts:listSchoolsWithTeacherStatus":
    "unauthenticated loader behind the login dropdowns, returns rows [lead; no code comment]",
};

type ExportKind = "wrapped" | "unwrapped" | "unsupported";
type ExportedValue = { name: string; kind: ExportKind };

/** Value exports of a "use server" module. Type/interface exports are ignored. */
function valueExports(source: string): ExportedValue[] {
  const code = stripCommentLines(source);
  const out: ExportedValue[] = [];

  for (const m of code.matchAll(/^export\s+(?:const|let|var)\s+(\w+)\s*(?::[^=\n]+)?=\s*([^\n]*)/gm)) {
    const rest = m[2];
    // `action(` / `action<T>(`, possibly with the call broken onto the next line.
    out.push({ name: m[1], kind: /^\s*action\s*(?:<[^(]*>)?\s*\(/.test(rest) ? "wrapped" : "unwrapped" });
  }
  for (const m of code.matchAll(/^export\s+(?:async\s+)?function\s*\*?\s*(\w+)/gm)) {
    out.push({ name: m[1], kind: "unwrapped" });
  }
  for (const m of code.matchAll(/^export\s+class\s+(\w+)/gm)) {
    out.push({ name: m[1], kind: "unwrapped" });
  }
  // Re-exports and default exports hide what is exported from this scan.
  for (const m of code.matchAll(/^export\s+(?:default\b|\{|\*)[^\n]*/gm)) {
    if (/^export\s+(?:type\s+)?\{[^}]*\}\s*$/.test(m[0]) && /^export\s+type\b/.test(m[0])) continue;
    // `export {};` exports nothing (a module emptied of its actions, awaiting deletion).
    if (/^export\s*\{\s*\}\s*;?\s*$/.test(m[0])) continue;
    out.push({ name: m[0].trim(), kind: "unsupported" });
  }
  return out;
}

const actionFiles = walk(ACTIONS_DIR, /\.ts$/);

describe("every exported server action is wrapped by action() or allowlisted", () => {
  it("scans the whole actions directory, all of it 'use server'", () => {
    expect(actionFiles.length).toBeGreaterThan(40);
    for (const file of actionFiles) {
      const first = stripCommentLines(readFileSync(file, "utf8")).trimStart();
      expect(first.startsWith('"use server"') || first.startsWith("'use server'"), file).toBe(true);
    }
  });

  it("finds a substantial number of wrapped actions (guards against a regex that matches nothing)", () => {
    const wrapped = actionFiles.flatMap((f) =>
      valueExports(readFileSync(f, "utf8")).filter((e) => e.kind === "wrapped")
    );
    expect(wrapped.length).toBeGreaterThan(100);
  });

  it("has no unwrapped value export outside the allowlist", () => {
    const offenders: string[] = [];
    for (const file of actionFiles) {
      const base = file.split("/").pop()!;
      for (const e of valueExports(readFileSync(file, "utf8"))) {
        if (e.kind === "wrapped") continue;
        if (e.kind === "unwrapped" && `${base}:${e.name}` in UNWRAPPED_ALLOWLIST) continue;
        offenders.push(`${base}: ${e.name} (${e.kind})`);
      }
    }
    expect(offenders, "wrap these with action(), or add an allowlist entry with a reason").toEqual([]);
  });

  it("has no stale allowlist entries", () => {
    const present = new Set<string>();
    for (const file of actionFiles) {
      const base = file.split("/").pop()!;
      for (const e of valueExports(readFileSync(file, "utf8"))) {
        if (e.kind === "unwrapped") present.add(`${base}:${e.name}`);
      }
    }
    const stale = Object.keys(UNWRAPPED_ALLOWLIST).filter((k) => !present.has(k));
    expect(stale).toEqual([]);
  });

  it("every allowlist entry states a reason", () => {
    for (const [key, reason] of Object.entries(UNWRAPPED_ALLOWLIST)) {
      expect(reason.trim().length, key).toBeGreaterThan(15);
    }
  });

  describe("fixtures: the scanner flags violations", () => {
    it("flags a plain async function export", () => {
      const src = `"use server";\nexport async function saveThing() { return 1; }\n`;
      expect(valueExports(src)).toEqual([{ name: "saveThing", kind: "unwrapped" }]);
    });
    it("flags a const arrow export that skips action()", () => {
      const src = `"use server";\nexport const saveThing = async () => ({ ok: true });\n`;
      expect(valueExports(src)).toEqual([{ name: "saveThing", kind: "unwrapped" }]);
    });
    it("flags a const wrapped by something other than action()", () => {
      const src = `"use server";\nexport const saveThing = withAuth(async () => 1);\n`;
      expect(valueExports(src)[0].kind).toBe("unwrapped");
    });
    it("flags a re-export and a default export", () => {
      expect(valueExports(`export { a, b } from "./x";\n`)[0].kind).toBe("unsupported");
      expect(valueExports(`export default async function () {}\n`).some((e) => e.kind === "unsupported")).toBe(true);
    });
    it("ignores an empty `export {};` but still flags a non-empty export list", () => {
      expect(valueExports(`"use server";\nexport {};\n`)).toEqual([]);
      expect(valueExports(`export { a };\n`)[0].kind).toBe("unsupported");
    });
    it("accepts action(), action<T>() and a call broken onto the next line", () => {
      const src = [
        `export const a = action("a", async () => 1);`,
        `export const b = action<string>("b", async () => 1);`,
        `export const c = action(\n  "c",\n  async () => 1\n);`,
        `export const d =\n  action("d", async () => 1);`,
      ].join("\n");
      expect(valueExports(src).map((e) => e.kind)).toEqual(["wrapped", "wrapped", "wrapped", "wrapped"]);
    });
    it("ignores type-only exports and commented-out code", () => {
      const src = `export type A = { a: 1 };\nexport interface B {}\n// export async function nope() {}\n/*\nexport async function nope2() {}\n*/\n`;
      expect(valueExports(src)).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------
// (b) Actions never hand a raw error message to the client.
// ---------------------------------------------------------------------------

const IDENT = "(?:err|e|ex|error|caught|cause|rollbackErr|exception)";
const RAW_MESSAGE_PATTERNS: Array<[string, RegExp]> = [
  // error: err.message, error: parsed.error.message, error: err instanceof Error ? err.message : ...
  ["error: <x>.message", new RegExp(`\\berror:\\s*(?:[\\w.]+\\s+instanceof\\s+\\w+\\s*\\?\\s*)?[\\w.?]*\\b${IDENT}\\??\\.message\\b`)],
  ["error: String(<x>", new RegExp(`\\berror:\\s*String\\(\\s*${IDENT}\\b`)],
  // `error: rollbackErr } = await ...` is a destructure, not a returned object.
  ["error: <x> (raw thrown value)", new RegExp(`\\berror:\\s*${IDENT}\\s*(?:,|\\}(?!\\s*=))`)],
  // Only on a line that returns / builds a failure; `${err.message}` inside a template is server-side text.
  [
    "<x>.message } (last member of a returned object)",
    new RegExp(`(?:\\breturn\\b|\\bok:\\s*false\\b).*(?<!\\$\\{)\\b${IDENT}\\??\\.message\\s*\\}`),
  ],
];

function rawMessageHits(source: string): Array<{ line: number; rule: string; text: string; before: string }> {
  const lines = stripCommentLines(source).split("\n");
  const hits: Array<{ line: number; rule: string; text: string; before: string }> = [];
  lines.forEach((text, i) => {
    for (const [rule, re] of RAW_MESSAGE_PATTERNS) {
      if (re.test(text)) {
        hits.push({ line: i + 1, rule, text: text.trim(), before: lines.slice(Math.max(0, i - 2), i).join("\n") });
        break;
      }
    }
  });
  return hits;
}

/**
 * Domain errors whose `message` is authored for the user, so returning it is
 * intended. Each entry must be guarded by `instanceof <class>` within the two
 * lines above the hit, and the count per file is pinned so a new unreviewed
 * site fails.
 *
 * - AdvisoryCapError (src/lib/teachers/section-assignment.ts): message is built
 *   from a fixed reason string plus the teacher's own section names.
 */
const SAFE_MESSAGE_SITES: Array<{ file: string; guard: RegExp; count: number; reason: string }> = [
  {
    file: "teacher.ts",
    guard: /instanceof AdvisoryCapError/,
    count: 2,
    reason: "AdvisoryCapError message is a fixed advisory-cap sentence plus the teacher's own section names",
  },
];

/*
 * SnapshotFormatError (src/lib/db/snapshot-format.ts) needs no entry: it only
 * reaches the client through `throw refuse(...)` in database.ts (guarded by
 * `instanceof SnapshotFormatError`), which the wrapper turns into a safe result.
 * The scan below still covers database.ts, and the pin test asserts the guard.
 */

describe("actions never return a raw error message to the client", () => {
  it("has no raw-message pattern outside the reviewed safe sites", () => {
    const offenders: string[] = [];
    for (const file of actionFiles) {
      const base = file.split("/").pop()!;
      const hits = rawMessageHits(readFileSync(file, "utf8"));
      const allowed = SAFE_MESSAGE_SITES.find((s) => s.file === base);
      const unguarded = hits.filter((h) => !(allowed && allowed.guard.test(h.before)));
      for (const h of unguarded) offenders.push(`${base}:${h.line} [${h.rule}] ${h.text}`);
    }
    expect(offenders).toEqual([]);
  });

  it.each(SAFE_MESSAGE_SITES)("$file: safe-site count is pinned ($reason)", ({ file, guard, count }) => {
    const hits = rawMessageHits(readFileSync(join(ACTIONS_DIR, file), "utf8"));
    expect(hits.filter((h) => guard.test(h.before)).length).toBe(count);
  });

  it("database.ts only surfaces SnapshotFormatError.message through refuse() under an instanceof guard", () => {
    const src = readFileSync(join(ACTIONS_DIR, "database.ts"), "utf8");
    expect(src).toMatch(/instanceof SnapshotFormatError\)\s*\{\s*throw refuse\(`\$\{err\.message\}/);
  });

  describe("fixtures: the patterns catch violations", () => {
    it.each([
      ["return { ok: false, error: err.message };", "error: <x>.message"],
      ["return { ok: false, error: e.message };", "error: <x>.message"],
      ["return { ok: false, error: error.message }", "error: <x>.message"],
      ["return { ok: false, error: parsed.error.message };", "error: <x>.message"],
      ["return { ok: false, error: err instanceof Error ? err.message : 'x' };", "error: <x>.message"],
      ["return { ok: false, error: String(e) };", "error: String(<x>"],
      ["return { ok: false, error: String(err instanceof Error ? err.message : err) };", "error: String(<x>"],
      ["return { ok: false, error: err };", "error: <x> (raw thrown value)"],
      ["return { ok: false, code: 'X', detail: err.message };", "<x>.message } (last member of a returned object)"],
    ])("catches %s", (line, rule) => {
      const hits = rawMessageHits(`${line}\n`);
      expect(hits.length).toBe(1);
      expect(hits[0].rule).toBe(rule);
    });

    it.each([
      'return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };',
      "throw new AppError('X', { detail: err.message });",
      "console.error('[x]', err instanceof Error ? err.message : String(err));",
      "return { ok: false, error: SECTION_TAKEN_ERROR };",
      "// return { ok: false, error: err.message };",
    ])("does not flag %s", (line) => {
      expect(rawMessageHits(`${line}\n`)).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------
// (c) Client components never toast a caught error's message.
// ---------------------------------------------------------------------------

const TOAST_IDENT = "(?:err|e|ex|error|caught|cause|exception)";
const RAW_TOAST_PATTERNS: Array<[string, RegExp]> = [
  ["toast.error(<x>.message", new RegExp(`\\btoast\\.error\\(\\s*${TOAST_IDENT}\\??\\.message\\b`)],
  ["toast.error(String(", /\btoast\.error\(\s*String\(/],
  ["toast.error(<x>)", new RegExp(`\\btoast\\.error\\(\\s*${TOAST_IDENT}\\s*[,)]`)],
  ["toast.error(<x> instanceof Error ? …)", new RegExp(`\\btoast\\.error\\(\\s*${TOAST_IDENT}\\s+instanceof\\b`)],
];

function rawToastHits(source: string): Array<{ line: number; rule: string; text: string }> {
  const code = stripCommentLines(source);
  const hits: Array<{ line: number; rule: string; text: string }> = [];
  // Scan the joined text too, so `toast.error(\n  err.message` is caught.
  for (const [rule, re] of RAW_TOAST_PATTERNS) {
    const global = new RegExp(re.source, "g");
    for (const m of code.matchAll(global)) {
      const line = code.slice(0, m.index).split("\n").length;
      hits.push({ line, rule, text: m[0].replace(/\s+/g, " ") });
    }
  }
  return hits;
}

function isClientFile(source: string): boolean {
  return /^["']use client["']/.test(stripCommentLines(source).trimStart());
}

describe("client components never toast a raw error message", () => {
  const files = walk(COMPONENTS_DIR, /\.tsx?$/);
  const clientFiles = files.filter((f) => isClientFile(readFileSync(f, "utf8")));

  it("scans a substantial set of 'use client' files (guards against a scan that matches nothing)", () => {
    expect(clientFiles.length).toBeGreaterThan(100);
    const withToast = clientFiles.filter((f) => /\btoast\.error\(/.test(readFileSync(f, "utf8")));
    expect(withToast.length).toBeGreaterThan(15);
  });

  it("has no toast.error(err.message | String(...) | <caught value>)", () => {
    const offenders: string[] = [];
    for (const file of clientFiles) {
      for (const h of rawToastHits(readFileSync(file, "utf8"))) {
        offenders.push(`${file}:${h.line} [${h.rule}] ${h.text}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  describe("fixtures: the patterns catch violations", () => {
    it.each([
      "toast.error(err.message);",
      "toast.error(e.message);",
      "toast.error(error.message)",
      "toast.error(err?.message ?? 'x')",
      "toast.error(String(err));",
      "toast.error(String(e instanceof Error ? e.message : e))",
      "toast.error(err)",
      "toast.error(err instanceof Error ? err.message : 'x')",
      "toast.error(\n  err.message\n);",
    ])("catches %s", (line) => {
      expect(rawToastHits(`${line}\n`).length).toBeGreaterThan(0);
    });

    it.each([
      "toast.error(res.error);",
      'toast.error(parsed.error.errors[0]?.message ?? "Invalid input");',
      "toast.error(formatMessage('NETWORK_OFFLINE'));",
      "// toast.error(err.message);",
    ])("does not flag %s", (line) => {
      expect(rawToastHits(`${line}\n`)).toEqual([]);
    });

    it("only scans files that start with 'use client'", () => {
      expect(isClientFile(`"use client";\nimport x from "y";`)).toBe(true);
      expect(isClientFile(`import x from "y";\n"use client";`)).toBe(false);
    });
  });
});
