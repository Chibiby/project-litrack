import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Source-reading invariant: a client component never calls a server action
 * bare. Every call goes through a wrapper that turns offline / unreachable /
 * app-updated / crashed requests into a result (or a toast), so the page does
 * not crash with a raw rejection. See CLAUDE.md "Server actions".
 *
 * The rule is lexical, not a line window. For each occurrence of a value
 * imported from `@/lib/actions/*` in a "use client" file, walk outwards through
 * the enclosing brackets. The occurrence is accepted when one of them is:
 *
 *   - the argument list of a wrapper call: callAction( / runOptimistic( or a
 *     local helper that itself calls one of those (LOCAL_WRAPPERS, each one is
 *     verified to do so);
 *   - the expression of a prop whose consumer wraps the handler
 *     (WRAPPING_PROPS: `onConfirm={...}`, which ConfirmAction classifies, and
 *     `onExport={...}`, which the Kinder toolbar wraps in callAction);
 *   - a function that is a named local handler passed as `onConfirm={name}`
 *     elsewhere in the file (the enclosing named function is resolved).
 *
 * A bare reference (not a call) is only accepted as a `<form action={x}>`
 * target listed in FORM_ACTION_ALLOWLIST.
 *
 * Like action-invariants.test.ts, every rule is a pure function of source text
 * with fixtures proving it can fail.
 */

const SRC_DIR = "src";

function walk(dir: string, ext: RegExp): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name).replace(/\\/g, "/");
    if (entry.isDirectory()) return walk(path, ext);
    return ext.test(entry.name) ? [path] : [];
  });
}

/**
 * Blank comments and string/template text (length and newlines preserved, so
 * offsets and line numbers still line up). `${ ... }` inside a template is kept
 * as code. A quote in JSX prose (`don't`) can only blank to the end of its
 * line, which bounds the damage.
 */
function sanitize(src: string): string {
  const out: string[] = [];
  const tplDepth: number[] = [];
  let depth = 0;
  let inTpl = false;
  let i = 0;
  const blank = (ch: string) => (ch === "\n" || ch === "\r" ? ch : " ");
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (inTpl) {
      if (c === "\\") {
        out.push(" ", blank(n ?? " "));
        i += 2;
      } else if (c === "`") {
        inTpl = false;
        out.push(c);
        i++;
      } else if (c === "$" && n === "{") {
        tplDepth.push(depth);
        inTpl = false;
        out.push("$", "{");
        i += 2;
      } else {
        out.push(blank(c));
        i++;
      }
      continue;
    }
    if (c === "/" && n === "/") {
      while (i < src.length && src[i] !== "\n") out.push(" "), i++;
    } else if (c === "/" && n === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end === -1 ? src.length : end + 2;
      while (i < stop) out.push(blank(src[i])), i++;
    } else if (c === '"' || c === "'") {
      out.push(c);
      i++;
      while (i < src.length && src[i] !== c && src[i] !== "\n") {
        if (src[i] === "\\") out.push(" "), i++;
        out.push(blank(src[i] ?? " "));
        i++;
      }
      if (src[i] === c) out.push(c), i++;
    } else if (c === "`") {
      inTpl = true;
      out.push(c);
      i++;
    } else if (c === "{") {
      depth++;
      out.push(c);
      i++;
    } else if (c === "}") {
      if (tplDepth.length && tplDepth[tplDepth.length - 1] === depth) {
        tplDepth.pop();
        inTpl = true;
      } else {
        depth--;
      }
      out.push(c);
      i++;
    } else {
      out.push(c);
      i++;
    }
  }
  return out.join("");
}

/** Blank `import ... from "..."` statements so imported names are not "uses". */
function blankImports(code: string): string {
  return code.replace(/^import\b[^;]*?from\s*["'][^"']*["'];?/gm, (m) => m.replace(/[^\n\r]/g, " "));
}

function isClientFile(source: string): boolean {
  // Only leading comments may precede the directive.
  return /^\s*(?:(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/)\s*)*["']use client["']/.test(source);
}

/** Names imported as values from `@/lib/actions/*` (aliases resolve to the local name). */
function importedActionNames(source: string): { names: Set<string>; unsupported: string[] } {
  const names = new Set<string>();
  const unsupported: string[] = [];
  const code = sanitize(source);
  // The path is a string, blanked by sanitize; read it from the raw source with the same offsets.
  for (const m of source.matchAll(/^import\b([^;]*?)from\s*["']@\/lib\/actions\/[^"']+["']/gm)) {
    const clause = m[1].trim();
    if (/^type\s/.test(clause)) continue;
    if (clause.startsWith("*") || !clause.includes("{")) {
      unsupported.push(m[0].replace(/\s+/g, " "));
      continue;
    }
    const inner = clause.slice(clause.indexOf("{") + 1, clause.lastIndexOf("}"));
    for (const part of inner.split(",")) {
      const t = part.trim();
      if (!t || /^type\s/.test(t)) continue;
      names.add(t.split(/\s+as\s+/).pop()!.trim());
    }
    if (clause.indexOf("{") > 0 && clause.slice(0, clause.indexOf("{")).replace(/,/g, "").trim()) {
      unsupported.push(`default import alongside names: ${m[0].replace(/\s+/g, " ")}`);
    }
  }
  if (/\bimport\(\s*["']@\/lib\/actions\//.test(source) && code) {
    unsupported.push("dynamic import of @/lib/actions/*");
  }
  return { names, unsupported };
}

/** Local helpers that accept an action and call it inside callAction/runOptimistic. */
const WRAPPER_CALLS = new Set(["callAction", "runOptimistic"]);
const LOCAL_WRAPPERS: Record<string, { file: string; reason: string }> = {
  settle: {
    file: "src/components/admin/database-console.tsx",
    reason: "runs its `run` argument through callAction and toasts the failure",
  },
  appendSection: {
    file: "src/components/school-head/section-forms.tsx",
    reason: "runs its `action` argument inside runOptimistic, which toasts and rethrows ToastedError",
  },
};

/** Props whose consumer wraps the handler. Each consumer is verified below. */
const WRAPPING_PROPS: Record<string, { consumer: string; mustContain: RegExp; reason: string }> = {
  onConfirm: {
    consumer: "src/components/confirm-action.tsx",
    mustContain: /await onConfirm\(\)[\s\S]*catch[\s\S]*failureForRejection\(err\)/,
    reason: "ConfirmAction awaits onConfirm in try/catch and toasts failureForRejection(err)",
  },
  onExport: {
    consumer: "src/components/terms/kinder-checklist-toolbar.tsx",
    mustContain: /callAction\(\(\) => onExport\(/,
    reason: "KinderChecklistToolbar calls onExport only inside callAction",
  },
};

/**
 * Bare references that are fine. One reason per entry; a new entry needs a
 * reason a reviewer would accept.
 */
const FORM_ACTION_ALLOWLIST: Record<string, string> = {
  logoutAction:
    "`<form action={logoutAction}>` needs Promise<void>; the action is unwrapped on purpose and always redirects",
};

/**
 * Aliases the lexical rule cannot follow: the action is assigned to a local and
 * the alias is what reaches callAction. Each entry pins the exact assignment
 * line and the wrapped use of the alias, and both must still exist (checked
 * below), so the exemption cannot outlive the code it describes.
 */
const ALIAS_ALLOWLIST: Record<string, { assignment: RegExp; wrappedUse: RegExp; reason: string }> = {
  "src/components/forms/password-form.tsx": {
    assignment: /const action = mode === "set" \? setPasswordAction : completePasswordReset;/,
    wrappedUse: /callAction\(\(\) => action\(/,
    reason: "picks one of two actions by mode, then only ever calls the alias as callAction(() => action(...))",
  },
};

type Site = { name: string; line: number; kind: "call" | "ref"; text: string };

/** Index of the matching enclosing opener chain of `pos`, innermost first. */
function enclosingOpeners(code: string, pos: number): number[] {
  const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
  const stack: string[] = [];
  const found: number[] = [];
  for (let j = pos - 1; j >= 0; j--) {
    const c = code[j];
    if (c === ")" || c === "]" || c === "}") stack.push(pairs[c]);
    else if (c === "(" || c === "[" || c === "{") {
      if (stack.length && stack[stack.length - 1] === c) stack.pop();
      else if (!stack.length) found.push(j);
    }
  }
  return found;
}

/** Names `x` for which `onConfirm={x}` (or `?? x` within it) appears in the file. */
function confirmHandlerNames(code: string): Set<string> {
  const names = new Set<string>();
  for (const m of code.matchAll(/\bonConfirm\s*=\s*\{([^{}]*)\}/g)) {
    for (const id of m[1].matchAll(/[A-Za-z_$][\w$]*/g)) names.add(id[0]);
  }
  return names;
}

/** The innermost `const name =` / `function name` declaration that opens before `pos` and is still open at it. */
function enclosingNamedFunctions(code: string, pos: number): string[] {
  const names: string[] = [];
  for (const open of enclosingOpeners(code, pos)) {
    if (code[open] !== "{" && code[open] !== "(") continue;
    const before = code.slice(0, open);
    // function name(...) {   /   const name = async (...) => {   /   const name = useCallback(
    const m =
      /(?:function\s+([A-Za-z_$][\w$]*)\s*(?:<[^()]*>)?\s*\([^()]*(?:\([^()]*\)[^()]*)*\)\s*(?::[^{=]+)?\s*$)/.exec(before) ??
      /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:useCallback\(\s*)?(?:async\s*)?(?:function\s*)?(?:<[^()]*>)?\s*\([^()]*(?:\([^()]*\)[^()]*)*\)\s*(?::[^=>{]+)?=>\s*$/.exec(
        before
      ) ??
      /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:useCallback\(\s*)?(?:async\s*)?[A-Za-z_$][\w$]*\s*=>\s*$/.exec(before);
    if (m) names.push(m[1]);
  }
  return names;
}

function isWrapped(code: string, pos: number, confirmNames: Set<string>): boolean {
  for (const open of enclosingOpeners(code, pos)) {
    const before = code.slice(0, open);
    if (code[open] === "(") {
      const id = /([A-Za-z_$][\w$]*)\s*(?:<[^()]*>)?\s*$/.exec(before)?.[1];
      if (id && (WRAPPER_CALLS.has(id) || id in LOCAL_WRAPPERS)) return true;
    } else if (code[open] === "{") {
      const prop = /\b([A-Za-z_$][\w$]*)\s*=\s*$/.exec(before)?.[1];
      if (prop && prop in WRAPPING_PROPS) return true;
    }
  }
  return enclosingNamedFunctions(code, pos).some((n) => confirmNames.has(n));
}

function lineOf(code: string, pos: number): number {
  return code.slice(0, pos).split("\n").length;
}

/** Every use of an imported action name in a client file that is not wrapped. */
function unwrappedSites(
  source: string,
  file?: string
): { sites: Site[]; total: number; unsupported: string[] } {
  if (!isClientFile(source)) return { sites: [], total: 0, unsupported: [] };
  const { names, unsupported } = importedActionNames(source);
  const code = blankImports(sanitize(source));
  const rawLines = source.split(/\r?\n/);
  const confirmNames = confirmHandlerNames(code);
  const sites: Site[] = [];
  let total = 0;
  for (const name of names) {
    const esc = name.replace(/\$/g, "\\$");
    for (const m of code.matchAll(new RegExp(`(?<![\\w$.])${esc}(?![\\w$])`, "g"))) {
      const pos = m.index!;
      if (/\btypeof\s+$/.test(code.slice(Math.max(0, pos - 12), pos))) continue;
      const after = code.slice(pos + name.length);
      const kind: Site["kind"] = /^\s*(?:<[^()]*>)?\s*\(/.test(after) ? "call" : "ref";
      total++;
      if (kind === "ref") {
        const isFormAction =
          name in FORM_ACTION_ALLOWLIST &&
          /<form\b[^<>]*\baction\s*=\s*\{\s*$/.test(code.slice(Math.max(0, pos - 200), pos)) &&
          /^\s*\}/.test(after);
        if (isFormAction) continue;
      }
      if (isWrapped(code, pos, confirmNames)) continue;
      const line = lineOf(code, pos);
      const alias = file ? ALIAS_ALLOWLIST[file] : undefined;
      if (alias && alias.assignment.test(rawLines[line - 1] ?? "")) continue;
      sites.push({ name, line, kind, text: (rawLines[line - 1] ?? "").trim() });
    }
  }
  sites.sort((a, b) => a.line - b.line);
  return { sites, total, unsupported };
}

// ---------------------------------------------------------------------------
// The real tree
// ---------------------------------------------------------------------------

const sourceFiles = walk(SRC_DIR, /\.tsx?$/);
const clientFiles = sourceFiles.filter((f) => isClientFile(readFileSync(f, "utf8")));

describe("client components call server actions only through a failure-handling wrapper", () => {
  it("scans a substantial set of client files and action call sites (guards against a scan that matches nothing)", () => {
    expect(clientFiles.length).toBeGreaterThan(100);
    let total = 0;
    let filesWithActions = 0;
    for (const f of clientFiles) {
      const r = unwrappedSites(readFileSync(f, "utf8"));
      total += r.total;
      if (r.total > 0) filesWithActions++;
    }
    expect(filesWithActions).toBeGreaterThan(40);
    expect(total).toBeGreaterThan(150);
  });

  it("uses import forms the scanner understands", () => {
    const offenders = clientFiles.flatMap((f) =>
      unwrappedSites(readFileSync(f, "utf8")).unsupported.map((u) => `${f}: ${u}`)
    );
    expect(offenders).toEqual([]);
  });

  it("has no bare server-action call or reference", () => {
    const offenders: string[] = [];
    for (const f of clientFiles) {
      for (const s of unwrappedSites(readFileSync(f, "utf8"), f).sites) {
        offenders.push(`${f}:${s.line} [${s.kind}] ${s.text}`);
      }
    }
    expect(
      offenders,
      "route through callAction(() => x(...)) / runOptimistic, or an onConfirm handler; never a bare await or try/catch"
    ).toEqual([]);
  });

  it("every local wrapper exists and really wraps with callAction/runOptimistic", () => {
    for (const [name, { file, reason }] of Object.entries(LOCAL_WRAPPERS)) {
      const code = sanitize(readFileSync(file, "utf8"));
      const def = new RegExp(`const ${name}\\s*=`).exec(code);
      expect(def, `${file} no longer defines ${name} (stale LOCAL_WRAPPERS entry)`).not.toBeNull();
      expect(code.slice(def!.index, def!.index + 900), `${name}: ${reason}`).toMatch(/\b(callAction|runOptimistic)\(/);
    }
  });

  it("every wrapping prop's consumer still wraps the handler", () => {
    for (const [prop, { consumer, mustContain, reason }] of Object.entries(WRAPPING_PROPS)) {
      expect(sanitize(readFileSync(consumer, "utf8")), `${prop}: ${reason}`).toMatch(mustContain);
    }
  });

  it("has no stale form-action allowlist entries, and each states a reason", () => {
    for (const [name, reason] of Object.entries(FORM_ACTION_ALLOWLIST)) {
      expect(reason.trim().length, name).toBeGreaterThan(15);
      const used = clientFiles.some((f) => {
        const src = readFileSync(f, "utf8");
        return new RegExp(`<form\\b[^<>]*\\baction=\\{\\s*${name}\\s*\\}`).test(src);
      });
      expect(used, `${name} is no longer used as a form action`).toBe(true);
    }
    for (const [name, { reason }] of Object.entries(LOCAL_WRAPPERS)) expect(reason.length, name).toBeGreaterThan(15);
    for (const [name, { reason }] of Object.entries(WRAPPING_PROPS)) expect(reason.length, name).toBeGreaterThan(15);
  });

  it("has no stale alias allowlist entries, and each states a reason", () => {
    for (const [file, { assignment, wrappedUse, reason }] of Object.entries(ALIAS_ALLOWLIST)) {
      const src = readFileSync(file, "utf8");
      expect(reason.trim().length, file).toBeGreaterThan(15);
      expect(src, `${file}: alias assignment is gone`).toMatch(assignment);
      expect(sanitize(src), `${file}: alias is no longer used through callAction`).toMatch(wrappedUse);
    }
  });

  it("has no stale wrapping-prop entries (the prop is still used with an action nearby)", () => {
    for (const prop of Object.keys(WRAPPING_PROPS)) {
      const used = clientFiles.some((f) => new RegExp(`\\b${prop}\\s*=\\s*\\{`).test(readFileSync(f, "utf8")));
      expect(used, `${prop}={...} appears in no client file`).toBe(true);
    }
  });

  describe("fixtures: the scanner flags violations and accepts the wrappers", () => {
    const head = `"use client";\nimport { saveThing, logoutAction, type Thing } from "@/lib/actions/thing";\n`;
    const flagged = (body: string) => unwrappedSites(head + body).sites;

    it.each([
      ["bare await in an onClick", `<button onClick={async () => { await saveThing(fd); }} />`],
      ["bare await in a handler function", `async function go() {\n  const res = await saveThing(fd);\n  if (!res.ok) toast.error(res.error);\n}`],
      ["try/catch that only toasts", `async function go() {\n  try {\n    await saveThing();\n  } catch {\n    toast.error("Could not save");\n  }\n}`],
      ["void call in startTransition", `startTransition(async () => {\n  void saveThing(fd);\n});`],
      ["callAction mentioned nearby but not enclosing", `const a = callAction(() => other());\nconst b = await saveThing(fd);`],
      ["wrapper name only in a comment", `// callAction(() => saveThing())\nawait saveThing(fd);`],
      ["wrapper name only in a string", `const s = "callAction(";\nawait saveThing(fd);`],
      ["action passed by reference to a button", `<Button onClick={saveThing} />`],
      ["logoutAction called directly", `async function out() { await logoutAction(); }`],
      ["logoutAction on a non-form element", `<Button action={logoutAction} />`],
      ["onConfirm handler mentioned, but the call is in another function", `function other() { return saveThing(fd); }\n<ConfirmAction onConfirm={unrelated} />`],
      ["an undeclared wrapper-looking helper", `function f() { return mystery(() => saveThing(fd)); }`],
    ])("flags: %s", (_label, body) => {
      expect(flagged(body).length).toBeGreaterThan(0);
    });

    it("reports the right line and kind", () => {
      const r = flagged(`async function go() {\n  await saveThing(fd);\n}\n<Button onClick={saveThing} />`);
      expect(r.map((s) => [s.line, s.kind])).toEqual([
        [4, "call"],
        [6, "ref"],
      ]);
    });

    it("flags an un-allowlisted alias assignment", () => {
      expect(flagged(`const action = cond ? saveThing : other;`).length).toBe(1);
    });

    it("flags an aliased import under its local name", () => {
      const src = `"use client";\nimport { saveThing as save } from "@/lib/actions/thing";\nasync function go() { await save(); }\n`;
      expect(unwrappedSites(src).sites.map((s) => s.name)).toEqual(["save"]);
    });

    it("flags a multi-line import's names", () => {
      const src = `"use client";\nimport {\n  a,\n  saveThing,\n} from "@/lib/actions/thing";\nasync function go() { await saveThing(); }\n`;
      expect(unwrappedSites(src).sites.length).toBe(1);
    });

    it.each([
      ["callAction with an arrow", `const res = await callAction(() => saveThing(fd));`],
      ["callAction with a block body", `const res = await callAction(async () => {\n  return saveThing(fd);\n});`],
      ["callAction with a generic", `const res = await callAction<Thing>(() => saveThing(fd));`],
      [
        "ternary across lines inside callAction",
        `const res = await callAction(() =>\n  editing\n    ? saveThing(fd)\n    : saveThing({ id: 1 })\n);`,
      ],
      ["runOptimistic", `runOptimistic(startTransition, async () => {\n  add();\n  const res = await saveThing(fd);\n});`],
      ["inline onConfirm", `<ConfirmAction onConfirm={async () => {\n  const res = await saveThing(fd);\n}} />`],
      ["expression onConfirm", `<ConfirmAction onConfirm={() => saveThing(id)} />`],
      ["named onConfirm handler", `const handle = async () => {\n  await saveThing(fd);\n};\n<ConfirmAction onConfirm={handle} />`],
      ["named onConfirm function declaration", `async function handle() {\n  await saveThing(fd);\n}\n<ConfirmAction onConfirm={handle} />`],
      ["onConfirm with fallback", `const run = useCallback(async () => {\n  await saveThing(fd);\n}, []);\n<ConfirmAction onConfirm={onDelete ?? run} />`],
      ["onExport prop", `<Toolbar onExport={(p) => saveThing({ p })} />`],
      ["local wrapper settle", `await settle(saveThing, () => "done");`],
      ["local wrapper appendSection", `void appendSection(name, saveThing, "Created");`],
      ["form action logoutAction", `<form action={logoutAction}>\n  <button />\n</form>`],
      ["form action with a ref", `<form ref={formRef} action={logoutAction}>`],
      ["typeof in a type position", `type T = Awaited<ReturnType<typeof saveThing>>;`],
      ["template literal text that mentions the action", "const s = `saveThing(`;"],
      ["a comment that mentions the action", `// await saveThing(fd)\n/* saveThing() */`],
      ["a member with the same name", `obj.saveThing(fd);`],
    ])("accepts: %s", (_label, body) => {
      expect(flagged(body)).toEqual([]);
    });

    it("sees through a template-literal expression to the call inside it", () => {
      expect(flagged("const s = `x ${await saveThing()}`;").length).toBe(1);
      expect(flagged("const s = await callAction(() => `x ${saveThing()}`);")).toEqual([]);
    });

    it("ignores files that are not 'use client'", () => {
      const src = `import { saveThing } from "@/lib/actions/thing";\nexport async function page() { await saveThing(); }\n`;
      expect(unwrappedSites(src).sites).toEqual([]);
      expect(isClientFile(`"use client";\nimport x from "y";`)).toBe(true);
      expect(isClientFile(`import x from "y";\n"use client";`)).toBe(false);
    });

    it("ignores type-only imports", () => {
      const src = `"use client";\nimport type { saveThing } from "@/lib/actions/thing";\nconst x = saveThing(1);\n`;
      expect(unwrappedSites(src).total).toBe(0);
    });

    it("rejects import forms it cannot follow", () => {
      const ns = `"use client";\nimport * as actions from "@/lib/actions/thing";\n`;
      expect(unwrappedSites(ns).unsupported.length).toBe(1);
      const dyn = `"use client";\nconst m = await import("@/lib/actions/thing");\n`;
      expect(unwrappedSites(dyn).unsupported.length).toBe(1);
    });
  });
});
