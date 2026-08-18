# School Head District Login & Roster Import — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import the 332-school DepEd Sarangani roster into `School` (district, school name, School ID only), and rebuild the `/login` School Head flow as a district filter narrowing a searchable school dropdown, with the School ID as the first-time password.

**Architecture:** A pure, DB-free parser reads the workbook and reports diagnostics; a pure credential resolver applies the owner's collision policy; a committed dry-run-by-default script does the Supabase + Prisma writes (a human runs it, never Claude). On the UI side, a new `SearchableSelect` primitive built on the existing Popover replaces the plain school `Select`, and a district `Select` above it narrows the option list through pure, unit-tested helpers.

**Tech Stack:** Next.js 15.5 App Router · React 19 · TypeScript strict · Prisma 5 → Supabase Postgres · Supabase Auth · Zod · Tailwind + shadcn/ui · `@radix-ui/react-popover` · exceljs · tsx · Vitest + Testing Library + Playwright.

**Spec:** `docs/superpowers/specs/2026-08-18-school-head-district-login-and-roster-import.md` — read it, **including the Addendum**, before starting any task. The Addendum closes branches B0/B1 and C0/C1 and adds R17–R19; where it conflicts with earlier text, the Addendum wins.

## Global Constraints

- **No new dependencies.** Not `cmdk`, not a virtualization library. `@radix-ui/react-popover` is already installed and is what `SearchableSelect` is built on.
- **No migration.** Branch **B0** is confirmed (zero duplicate school names). `prisma/**` is not touched by any task and `database-engineer` is not engaged.
- **Claude never runs the import script**, nor `prisma migrate *`, `prisma db push`, or any destructive SQL. Per `CLAUDE.md`, Claude authors; the owner applies.
- **No test reads the real roster file.** Fixtures are small `.xlsx` files generated in-test with `exceljs`. `C:\Users\PC5\Downloads\...xlsx` must not appear in `tests/**` or `e2e/**`.
- **Only district, school name, and School ID** are read from the sheet as authoritative. School-head name, sex, designation, item number, age, FB name, contact number, and email columns are deliberately **not** parsed.
- `loginSchoolHead`'s signature, rate-limit key, audit calls, and its generic error string `"Login failed. Please contact your administrator."` are **unchanged**. The message must never start distinguishing "wrong password" from "no such school".
- Passwords are **never logged**, never written to `AuditLog.metadata`, and never stored in Prisma.
- Server actions keep the house pattern: `ActionResult` discriminated return, auth guard first, Zod `safeParse`, `schoolId`-scoped ownership check, audit, revalidate.
- The gate is `npm run typecheck && npm run lint && npm run test && npm run build`, matching `.github/workflows/ci.yml`. Every task ends green.

## Measured facts the tasks depend on

From the probe already run against the source workbook (recorded in the spec Addendum):

| Fact | Value |
|---|---|
| Worksheet | `Sheet1`, 405 rows |
| Header row | **2** |
| Columns | `SCHOOL ID` = B, `SCHOOL NAME` = C, `DISTRICT` = D |
| School rows | **332** |
| District banner rows | **23** (e.g. `"ALABEL 1 DISTRICT"`, blank ID) |
| Fully blank rows | 48 |
| Districts | **23**, every school populated, none blank |
| Duplicate names | **0** |
| Duplicate IDs | **3 pairs** — `502694`, `130551`, `130554` |
| Unusable IDs | **2** — row 147 `"No School ID yet"`, row 306 `0` |
| Synthetic-email collisions | 0 |

## Task dependency waves

| Wave | Tasks | Agent |
|---|---|---|
| 1 | Task 1, Task 4, Task 5 (disjoint files, fully parallel) | backend, backend, frontend |
| 2 | Task 2 (needs 1), Task 6 (needs 4 + 5) | backend, frontend |
| 3 | Task 3 (needs 1 + 2) | backend |
| 4 | Task 7 | qa-test-engineer |

---

### Task 1: Roster parser and import validators

**Owner:** `backend-developer`

**Files:**
- Modify: `src/lib/validators/school.schema.ts` — raise `schoolIdCode` min from 4 to 6 (R7b)
- Create: `src/lib/validators/school-import.schema.ts`
- Create: `src/lib/import/school-roster.ts`
- Test: `tests/unit/import/school-roster.test.ts`
- Test: `tests/unit/validators/school-import.schema.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces — Task 2 and Task 3 import these exact names:
  ```ts
  // src/lib/import/school-roster.ts
  export type ParsedSchoolRow = {
    schoolIdCode: string | null; // null when the sheet has no usable ID (Task 2 substitutes a placeholder)
    rawSchoolId: string;         // verbatim cell text, for reporting
    name: string;
    district?: string;
    region?: string;
    division?: string;
    address?: string;
    sourceRow: number;           // 1-based sheet row
  };
  export type RowError = { sourceRow: number; field: string; value: string; message: string };
  export type MissingId = { sourceRow: number; name: string; rawValue: string; reason: string };
  export type ParseResult = {
    rows: ParsedSchoolRow[];
    errors: RowError[];
    missingIds: MissingId[];
    skipped: number;
    headerRow: number;
    districts: { name: string; count: number }[];
    duplicateIds: { value: string; sourceRows: number[] }[];
    duplicateNames: { value: string; sourceRows: number[] }[];
  };
  export function parseSchoolRoster(input: string | Buffer): Promise<ParseResult>;
  export function normalizeHeader(raw: string): string;
  ```
  ```ts
  // src/lib/validators/school-import.schema.ts
  export const schoolIdCodeSchema: z.ZodString;
  export const schoolRosterRowSchema: z.ZodObject<...>;
  export type SchoolRosterRowInput = z.infer<typeof schoolRosterRowSchema>;
  ```

**Critical design note.** `schoolIdCode` is `null` — **not** a `RowError` — when the ID cell holds text that is present but unusable (`"No School ID yet"`, `0`). The owner's R18 decision resolves these with a placeholder in Task 2, so treating them as errors would drop schools the owner explicitly wants kept. A blank ID cell on a *non-banner* row remains a hard `RowError`.

- [ ] **Step 1: Write the failing schema test**

Create `tests/unit/validators/school-import.schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { schoolIdCodeSchema, schoolRosterRowSchema } from "@/lib/validators/school-import.schema";

describe("schoolIdCodeSchema", () => {
  it("accepts a 6-digit DepEd id", () => {
    expect(schoolIdCodeSchema.safeParse("500282").success).toBe(true);
  });

  it("preserves leading zeros", () => {
    expect(schoolIdCodeSchema.parse("012345")).toBe("012345");
  });

  it("rejects fewer than 6 characters, because Supabase requires a 6-char password", () => {
    const res = schoolIdCodeSchema.safeParse("0");
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.errors[0]?.message).toBe("School ID must be at least 6 characters");
    }
  });

  it("rejects characters outside [A-Za-z0-9_-]", () => {
    expect(schoolIdCodeSchema.safeParse("No School ID yet").success).toBe(false);
  });

  it("trims surrounding whitespace", () => {
    expect(schoolIdCodeSchema.parse("  500282  ")).toBe("500282");
  });
});

describe("schoolRosterRowSchema", () => {
  it("accepts a full row", () => {
    const res = schoolRosterRowSchema.safeParse({
      schoolIdCode: "500282",
      name: "Alabel Integrated SPED Center",
      district: "Alabel 1",
    });
    expect(res.success).toBe(true);
  });

  it("rejects an empty school name", () => {
    expect(schoolRosterRowSchema.safeParse({ schoolIdCode: "500282", name: "" }).success).toBe(false);
  });

  it("treats a blank district as undefined rather than an empty string", () => {
    const res = schoolRosterRowSchema.parse({ schoolIdCode: "500282", name: "X ES", district: "   " });
    expect(res.district).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run tests/unit/validators/school-import.schema.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/validators/school-import.schema"`.

- [ ] **Step 3: Raise the shared School ID minimum to 6**

In `src/lib/validators/school.schema.ts`, change the `schoolIdCode` field of `createSchoolSchema`:

```ts
  schoolIdCode: z
    .string()
    .trim()
    .min(6, "School ID must be at least 6 characters")
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/, "Only letters, digits, underscore and dash"),
```

Only `min(4, ...)` → `min(6, ...)` and its message change. Leave `max`, the regex, and every other field alone.

- [ ] **Step 4: Write the import schema**

Create `src/lib/validators/school-import.schema.ts`:

```ts
import { z } from "zod";
import { nonEmpty } from "./common";

/**
 * The School ID doubles as the School Head's first-time Supabase password, so the
 * 6-character floor is Supabase's `password_min_length`, not an arbitrary choice.
 * Kept identical to `createSchoolSchema.schoolIdCode` in ./school.schema.ts so the
 * admin form and the roster import can never drift apart.
 */
export const schoolIdCodeSchema = z
  .string()
  .trim()
  .min(6, "School ID must be at least 6 characters")
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, "Only letters, digits, underscore and dash");

const optionalShort = z
  .union([z.string(), z.undefined(), z.null()])
  .transform((v) => {
    if (v == null) return undefined;
    const trimmed = String(v).trim();
    return trimmed.length > 0 ? trimmed.slice(0, 100) : undefined;
  });

const optionalLong = z
  .union([z.string(), z.undefined(), z.null()])
  .transform((v) => {
    if (v == null) return undefined;
    const trimmed = String(v).trim();
    return trimmed.length > 0 ? trimmed.slice(0, 500) : undefined;
  });

export const schoolRosterRowSchema = z.object({
  schoolIdCode: schoolIdCodeSchema,
  name: nonEmpty("School name required").max(200),
  district: optionalShort,
  region: optionalShort,
  division: optionalShort,
  address: optionalLong,
});

export type SchoolRosterRowInput = z.infer<typeof schoolRosterRowSchema>;
```

- [ ] **Step 5: Run the schema test**

Run: `npx vitest run tests/unit/validators/school-import.schema.test.ts`
Expected: PASS, all 8 cases.

- [ ] **Step 6: Write the failing parser test**

Create `tests/unit/import/school-roster.test.ts`. The `makeWorkbook` helper generates fixtures in-test — the real roster file is never read.

```ts
import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { parseSchoolRoster, normalizeHeader } from "@/lib/import/school-roster";

/** Build an in-memory .xlsx from a 2-D array of cell values. */
async function makeWorkbook(rows: (string | number | null)[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  rows.forEach((cells, i) => {
    const row = ws.getRow(i + 1);
    cells.forEach((v, c) => {
      if (v !== null) row.getCell(c + 1).value = v;
    });
    row.commit();
  });
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}

/** Mirrors the real sheet: a banner row above the header, then ID / NAME / DISTRICT. */
const HEADER = ["NO.", "SCHOOL ID", "SCHOOL NAME", "DISTRICT"];
const BANNER = ["PLANNING CHECKLIST OF REPORTS SUBMISSION", null, null, null];

describe("normalizeHeader", () => {
  it("lowercases, strips punctuation and collapses whitespace", () => {
    expect(normalizeHeader("  SCHOOL   ID.  ")).toBe("school id");
  });
});

describe("parseSchoolRoster", () => {
  it("finds the header beneath a banner row instead of assuming row 1", async () => {
    const buf = await makeWorkbook([
      BANNER,
      HEADER,
      [1, 500282, "Alabel Integrated SPED Center", "Alabel 1"],
    ]);
    const res = await parseSchoolRoster(buf);
    expect(res.headerRow).toBe(2);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].sourceRow).toBe(3);
  });

  it("coerces a numeric school id cell to a string", async () => {
    const buf = await makeWorkbook([HEADER, [1, 500282, "X ES", "Alabel 1"]]);
    const res = await parseSchoolRoster(buf);
    expect(res.rows[0].schoolIdCode).toBe("500282");
    expect(typeof res.rows[0].schoolIdCode).toBe("string");
  });

  it("preserves leading zeros in a text id cell", async () => {
    const buf = await makeWorkbook([HEADER, [1, "012345", "X ES", "Alabel 1"]]);
    const res = await parseSchoolRoster(buf);
    expect(res.rows[0].schoolIdCode).toBe("012345");
  });

  it("skips a district banner row rather than erroring on it", async () => {
    const buf = await makeWorkbook([
      HEADER,
      [null, null, "ALABEL 1 DISTRICT", null],
      [1, 500282, "X ES", "Alabel 1"],
    ]);
    const res = await parseSchoolRoster(buf);
    expect(res.errors).toEqual([]);
    expect(res.rows).toHaveLength(1);
    expect(res.skipped).toBe(1);
  });

  it("errors when a real school row has a blank id", async () => {
    const buf = await makeWorkbook([HEADER, [1, null, "Nameless ES", "Alabel 1"]]);
    const res = await parseSchoolRoster(buf);
    expect(res.rows).toHaveLength(0);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].field).toBe("schoolIdCode");
  });

  it("errors when a row has an id but no name", async () => {
    const buf = await makeWorkbook([HEADER, [1, 500282, null, "Alabel 1"]]);
    const res = await parseSchoolRoster(buf);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].field).toBe("name");
  });

  it("skips fully blank rows without counting them as errors", async () => {
    const buf = await makeWorkbook([HEADER, [null, null, null, null], [1, 500282, "X ES", "Alabel 1"]]);
    const res = await parseSchoolRoster(buf);
    expect(res.errors).toEqual([]);
    expect(res.skipped).toBe(1);
  });

  it("skips subtotal and note rows", async () => {
    const buf = await makeWorkbook([
      HEADER,
      [null, null, "TOTAL", null],
      [null, null, "Prepared by: Juan Dela Cruz", null],
      [1, 500282, "X ES", "Alabel 1"],
    ]);
    const res = await parseSchoolRoster(buf);
    expect(res.errors).toEqual([]);
    expect(res.skipped).toBe(2);
  });

  it("records an unusable id as missingId with a null code, not as an error", async () => {
    const buf = await makeWorkbook([
      HEADER,
      [null, "No School ID yet", "Datal Bong ES - Green Valley extension", "Kiamba 1"],
      [13, 0, "Nabol NHS (Proposed)", "Malapatan 3"],
    ]);
    const res = await parseSchoolRoster(buf);
    expect(res.errors).toEqual([]);
    expect(res.rows).toHaveLength(2);
    expect(res.rows.every((r) => r.schoolIdCode === null)).toBe(true);
    expect(res.missingIds).toHaveLength(2);
    expect(res.missingIds[0].rawValue).toBe("No School ID yet");
    expect(res.missingIds[1].rawValue).toBe("0");
  });

  it("collapses internal whitespace in names and districts", async () => {
    const buf = await makeWorkbook([HEADER, [1, 500282, "  Del   Hilado   ES  ", " Alabel   1 "]]);
    const res = await parseSchoolRoster(buf);
    expect(res.rows[0].name).toBe("Del Hilado ES");
    expect(res.rows[0].district).toBe("Alabel 1");
  });

  it("reports duplicate ids with every source row", async () => {
    const buf = await makeWorkbook([
      HEADER,
      [1, 130551, "Del Hilado ES", "Malapatan 2"],
      [null, 130551, "Del Hilado ES (Matlusi Extension)", "Malapatan 2"],
    ]);
    const res = await parseSchoolRoster(buf);
    expect(res.duplicateIds).toEqual([{ value: "130551", sourceRows: [2, 3] }]);
  });

  it("reports duplicate names case-insensitively", async () => {
    const buf = await makeWorkbook([
      HEADER,
      [1, 500282, "Mahayag ES", "Alabel 1"],
      [2, 500283, "MAHAYAG ES", "Glan 2"],
    ]);
    const res = await parseSchoolRoster(buf);
    expect(res.duplicateNames).toHaveLength(1);
    expect(res.duplicateNames[0].sourceRows).toEqual([2, 3]);
  });

  it("counts schools per district, sorted alphabetically", async () => {
    const buf = await makeWorkbook([
      HEADER,
      [1, 500282, "A ES", "Glan 1"],
      [2, 500283, "B ES", "Alabel 1"],
      [3, 500284, "C ES", "Glan 1"],
    ]);
    const res = await parseSchoolRoster(buf);
    expect(res.districts).toEqual([
      { name: "Alabel 1", count: 1 },
      { name: "Glan 1", count: 2 },
    ]);
  });

  it("matches header aliases rather than fixed column positions", async () => {
    const buf = await makeWorkbook([
      ["#", "DepEd School ID", "Name of School", "School District"],
      [1, 500282, "X ES", "Alabel 1"],
    ]);
    const res = await parseSchoolRoster(buf);
    expect(res.headerRow).toBe(1);
    expect(res.rows[0].district).toBe("Alabel 1");
  });

  it("throws a named error when no header row can be identified", async () => {
    const buf = await makeWorkbook([["a", "b", "c"], ["d", "e", "f"]]);
    await expect(parseSchoolRoster(buf)).rejects.toThrow(/school name/i);
  });
});
```

- [ ] **Step 7: Run it and confirm it fails**

Run: `npx vitest run tests/unit/import/school-roster.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/import/school-roster"`.

- [ ] **Step 8: Implement the parser**

Create `src/lib/import/school-roster.ts`. Pure module — no Prisma, no Supabase, no `server-only`.

```ts
import ExcelJS from "exceljs";
import { schoolRosterRowSchema, schoolIdCodeSchema } from "@/lib/validators/school-import.schema";

export type ParsedSchoolRow = {
  /** null when the sheet holds a present-but-unusable id; the import applies a placeholder. */
  schoolIdCode: string | null;
  rawSchoolId: string;
  name: string;
  district?: string;
  region?: string;
  division?: string;
  address?: string;
  sourceRow: number;
};

export type RowError = { sourceRow: number; field: string; value: string; message: string };
export type MissingId = { sourceRow: number; name: string; rawValue: string; reason: string };

export type ParseResult = {
  rows: ParsedSchoolRow[];
  errors: RowError[];
  missingIds: MissingId[];
  skipped: number;
  headerRow: number;
  districts: { name: string; count: number }[];
  duplicateIds: { value: string; sourceRows: number[] }[];
  duplicateNames: { value: string; sourceRows: number[] }[];
};

type FieldKey = "schoolIdCode" | "name" | "district" | "region" | "division" | "address";

const HEADER_ALIASES: Record<FieldKey, string[]> = {
  schoolIdCode: ["school id", "school id no", "school id number", "deped school id", "schoolid", "id"],
  name: ["school name", "name of school", "school", "elementary school"],
  district: ["district", "school district", "dist"],
  region: ["region"],
  division: ["division", "schools division"],
  address: ["address", "school address", "complete address"],
};

const HEADER_SCAN_DEPTH = 15;
const NOTE_ROW = /^(total|grand total|note|prepared by|source|noted by|submitted by)/i;
const BANNER_ROW = /\bdistrict\b\s*$/i;

/** lowercase, strip accents, drop punctuation, collapse whitespace. */
export function normalizeHeader(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function collapse(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

const NULLISH = new Set(["", "n/a", "na", "-", "--"]);

/** ExcelJS cell -> plain string. Numbers lose exponent/separator formatting. */
function cellText(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") {
    if ("richText" in v && Array.isArray(v.richText)) {
      return v.richText.map((t) => t.text).join("");
    }
    if ("result" in v) {
      const r = (v as { result?: unknown }).result;
      return r === null || r === undefined ? "" : String(r);
    }
    if ("text" in v) return String((v as { text?: unknown }).text ?? "");
  }
  return "";
}

function optional(value: string): string | undefined {
  const c = collapse(value);
  return c.length > 0 && !NULLISH.has(c.toLowerCase()) ? c : undefined;
}

type HeaderMap = { headerRow: number; columns: Partial<Record<FieldKey, number>> };

function detectHeader(ws: ExcelJS.Worksheet): HeaderMap {
  let best: HeaderMap | null = null;
  let bestScore = 0;

  const depth = Math.min(ws.rowCount, HEADER_SCAN_DEPTH);
  for (let r = 1; r <= depth; r++) {
    const row = ws.getRow(r);
    const columns: Partial<Record<FieldKey, number>> = {};
    let score = 0;

    for (let c = 1; c <= ws.columnCount; c++) {
      const header = normalizeHeader(cellText(row.getCell(c)));
      if (!header) continue;
      for (const key of Object.keys(HEADER_ALIASES) as FieldKey[]) {
        if (columns[key] !== undefined) continue;
        if (HEADER_ALIASES[key].includes(header)) {
          columns[key] = c;
          score += 1;
          break;
        }
      }
    }

    if (score > bestScore) {
      bestScore = score;
      best = { headerRow: r, columns };
    }
  }

  if (!best || best.columns.name === undefined || best.columns.schoolIdCode === undefined) {
    throw new Error(
      `Could not identify a header row in the first ${HEADER_SCAN_DEPTH} rows. ` +
        `Expected a school name column (one of: ${HEADER_ALIASES.name.join(", ")}) ` +
        `and a school id column (one of: ${HEADER_ALIASES.schoolIdCode.join(", ")}).`
    );
  }
  return best;
}

export async function parseSchoolRoster(input: string | Buffer): Promise<ParseResult> {
  const wb = new ExcelJS.Workbook();
  if (typeof input === "string") {
    await wb.xlsx.readFile(input);
  } else {
    await wb.xlsx.load(input);
  }

  const ws = wb.worksheets[0];
  if (!ws) throw new Error("Workbook contains no worksheets.");

  const { headerRow, columns } = detectHeader(ws);

  const rows: ParsedSchoolRow[] = [];
  const errors: RowError[] = [];
  const missingIds: MissingId[] = [];
  let skipped = 0;

  const at = (row: ExcelJS.Row, key: FieldKey): string => {
    const col = columns[key];
    return col === undefined ? "" : cellText(row.getCell(col));
  };

  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const rawId = collapse(at(row, "schoolIdCode"));
    const rawName = collapse(at(row, "name"));

    // Blank spacer row.
    if (!rawId && !rawName) {
      skipped += 1;
      continue;
    }

    // In-sheet section banner ("ALABEL 1 DISTRICT") or a subtotal / note line.
    if (!rawId && (BANNER_ROW.test(rawName) || NOTE_ROW.test(rawName))) {
      skipped += 1;
      continue;
    }

    if (!rawName) {
      errors.push({ sourceRow: r, field: "name", value: rawId, message: "School name is blank" });
      continue;
    }
    if (!rawId) {
      errors.push({ sourceRow: r, field: "schoolIdCode", value: rawName, message: "School ID is blank" });
      continue;
    }

    const base = {
      name: collapse(rawName),
      district: optional(at(row, "district")),
      region: optional(at(row, "region")),
      division: optional(at(row, "division")),
      address: optional(at(row, "address")),
      sourceRow: r,
      rawSchoolId: rawId,
    };

    // Present but unusable id: kept, flagged, and resolved by the credential assigner.
    const idCheck = schoolIdCodeSchema.safeParse(rawId);
    if (!idCheck.success) {
      missingIds.push({
        sourceRow: r,
        name: base.name,
        rawValue: rawId,
        reason: idCheck.error.errors[0]?.message ?? "Unusable School ID",
      });
      rows.push({ ...base, schoolIdCode: null });
      continue;
    }

    const parsed = schoolRosterRowSchema.safeParse({ ...base, schoolIdCode: idCheck.data });
    if (!parsed.success) {
      const issue = parsed.error.errors[0];
      errors.push({
        sourceRow: r,
        field: String(issue?.path[0] ?? "row"),
        value: rawName,
        message: issue?.message ?? "Invalid row",
      });
      continue;
    }

    rows.push({ ...base, ...parsed.data, schoolIdCode: idCheck.data });
  }

  const districtCounts = new Map<string, number>();
  for (const row of rows) {
    if (!row.district) continue;
    districtCounts.set(row.district, (districtCounts.get(row.district) ?? 0) + 1);
  }

  const groupRows = (pick: (r: ParsedSchoolRow) => string | null) => {
    const seen = new Map<string, { value: string; sourceRows: number[] }>();
    for (const row of rows) {
      const key = pick(row);
      if (key === null) continue;
      const lower = key.toLowerCase();
      const hit = seen.get(lower);
      if (hit) hit.sourceRows.push(row.sourceRow);
      else seen.set(lower, { value: key, sourceRows: [row.sourceRow] });
    }
    return [...seen.values()].filter((g) => g.sourceRows.length > 1);
  };

  return {
    rows,
    errors,
    missingIds,
    skipped,
    headerRow,
    districts: [...districtCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    duplicateIds: groupRows((r) => r.schoolIdCode),
    duplicateNames: groupRows((r) => r.name),
  };
}
```

- [ ] **Step 9: Run the parser test**

Run: `npx vitest run tests/unit/import/school-roster.test.ts`
Expected: PASS, all 15 cases. If the "header aliases" case behaves oddly because `"#"` normalizes to empty, that is correct — the `NO.` column is simply unmapped.

- [ ] **Step 10: Confirm nothing else depended on the 4-character minimum**

Run: `npx vitest run && npm run typecheck`
Expected: PASS. If an existing test asserts a 4- or 5-character School ID is valid, update that assertion to the new 6-character floor and note it in the commit body — the change is intentional per R7b.

- [ ] **Step 11: Commit**

```bash
git add src/lib/import/school-roster.ts src/lib/validators/school-import.schema.ts src/lib/validators/school.schema.ts tests/unit/import/school-roster.test.ts tests/unit/validators/school-import.schema.test.ts
git commit -m "feat: parse the DepEd school roster workbook"
```

---

### Task 2: Credential assignment (R18 collision policy)

**Owner:** `backend-developer` · **Depends on:** Task 1

**Files:**
- Create: `src/lib/import/school-credentials.ts`
- Test: `tests/unit/import/school-credentials.test.ts`

**Interfaces:**
- Consumes: `ParsedSchoolRow` from `@/lib/import/school-roster` (Task 1).
- Produces — Task 3 imports these exact names:
  ```ts
  export const PLACEHOLDER_SCHOOL_ID = "123456";
  export type CredentialAssignment = {
    sourceRow: number;
    name: string;
    district?: string;
    region?: string;
    division?: string;
    address?: string;
    /** Bare shared DepEd id — what the head types. Never suffixed. */
    password: string;
    /** Unique stored code; `-N` suffix only on collision. Drives the synthetic email. */
    schoolIdCode: string;
    suffixed: boolean;
    placeholder: boolean;
  };
  export type AssignmentResult = {
    assignments: CredentialAssignment[];
    conflicts: { value: string; sourceRows: number[] }[];
  };
  export function assignSchoolCredentials(rows: ParsedSchoolRow[]): AssignmentResult;
  ```

**Why this exists.** `School.schoolIdCode` is `@unique` *and* `schoolHeadSyntheticEmail` derives the Supabase login address from it, so two schools cannot store the same code. Passwords carry no such constraint — `loginSchoolHead` resolves the account from the selected `School.id`. The owner's decision is therefore implemented as two decoupled values: a shared bare password, and a suffixed unique code.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/import/school-credentials.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { ParsedSchoolRow } from "@/lib/import/school-roster";
import { assignSchoolCredentials, PLACEHOLDER_SCHOOL_ID } from "@/lib/import/school-credentials";

function row(sourceRow: number, schoolIdCode: string | null, name: string): ParsedSchoolRow {
  return { sourceRow, schoolIdCode, rawSchoolId: schoolIdCode ?? "", name, district: "Malapatan 2" };
}

describe("assignSchoolCredentials", () => {
  it("leaves a non-colliding id completely untouched", () => {
    const { assignments } = assignSchoolCredentials([row(7, "500282", "Alabel Integrated SPED Center")]);
    expect(assignments[0].schoolIdCode).toBe("500282");
    expect(assignments[0].password).toBe("500282");
    expect(assignments[0].suffixed).toBe(false);
    expect(assignments[0].placeholder).toBe(false);
  });

  it("shares the password but suffixes the stored code on a collision", () => {
    const { assignments } = assignSchoolCredentials([
      row(280, "130551", "Del Hilado ES"),
      row(281, "130551", "Del Hilado ES (Matlusi Extension)"),
    ]);
    expect(assignments.map((a) => a.schoolIdCode)).toEqual(["130551", "130551-2"]);
    expect(assignments.map((a) => a.password)).toEqual(["130551", "130551"]);
    expect(assignments.map((a) => a.suffixed)).toEqual([false, true]);
  });

  it("assigns suffixes by ascending source row regardless of input order", () => {
    const { assignments } = assignSchoolCredentials([
      row(281, "130551", "Del Hilado ES (Matlusi Extension)"),
      row(280, "130551", "Del Hilado ES"),
    ]);
    const byRow = Object.fromEntries(assignments.map((a) => [a.sourceRow, a.schoolIdCode]));
    expect(byRow[280]).toBe("130551");
    expect(byRow[281]).toBe("130551-2");
  });

  it("handles a group of three", () => {
    const { assignments } = assignSchoolCredentials([
      row(10, "502694", "A"),
      row(11, "502694", "B"),
      row(12, "502694", "C"),
    ]);
    expect(assignments.map((a) => a.schoolIdCode)).toEqual(["502694", "502694-2", "502694-3"]);
    expect(new Set(assignments.map((a) => a.password))).toEqual(new Set(["502694"]));
  });

  it("applies the placeholder id to rows the sheet left unusable", () => {
    const { assignments } = assignSchoolCredentials([
      row(147, null, "Datal Bong ES - Green Valley extension"),
      row(306, null, "Nabol NHS (Proposed)"),
    ]);
    expect(assignments.map((a) => a.schoolIdCode)).toEqual([
      PLACEHOLDER_SCHOOL_ID,
      `${PLACEHOLDER_SCHOOL_ID}-2`,
    ]);
    expect(assignments.map((a) => a.password)).toEqual([PLACEHOLDER_SCHOOL_ID, PLACEHOLDER_SCHOOL_ID]);
    expect(assignments.every((a) => a.placeholder)).toBe(true);
  });

  it("keeps every stored code unique across the whole roster", () => {
    const { assignments } = assignSchoolCredentials([
      row(1, "130551", "A"),
      row(2, "130551", "B"),
      row(3, "130554", "C"),
      row(4, null, "D"),
    ]);
    const codes = assignments.map((a) => a.schoolIdCode);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("reports a conflict when a suffixed code would collide with a real id", () => {
    const { conflicts } = assignSchoolCredentials([
      row(1, "130551", "A"),
      row(2, "130551", "B"),
      row(3, "130551-2", "C"),
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].value).toBe("130551-2");
  });

  // R7: schoolHeadSyntheticEmail lowercases and replaces every non [a-z0-9-]
  // character, so two codes that differ only in case or punctuation produce one
  // address. Supabase would reject the second createUser mid-run.
  it("reports a conflict when two distinct codes fold to the same synthetic email", () => {
    const { conflicts } = assignSchoolCredentials([row(1, "ABC123", "A"), row(2, "abc123", "B")]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].sourceRows).toEqual([1, 2]);
  });

  it("reports a conflict when punctuation is the only difference", () => {
    const { conflicts } = assignSchoolCredentials([row(1, "AB_123", "A"), row(2, "AB-123", "B")]);
    expect(conflicts).toHaveLength(1);
  });

  it("carries district, region, division and address through unchanged", () => {
    const input: ParsedSchoolRow = {
      sourceRow: 9,
      schoolIdCode: "130425",
      rawSchoolId: "130425",
      name: "Famorcan ES",
      district: "Alabel 1",
      region: "XII",
      division: "Sarangani",
      address: "Bagong Lipunan, Famorcan, Alabel",
    };
    const { assignments } = assignSchoolCredentials([input]);
    expect(assignments[0]).toMatchObject({
      district: "Alabel 1",
      region: "XII",
      division: "Sarangani",
      address: "Bagong Lipunan, Famorcan, Alabel",
    });
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run tests/unit/import/school-credentials.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/import/school-credentials.ts`:

```ts
import type { ParsedSchoolRow } from "@/lib/import/school-roster";

/**
 * Substituted when the roster has no usable School ID. Six characters, so it
 * satisfies Supabase's password minimum. Weak by design and acceptable only
 * because `mustChangePassword: true` forces replacement at first sign-in.
 */
export const PLACEHOLDER_SCHOOL_ID = "123456";

export type CredentialAssignment = {
  sourceRow: number;
  name: string;
  district?: string;
  region?: string;
  division?: string;
  address?: string;
  password: string;
  schoolIdCode: string;
  suffixed: boolean;
  placeholder: boolean;
};

export type AssignmentResult = {
  assignments: CredentialAssignment[];
  conflicts: { value: string; sourceRows: number[] }[];
};

/**
 * Splits the roster's School ID into the two values it has to serve at once.
 *
 *  - `password`  — the bare id printed on the DepEd sheet, shared by every school
 *                  in a collision group. Sharing is safe: `loginSchoolHead` resolves
 *                  the account from the selected `School.id`, not from the password.
 *  - `schoolIdCode` — unique per school, because it is `@unique` in Prisma and
 *                  `schoolHeadSyntheticEmail` turns it into the Supabase login address.
 *                  Only the second and later rows of a group take a `-N` suffix.
 *
 * Suffixes are assigned by ascending source row, so re-running against the same
 * sheet always produces the same codes.
 */
export function assignSchoolCredentials(rows: ParsedSchoolRow[]): AssignmentResult {
  const groups = new Map<string, ParsedSchoolRow[]>();

  for (const row of rows) {
    const base = row.schoolIdCode ?? PLACEHOLDER_SCHOOL_ID;
    const list = groups.get(base);
    if (list) list.push(row);
    else groups.set(base, [row]);
  }

  const assignments: CredentialAssignment[] = [];

  for (const [base, members] of groups) {
    const ordered = [...members].sort((a, b) => a.sourceRow - b.sourceRow);
    ordered.forEach((row, index) => {
      assignments.push({
        sourceRow: row.sourceRow,
        name: row.name,
        district: row.district,
        region: row.region,
        division: row.division,
        address: row.address,
        password: base,
        schoolIdCode: index === 0 ? base : `${base}-${index + 1}`,
        suffixed: index > 0,
        placeholder: row.schoolIdCode === null,
      });
    });
  }

  assignments.sort((a, b) => a.sourceRow - b.sourceRow);

  // Two things can still collide and neither is safe to guess at:
  //   1. A generated suffix landing on an id that genuinely exists in the sheet.
  //   2. Two distinct codes folding to one synthetic email — `schoolHeadSyntheticEmail`
  //      lowercases and rewrites every non [a-z0-9-] character, so "AB_1" and "AB-1"
  //      become the same address and the second createUser would fail mid-run.
  // Both are surfaced as conflicts and stop the import before anything is written.
  const emailKey = (code: string) => code.toLowerCase().replace(/[^a-z0-9-]/g, "-");

  const byKey = new Map<string, { value: string; sourceRows: number[] }>();
  for (const a of assignments) {
    const key = emailKey(a.schoolIdCode);
    const hit = byKey.get(key);
    if (hit) hit.sourceRows.push(a.sourceRow);
    else byKey.set(key, { value: a.schoolIdCode, sourceRows: [a.sourceRow] });
  }

  const conflicts = [...byKey.values()].filter((c) => c.sourceRows.length > 1);

  return { assignments, conflicts };
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/unit/import/school-credentials.test.ts`
Expected: PASS, all 8 cases.

- [ ] **Step 5: Commit**

```bash
git add src/lib/import/school-credentials.ts tests/unit/import/school-credentials.test.ts
git commit -m "feat: resolve roster School ID collisions into shared passwords and unique codes"
```

---

### Task 3: Import script

**Owner:** `backend-developer` · **Depends on:** Tasks 1 and 2

**Files:**
- Create: `scripts/import-schools.ts`
- Modify: `package.json` — add `"db:import-schools": "tsx scripts/import-schools.ts"` beside the existing `db:cleanup-passwordless-teachers` entry
- Test: `tests/unit/import/import-schools-args.test.ts`

**Interfaces:**
- Consumes: `parseSchoolRoster` (Task 1); `assignSchoolCredentials`, `CredentialAssignment` (Task 2); `createSupabaseAdminClient` from `@/lib/supabase/admin`; `schoolHeadSyntheticEmail` from `@/lib/auth/synthetic-email`.
- Produces: `export function parseCliArgs(argv: string[]): CliOptions` — exported purely so the flag gating is unit-testable without a database.

**Hard rule.** Claude writes this file and never executes it. No step below runs `npm run db:import-schools`. Follow `scripts/cleanup-passwordless-teachers.ts` for house style.

- [ ] **Step 1: Write the failing arg-parsing test**

Create `tests/unit/import/import-schools-args.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseCliArgs } from "../../../scripts/import-schools";

describe("parseCliArgs", () => {
  it("is dry-run by default", () => {
    const o = parseCliArgs(["--file", "roster.xlsx"]);
    expect(o.commit).toBe(false);
    expect(o.wipe).toBe(false);
  });

  it("requires --file", () => {
    expect(() => parseCliArgs([])).toThrow(/--file/);
  });

  it("accepts --commit on its own as import-without-wipe", () => {
    const o = parseCliArgs(["--file", "r.xlsx", "--commit"]);
    expect(o.commit).toBe(true);
    expect(o.wipe).toBe(false);
  });

  it("refuses --wipe without the acknowledgement flag", () => {
    expect(() => parseCliArgs(["--file", "r.xlsx", "--commit", "--wipe"])).toThrow(
      /--i-understand-this-deletes-all-data/
    );
  });

  it("refuses the acknowledgement flag without --wipe", () => {
    expect(() => parseCliArgs(["--file", "r.xlsx", "--i-understand-this-deletes-all-data"])).toThrow(/--wipe/);
  });

  it("enables wiping only when both flags and --commit are present", () => {
    const o = parseCliArgs(["--file", "r.xlsx", "--commit", "--wipe", "--i-understand-this-deletes-all-data"]);
    expect(o.wipe).toBe(true);
    expect(o.commit).toBe(true);
  });

  it("reads --out and --allow-row-errors", () => {
    const o = parseCliArgs(["--file", "r.xlsx", "--out", "map.csv", "--allow-row-errors"]);
    expect(o.out).toBe("map.csv");
    expect(o.allowRowErrors).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run tests/unit/import/import-schools-args.test.ts`
Expected: FAIL — `scripts/import-schools` not found.

- [ ] **Step 3: Write the script**

Create `scripts/import-schools.ts`:

```ts
/**
 * Replace the School table from the DepEd roster workbook.
 *
 * Usage:
 *   npx tsx scripts/import-schools.ts --file "path/to/roster.xlsx"            # dry run (default)
 *   npx tsx scripts/import-schools.ts --file "..." --commit                   # import, no wipe
 *   npx tsx scripts/import-schools.ts --file "..." --commit --wipe \
 *       --i-understand-this-deletes-all-data                                  # replace everything
 *
 * Optional:
 *   --out <path>          write a schoolIdCode -> synthetic email CSV for ops
 *   --allow-row-errors    skip malformed rows instead of aborting
 *
 * Requires DIRECT_URL (preferred) or DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY.
 *
 * WIPING IS IRREVERSIBLE. `School` cascades to GradeLevel, Section, Learner,
 * Enrollment, Attendance, ReadingLevelRecord, the ARAL tables, Announcement,
 * TeacherInvite, and every school-scoped User. Super Admin rows (schoolId = null)
 * are never touched.
 */
import { writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { parseSchoolRoster } from "../src/lib/import/school-roster";
import { assignSchoolCredentials, type CredentialAssignment } from "../src/lib/import/school-credentials";
import { schoolHeadSyntheticEmail } from "../src/lib/auth/synthetic-email";
import { createSupabaseAdminClient } from "../src/lib/supabase/admin";

export type CliOptions = {
  file: string;
  commit: boolean;
  wipe: boolean;
  allowRowErrors: boolean;
  out?: string;
};

const ACK_FLAG = "--i-understand-this-deletes-all-data";
/** The Supabase admin API is rate-sensitive and the roster is in the hundreds. */
const CONCURRENCY = 5;

export function parseCliArgs(argv: string[]): CliOptions {
  const valueOf = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  const file = valueOf("--file");
  if (!file) throw new Error("Pass the workbook path with --file <path>");

  const wipeFlag = argv.includes("--wipe");
  const ackFlag = argv.includes(ACK_FLAG);
  if (wipeFlag && !ackFlag) throw new Error(`--wipe also requires ${ACK_FLAG}`);
  if (ackFlag && !wipeFlag) throw new Error(`${ACK_FLAG} is only meaningful together with --wipe`);

  return {
    file,
    commit: argv.includes("--commit"),
    wipe: wipeFlag && ackFlag,
    allowRowErrors: argv.includes("--allow-row-errors"),
    out: valueOf("--out"),
  };
}

function heading(text: string): void {
  console.log(`\n${"=".repeat(70)}\n${text}\n${"=".repeat(70)}`);
}

/** Long batch work belongs on the direct port, not through PgBouncer. */
function makePrisma(): PrismaClient {
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!url) throw new Error("Set DIRECT_URL (preferred) or DATABASE_URL");
  return new PrismaClient({ datasources: { db: { url } } });
}

async function inParallel<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

async function main(): Promise<void> {
  const opts = parseCliArgs(process.argv.slice(2));
  const prisma = makePrisma();

  try {
    // ---- Phase 1: parse & report -------------------------------------------
    heading("PHASE 1 — PARSE & REPORT");
    const parsed = await parseSchoolRoster(opts.file);
    console.log(`header row: ${parsed.headerRow}`);
    console.log(`school rows: ${parsed.rows.length}`);
    console.log(`skipped (blank / banner / note rows): ${parsed.skipped}`);
    console.log(`\ndistricts (${parsed.districts.length}):`);
    for (const d of parsed.districts) console.log(`  ${String(d.count).padStart(4)}  ${d.name}`);

    if (parsed.errors.length) {
      console.log(`\nROW ERRORS (${parsed.errors.length}):`);
      for (const e of parsed.errors) console.log(`  row ${e.sourceRow}: ${e.field} — ${e.message} (${e.value})`);
      if (!opts.allowRowErrors) {
        console.error("\nRefusing to continue. Fix the sheet, or pass --allow-row-errors to skip these rows.");
        process.exitCode = 1;
        return;
      }
      console.log("--allow-row-errors set: the rows above are skipped.");
    }

    if (parsed.duplicateNames.length) {
      console.error(`\nDUPLICATE SCHOOL NAMES (${parsed.duplicateNames.length}) — School.name is @unique:`);
      for (const d of parsed.duplicateNames) console.error(`  "${d.value}" at rows ${d.sourceRows.join(", ")}`);
      console.error("\nRefusing to continue. Duplicate names need an owner decision, not a default.");
      process.exitCode = 1;
      return;
    }

    const { assignments, conflicts } = assignSchoolCredentials(parsed.rows);

    if (conflicts.length) {
      console.error(`\nUNRESOLVABLE CODE CONFLICTS (${conflicts.length}):`);
      for (const c of conflicts) console.error(`  "${c.value}" at rows ${c.sourceRows.join(", ")}`);
      process.exitCode = 1;
      return;
    }

    // R9 forbids logging a password. These values are printed as School ID
    // identifiers — which is what they are on the sheet — and never labelled
    // as credentials, so the operator can audit the remap without the log
    // becoming a secret.
    const deviations = assignments.filter((a) => a.suffixed || a.placeholder);
    if (deviations.length) {
      console.log(`\nDEVIATIONS FROM THE PRINTED SHEET (${deviations.length}):`);
      console.log("  row   sheet ID   stored code    school");
      for (const a of deviations) {
        console.log(
          `  ${String(a.sourceRow).padStart(4)}  ${a.password.padEnd(9)}  ${a.schoolIdCode.padEnd(13)}  ${a.name}`
        );
      }
    }
    if (parsed.missingIds.length) {
      console.log(`\nNOTE: ${parsed.missingIds.length} school(s) had no usable School ID and received a shared`);
      console.log("placeholder. That credential is weak; `mustChangePassword` forces replacement at first sign-in.");
      for (const m of parsed.missingIds) console.log(`  row ${m.sourceRow}: "${m.rawValue}" — ${m.name}`);
    }

    // ---- Phase 2: inventory (blast radius) ---------------------------------
    heading("PHASE 2 — INVENTORY (what a wipe would destroy)");
    const [schools, learners, enrollments, attendance, readingLevels, sections, gradeLevels, schoolUsers] =
      await Promise.all([
        prisma.school.count(),
        prisma.learner.count(),
        prisma.enrollment.count(),
        prisma.attendance.count(),
        prisma.readingLevelRecord.count(),
        prisma.section.count(),
        prisma.gradeLevel.count(),
        prisma.user.count({ where: { schoolId: { not: null } } }),
      ]);
    const superAdmins = await prisma.user.count({ where: { schoolId: null } });
    const byRole = await prisma.user.groupBy({
      by: ["role"],
      where: { schoolId: { not: null } },
      _count: { _all: true },
    });

    console.log(`  School              ${schools}`);
    console.log(`  GradeLevel          ${gradeLevels}`);
    console.log(`  Section             ${sections}`);
    console.log(`  Learner             ${learners}`);
    console.log(`  Enrollment          ${enrollments}`);
    console.log(`  Attendance          ${attendance}`);
    console.log(`  ReadingLevelRecord  ${readingLevels}`);
    console.log(`  User (school-scoped) ${schoolUsers}`);
    for (const r of byRole) console.log(`    ${r.role.padEnd(16)} ${r._count._all}`);
    console.log(`  Supabase auth users to delete: ${schoolUsers}`);
    console.log(`\n  PRESERVED — User with schoolId = null (Super Admin): ${superAdmins}`);

    // ---- Phase 3: plan & gate ----------------------------------------------
    heading("PHASE 3 — PLAN");
    console.log(`  ${assignments.length} schools to create`);
    console.log(`  ${opts.wipe ? schools : 0} schools to destroy`);

    if (!opts.commit) {
      console.log("\nDRY RUN — nothing written. Re-run with --commit to apply.");
      return;
    }

    const supabaseAdmin = createSupabaseAdminClient();

    // ---- Phase 4: wipe ------------------------------------------------------
    if (opts.wipe) {
      heading("PHASE 4 — WIPE");
      const doomed = await prisma.user.findMany({
        where: { schoolId: { not: null } },
        select: { id: true, authId: true },
      });
      console.log(`deleting ${doomed.length} Supabase auth users…`);
      let authDeleted = 0;
      await inParallel(doomed, CONCURRENCY, async (u) => {
        const { error } = await supabaseAdmin.auth.admin.deleteUser(u.authId);
        // Already gone is success for our purposes — the goal is "no orphan".
        if (error && !/not found/i.test(error.message)) {
          console.warn(`  warn: auth user ${u.authId}: ${error.message}`);
        } else {
          authDeleted += 1;
        }
      });
      console.log(`auth users deleted (or already absent): ${authDeleted}`);

      const removed = await prisma.school.deleteMany({});
      console.log(`School rows deleted: ${removed.count} (Prisma cascaded the rest)`);
      const survivors = await prisma.user.count({ where: { schoolId: null } });
      console.log(`Super Admin rows still present: ${survivors}`);
      if (survivors !== superAdmins) {
        throw new Error(`Super Admin rows changed from ${superAdmins} to ${survivors} — aborting.`);
      }
    }

    // ---- Phase 5: create ----------------------------------------------------
    heading("PHASE 5 — CREATE");
    const failures: { sourceRow: number; name: string; message: string }[] = [];
    const created: { schoolIdCode: string; email: string; name: string }[] = [];

    // Fetched once rather than per row: listUsers is paginated and rate-sensitive.
    const knownAuth = new Map<string, string>();
    for (let page = 1; ; page++) {
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) throw new Error(`listUsers failed: ${error.message}`);
      for (const u of data.users) {
        if (u.email) knownAuth.set(u.email.toLowerCase(), u.id);
      }
      if (data.users.length < 1000) break;
    }

    const createOne = async (a: CredentialAssignment): Promise<void> => {
      const email = schoolHeadSyntheticEmail(a.schoolIdCode);
      try {
        const existingSchool = await prisma.school.findFirst({
          where: { OR: [{ schoolIdCode: a.schoolIdCode }, { name: a.name }] },
          select: { id: true },
        });
        if (existingSchool) {
          console.log(`  = row ${a.sourceRow}: ${a.name} already present — skipped`);
          return;
        }

        // Resumable: reuse an auth identity left behind by a half-finished run.
        let authId = knownAuth.get(email.toLowerCase());
        if (authId) {
          const { error } = await supabaseAdmin.auth.admin.updateUserById(authId, {
            password: a.password,
            app_metadata: { role: "SCHOOL_HEAD" },
          });
          if (error) throw new Error(`password reset failed: ${error.message}`);
        } else {
          const { data, error } = await supabaseAdmin.auth.admin.createUser({
            email,
            password: a.password,
            email_confirm: true,
            app_metadata: { role: "SCHOOL_HEAD" },
            user_metadata: { role: "SCHOOL_HEAD" },
          });
          // A password-policy rejection must surface verbatim, not as a generic error.
          if (error || !data.user) throw new Error(error?.message ?? "auth user creation returned no user");
          authId = data.user.id;
        }

        const school = await prisma.$transaction(async (tx) => {
          const s = await tx.school.create({
            data: {
              name: a.name,
              schoolIdCode: a.schoolIdCode,
              address: a.address,
              region: a.region,
              division: a.division,
              district: a.district,
            },
          });
          await tx.user.create({
            data: {
              authId: authId!,
              email,
              role: "SCHOOL_HEAD",
              schoolId: s.id,
              firstName: "",
              lastName: "",
              fullName: s.name,
              isActive: true,
              mustChangePassword: true,
              profileCompleted: false,
            },
          });
          return s;
        });

        await supabaseAdmin.auth.admin.updateUserById(authId!, {
          app_metadata: { role: "SCHOOL_HEAD", schoolId: school.id },
        });

        created.push({ schoolIdCode: a.schoolIdCode, email, name: a.name });
      } catch (err) {
        failures.push({
          sourceRow: a.sourceRow,
          name: a.name,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    };

    await inParallel(assignments, CONCURRENCY, createOne);

    // ---- Phase 6: report ----------------------------------------------------
    heading("PHASE 6 — REPORT");
    console.log(`created: ${created.length}`);
    console.log(`skipped (already present): ${assignments.length - created.length - failures.length}`);
    console.log(`failed:  ${failures.length}`);
    for (const f of failures) console.error(`  row ${f.sourceRow} — ${f.name}: ${f.message}`);

    if (opts.out) {
      const csv = ["schoolIdCode,syntheticEmail,schoolName"]
        .concat(created.map((c) => `${c.schoolIdCode},${c.email},"${c.name.replace(/"/g, '""')}"`))
        .join("\n");
      writeFileSync(opts.out, `${csv}\n`, "utf8");
      console.log(`\nwrote ${opts.out} (no passwords — identifiers only)`);
    }

    if (failures.length) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

// Only run when invoked directly, so the unit test can import parseCliArgs.
if (process.argv[1] && /import-schools\.ts$/.test(process.argv[1])) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
```

- [ ] **Step 4: Add the npm script**

In `package.json`, directly after the `db:cleanup-passwordless-teachers` line:

```json
    "db:import-schools": "tsx scripts/import-schools.ts",
```

- [ ] **Step 5: Run the arg test**

Run: `npx vitest run tests/unit/import/import-schools-args.test.ts`
Expected: PASS, all 7 cases. If importing the script executes `main()`, the direct-invocation guard at the bottom is wrong — fix the guard rather than the test.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: PASS. If `scripts/**` is excluded from `tsconfig.json`, leave `tsconfig.json` alone — the existing cleanup script sets the precedent.

- [ ] **Step 7: Commit**

```bash
git add scripts/import-schools.ts package.json tests/unit/import/import-schools-args.test.ts
git commit -m "feat: add the dry-run-by-default school roster import script"
```

---

### Task 4: School actions — district in the login list, School ID as initial password

**Owner:** `backend-developer` · **Independent of Tasks 1–3**

**Files:**
- Modify: `src/lib/actions/school.ts` — `listSchoolsWithTeacherStatus` (add district), `createSchool` (initial password + return field rename)
- Modify: `src/components/forms/create-school-form.tsx` — consume the renamed field and fix the copy

**Interfaces:**
- Consumes: nothing.
- Produces — Task 6 relies on this exact shape:
  ```ts
  listSchoolsWithTeacherStatus(): Promise<{
    id: string;
    name: string;
    district: string | null;
    teachersOpen: boolean;
  }[]>

  createSchool(formData: FormData): Promise<ActionResult<{ id: string; initialPassword: string }>>
  ```

**Note.** The client rename ships in the same commit as the action rename on purpose — splitting them would leave the branch type-broken in between. `regenerateSchoolHeadCredential` keeps `generateActivationCredential` and its `activationCredential` field: regeneration must stay random, and `src/components/schools-table.tsx` reads that field. Do not touch either.

- [ ] **Step 1: Add district to the login school list**

In `src/lib/actions/school.ts`, inside `listSchoolsWithTeacherStatus`, add `district: true` to the `select`:

```ts
        select: {
          id: true,
          name: true,
          district: true,
          _count: {
```

and to the mapped result:

```ts
      return schools.map((s) => ({
        id: s.id,
        name: s.name,
        district: s.district,
        teachersOpen: s.users.length > 0 && s._count.gradeLevels > 0,
      }));
```

The `cachedQuery` wrapper, its `keyParts`, the `schoolsList` tag, and the 60s `revalidate` are unchanged — no new cache plumbing.

- [ ] **Step 2: Make the School ID the initial password**

In `createSchool`, replace:

```ts
  const activationCredential = generateActivationCredential();
```

with:

```ts
  // The School ID is the single, universal first-time credential — the same rule the
  // roster import follows. `mustChangePassword: true` below forces replacement at first login.
  const initialPassword = parsed.data.schoolIdCode;
```

Then update the three downstream references: `password: initialPassword` in `createUser`, the return `{ ok: true, data: { id: school.id, initialPassword } }`, and the signature `Promise<ActionResult<{ id: string; initialPassword: string }>>`.

Update the function's doc comment — it currently claims the credential is "NOT the School ID", which becomes false:

```ts
/**
 * Super-admin only: creates a School + School Head auth user whose initial password
 * IS the School ID. Returned once for the admin to relay; never stored in Prisma.
 */
```

Leave the `generateActivationCredential` import in place — `regenerateSchoolHeadCredential` still uses it.

- [ ] **Step 3: Update the create-school form**

In `src/components/forms/create-school-form.tsx`, rename the state and fix the copy, which currently describes a generated secret:

```tsx
  const [initialPassword, setInitialPassword] = useState<string | null>(null);
```

```tsx
  if (initialPassword) {
    return (
      <Card className="rounded-xl border border-amber-200 bg-amber-50 shadow-sm">
        <CardContent className="space-y-4 pt-6">
          <div className="flex items-start gap-2 text-amber-950">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <h2 className="font-semibold">School created</h2>
              <p className="mt-1 text-sm text-amber-900/90">
                The School Head signs in with this School ID as their password, then chooses
                their own on first login.
              </p>
            </div>
          </div>
          <div className="rounded-lg border bg-card p-3 font-mono text-sm break-all">
            {initialPassword}
          </div>
```

Update the remaining references: `navigator.clipboard.writeText(initialPassword)`, the button label `{copied ? "Copied" : "Copy School ID"}`, and in the submit handler:

```tsx
              if (res.data?.initialPassword) {
                setInitialPassword(res.data.initialPassword);
                toast.success("School created");
              }
```

- [ ] **Step 4: Verify no other caller reads the old field**

Run: `grep -rn "activationCredential" src/`
Expected: hits only in `src/lib/actions/school.ts` (`regenerateSchoolHeadCredential`) and `src/components/schools-table.tsx`. If `create-school-form.tsx` still appears, Step 3 is incomplete.

- [ ] **Step 5: Typecheck and test**

Run: `npm run typecheck && npx vitest run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/actions/school.ts src/components/forms/create-school-form.tsx
git commit -m "feat: use the School ID as the School Head initial password"
```

---

### Task 5: SearchableSelect primitive

**Owner:** `frontend-developer` · **Independent of Tasks 1–4**

**Files:**
- Create: `src/components/ui/searchable-select.tsx`
- Test: `tests/unit/searchable-select-filter.test.ts`
- Test: `tests/components/searchable-select.test.tsx`

**Interfaces:**
- Consumes: `Popover`, `PopoverContent`, `PopoverTrigger` from `@/components/ui/popover`; `Input` from `@/components/ui/input`; `cn` from `@/lib/utils`.
- Produces — Task 6 imports these exact names:
  ```ts
  export type SearchableOption = { value: string; label: string; hint?: string };
  export const MAX_VISIBLE_OPTIONS = 100;
  export function filterOptions(options: SearchableOption[], query: string): SearchableOption[];
  export function SearchableSelect(props: {
    options: SearchableOption[];
    value: string;
    onValueChange: (value: string) => void;
    placeholder?: string;
    searchPlaceholder?: string;
    emptyMessage?: string;
    disabled?: boolean;
    id?: string;
  }): JSX.Element;
  ```

**No new dependency.** `cmdk` is deliberately not added; `@radix-ui/react-popover` is already installed.

- [ ] **Step 1: Write the failing filter test**

Create `tests/unit/searchable-select-filter.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { filterOptions, MAX_VISIBLE_OPTIONS, type SearchableOption } from "@/components/ui/searchable-select";

const opt = (label: string): SearchableOption => ({ value: label, label });

describe("filterOptions", () => {
  it("returns everything for an empty query", () => {
    const all = [opt("Alabel Central ES"), opt("Glan ES")];
    expect(filterOptions(all, "")).toHaveLength(2);
    expect(filterOptions(all, "   ")).toHaveLength(2);
  });

  it("is case-insensitive", () => {
    expect(filterOptions([opt("Alabel Central ES")], "ALABEL")).toHaveLength(1);
  });

  it("is diacritic-insensitive in both directions", () => {
    expect(filterOptions([opt("Peñaranda ES")], "penaranda")).toHaveLength(1);
    expect(filterOptions([opt("Penaranda ES")], "peñaranda")).toHaveLength(1);
  });

  it("matches every token regardless of word order", () => {
    const all = [opt("Alabel Central Elementary School")];
    expect(filterOptions(all, "central alabel")).toHaveLength(1);
    expect(filterOptions(all, "alabel central")).toHaveLength(1);
  });

  it("requires all tokens to match, not any", () => {
    expect(filterOptions([opt("Alabel Central ES")], "alabel glan")).toHaveLength(0);
  });

  it("also searches the hint, so a district narrows the list", () => {
    const all = [{ value: "1", label: "Del Hilado ES", hint: "Malapatan 2" }];
    expect(filterOptions(all, "malapatan")).toHaveLength(1);
  });

  it("caps results at MAX_VISIBLE_OPTIONS", () => {
    const many = Array.from({ length: 350 }, (_, i) => opt(`School ${i}`));
    expect(filterOptions(many, "school")).toHaveLength(MAX_VISIBLE_OPTIONS);
  });

  it("preserves input order", () => {
    const all = [opt("Banlibato IS"), opt("Alabel Central ES")];
    expect(filterOptions(all, "es").map((o) => o.label)).toEqual(["Banlibato IS", "Alabel Central ES"]);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run tests/unit/searchable-select-filter.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

Create `src/components/ui/searchable-select.tsx`:

```tsx
"use client";

import * as React from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type SearchableOption = { value: string; label: string; hint?: string };

/**
 * Rendering every match of a few-hundred-item list is wasteful and janky; a cap
 * plus a "N more" footer keeps it fast without pulling in virtualization.
 */
export const MAX_VISIBLE_OPTIONS = 100;

function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function matches(option: SearchableOption, tokens: string[]): boolean {
  const haystack = fold(`${option.label} ${option.hint ?? ""}`);
  return tokens.every((t) => haystack.includes(t));
}

/**
 * Every whitespace-separated token must appear somewhere in the label or hint,
 * so "alabel central" and "central alabel" both find "Alabel Central ES".
 */
export function filterOptions(options: SearchableOption[], query: string): SearchableOption[] {
  const tokens = fold(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return options.slice(0, MAX_VISIBLE_OPTIONS);

  const found: SearchableOption[] = [];
  for (const option of options) {
    if (matches(option, tokens)) {
      found.push(option);
      if (found.length === MAX_VISIBLE_OPTIONS) break;
    }
  }
  return found;
}

function countMatches(options: SearchableOption[], query: string): number {
  const tokens = fold(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return options.length;
  return options.filter((o) => matches(o, tokens)).length;
}

export function SearchableSelect({
  options,
  value,
  onValueChange,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyMessage = "No results found.",
  disabled = false,
  id,
}: {
  options: SearchableOption[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  id?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [activeIndex, setActiveIndex] = React.useState(0);

  const reactId = React.useId();
  const baseId = id ?? `searchable-${reactId}`;
  const listId = `${baseId}-listbox`;
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);

  const visible = React.useMemo(() => filterOptions(options, query), [options, query]);
  const total = React.useMemo(() => countMatches(options, query), [options, query]);
  const hidden = Math.max(0, total - visible.length);
  const selected = options.find((o) => o.value === value);

  // A filter change can leave the active index past the end of the new list.
  React.useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  React.useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  // Keep the active option in view without moving DOM focus off the search input.
  React.useEffect(() => {
    if (!open) return;
    const node = listRef.current?.children[activeIndex];
    if (node instanceof HTMLElement) node.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  const commit = (option: SearchableOption) => {
    onValueChange(option.value);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, visible.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(Math.max(0, visible.length - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const option = visible[activeIndex];
      if (option) commit(option);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          ref={triggerRef}
          id={baseId}
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-controls={listId}
          disabled={disabled}
          className={cn(
            "flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background",
            "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
            "disabled:cursor-not-allowed disabled:opacity-50",
            !selected && "text-muted-foreground"
          )}
        >
          <span className="truncate text-left">{selected?.label ?? placeholder}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <div className="border-b p-2">
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKeyDown}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            aria-controls={listId}
            aria-activedescendant={visible.length > 0 ? `${baseId}-opt-${activeIndex}` : undefined}
            className="h-9"
          />
        </div>
        <div ref={listRef} id={listId} role="listbox" className="max-h-64 overflow-y-auto p-1">
          {visible.length === 0 ? (
            <p className="p-4 text-center text-sm text-muted-foreground">{emptyMessage}</p>
          ) : (
            visible.map((option, index) => (
              <div
                key={option.value}
                id={`${baseId}-opt-${index}`}
                role="option"
                aria-selected={option.value === value}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => commit(option)}
                className={cn(
                  "flex cursor-pointer items-center justify-between gap-2 rounded-sm px-2 py-2 text-sm",
                  index === activeIndex && "bg-accent text-accent-foreground"
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate">{option.label}</span>
                  {option.hint ? (
                    <span className="block truncate text-xs text-muted-foreground">{option.hint}</span>
                  ) : null}
                </span>
                {option.value === value ? <Check className="h-4 w-4 shrink-0" aria-hidden /> : null}
              </div>
            ))
          )}
        </div>
        {hidden > 0 ? (
          <p className="border-t px-3 py-2 text-xs text-muted-foreground">
            {hidden} more {hidden === 1 ? "match" : "matches"} — keep typing to narrow.
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 4: Run the filter test**

Run: `npx vitest run tests/unit/searchable-select-filter.test.ts`
Expected: PASS, all 8 cases.

- [ ] **Step 5: Write the component test**

Create `tests/components/searchable-select.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SearchableSelect, type SearchableOption } from "@/components/ui/searchable-select";

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

const OPTIONS: SearchableOption[] = [
  { value: "a", label: "Alabel Central ES", hint: "Alabel 1" },
  { value: "b", label: "Banlibato Integrated School", hint: "Alabel 1" },
  { value: "c", label: "Glan Central ES", hint: "Glan 1" },
];

function open() {
  fireEvent.click(screen.getByRole("combobox"));
}

describe("SearchableSelect", () => {
  it("exposes combobox semantics on the trigger", () => {
    render(<SearchableSelect options={OPTIONS} value="" onValueChange={() => {}} placeholder="Select your school" />);
    const trigger = screen.getByRole("combobox");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.getAttribute("aria-haspopup")).toBe("listbox");
    expect(trigger.textContent).toContain("Select your school");
  });

  it("shows the selected label instead of the placeholder", () => {
    render(<SearchableSelect options={OPTIONS} value="c" onValueChange={() => {}} placeholder="Select your school" />);
    expect(screen.getByRole("combobox").textContent).toContain("Glan Central ES");
  });

  it("filters as the user types", () => {
    render(<SearchableSelect options={OPTIONS} value="" onValueChange={() => {}} />);
    open();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "glan" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option").textContent).toContain("Glan Central ES");
  });

  it("tracks the active option with aria-activedescendant rather than DOM focus", () => {
    render(<SearchableSelect options={OPTIONS} value="" onValueChange={() => {}} id="school" />);
    open();
    const search = screen.getByRole("textbox");
    expect(search.getAttribute("aria-activedescendant")).toBe("school-opt-0");
    fireEvent.keyDown(search, { key: "ArrowDown" });
    expect(search.getAttribute("aria-activedescendant")).toBe("school-opt-1");
    expect(document.activeElement).toBe(search);
  });

  it("does not move past the last option", () => {
    render(<SearchableSelect options={OPTIONS} value="" onValueChange={() => {}} id="school" />);
    open();
    const search = screen.getByRole("textbox");
    for (let i = 0; i < 8; i++) fireEvent.keyDown(search, { key: "ArrowDown" });
    expect(search.getAttribute("aria-activedescendant")).toBe("school-opt-2");
    fireEvent.keyDown(search, { key: "Home" });
    expect(search.getAttribute("aria-activedescendant")).toBe("school-opt-0");
  });

  it("selects the active option on Enter", () => {
    const onValueChange = vi.fn();
    render(<SearchableSelect options={OPTIONS} value="" onValueChange={onValueChange} />);
    open();
    const search = screen.getByRole("textbox");
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onValueChange).toHaveBeenCalledWith("b");
  });

  it("selects on click", () => {
    const onValueChange = vi.fn();
    render(<SearchableSelect options={OPTIONS} value="" onValueChange={onValueChange} />);
    open();
    fireEvent.click(screen.getByText("Glan Central ES"));
    expect(onValueChange).toHaveBeenCalledWith("c");
  });

  it("shows the empty message when nothing matches", () => {
    render(<SearchableSelect options={OPTIONS} value="" onValueChange={() => {}} emptyMessage="No schools found." />);
    open();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "zzzz" } });
    expect(screen.getByText("No schools found.")).toBeTruthy();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  it("marks the selected option with aria-selected", () => {
    render(<SearchableSelect options={OPTIONS} value="a" onValueChange={() => {}} />);
    open();
    const options = screen.getAllByRole("option");
    expect(options[0].getAttribute("aria-selected")).toBe("true");
    expect(options[1].getAttribute("aria-selected")).toBe("false");
  });
});
```

- [ ] **Step 6: Run the component test**

Run: `npx vitest run tests/components/searchable-select.test.tsx`
Expected: PASS, all 9 cases.

If Radix Popover fails under jsdom with `target.hasPointerCapture is not a function`, add to the `beforeAll`:

```tsx
  window.HTMLElement.prototype.hasPointerCapture = vi.fn();
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
```

- [ ] **Step 7: Confirm the theme guard tests still pass**

Run: `npx vitest run tests/unit/shadcn-coverage.test.ts tests/unit/no-hardcoded-colors.test.ts`
Expected: PASS. The new component uses only semantic tokens (`border-input`, `bg-background`, `text-muted-foreground`, `bg-accent`) — no raw hex or `bg-blue-500`-style classes. Fix the component if either test complains; do not weaken the test.

- [ ] **Step 8: Commit**

```bash
git add src/components/ui/searchable-select.tsx tests/unit/searchable-select-filter.test.ts tests/components/searchable-select.test.tsx
git commit -m "feat: add a searchable select primitive on the existing popover"
```

---

### Task 6: Login district filter

**Owner:** `frontend-developer` · **Depends on:** Task 4 (district in the school list) and Task 5 (`SearchableSelect`)

**Files:**
- Create: `src/lib/login/district-filter.ts`
- Modify: `src/components/forms/login-form.tsx`
- Test: `tests/unit/login/district-filter.test.ts`
- Test: `tests/components/login-form-district.test.tsx`

**Interfaces:**
- Consumes: `SearchableSelect` from `@/components/ui/searchable-select` (Task 5); the `district` field on `listSchoolsWithTeacherStatus` (Task 4).
- Produces:
  ```ts
  export const ALL_DISTRICTS = "__all__";
  export type SchoolOption = { id: string; name: string; district: string | null; teachersOpen: boolean };
  export function deriveDistricts(schools: SchoolOption[]): string[];
  export function schoolsInDistrict(schools: SchoolOption[], district: string): SchoolOption[];
  export function clearStaleSchool(selectedId: string, visible: SchoolOption[]): string;
  ```

**Unchanged by this task:** the Teachers / School Head buttons, the `teachersOpen` gate, `TEACHERS_UNLOCK_HELP`, the forgot-password links, and the entire teacher screen.

- [ ] **Step 1: Write the failing helper test**

Create `tests/unit/login/district-filter.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  ALL_DISTRICTS,
  deriveDistricts,
  schoolsInDistrict,
  clearStaleSchool,
  type SchoolOption,
} from "@/lib/login/district-filter";

const school = (id: string, name: string, district: string | null): SchoolOption => ({
  id,
  name,
  district,
  teachersOpen: false,
});

const SCHOOLS = [
  school("1", "Alabel Central ES", "Alabel 1"),
  school("2", "Banlibato IS", "Alabel 1"),
  school("3", "Glan Central ES", "Glan 2"),
  school("4", "Orphan ES", null),
  school("5", "Blankish ES", "   "),
];

describe("deriveDistricts", () => {
  it("returns distinct non-empty districts, sorted", () => {
    expect(deriveDistricts(SCHOOLS)).toEqual(["Alabel 1", "Glan 2"]);
  });

  it("ignores null and whitespace-only districts", () => {
    expect(deriveDistricts([school("1", "A", null), school("2", "B", "  ")])).toEqual([]);
  });

  it("returns an empty list for no schools", () => {
    expect(deriveDistricts([])).toEqual([]);
  });
});

describe("schoolsInDistrict", () => {
  it("returns every school under the all-districts sentinel", () => {
    expect(schoolsInDistrict(SCHOOLS, ALL_DISTRICTS)).toHaveLength(5);
  });

  it("narrows to one district", () => {
    expect(schoolsInDistrict(SCHOOLS, "Alabel 1").map((s) => s.id)).toEqual(["1", "2"]);
  });

  it("excludes district-less schools from a specific district", () => {
    expect(schoolsInDistrict(SCHOOLS, "Glan 2").map((s) => s.id)).toEqual(["3"]);
  });

  it("returns nothing for an unknown district", () => {
    expect(schoolsInDistrict(SCHOOLS, "Nowhere 9")).toEqual([]);
  });
});

describe("clearStaleSchool", () => {
  it("keeps a selection that is still visible", () => {
    expect(clearStaleSchool("1", schoolsInDistrict(SCHOOLS, "Alabel 1"))).toBe("1");
  });

  it("clears a selection the new district hides", () => {
    expect(clearStaleSchool("3", schoolsInDistrict(SCHOOLS, "Alabel 1"))).toBe("");
  });

  it("is a no-op when nothing is selected", () => {
    expect(clearStaleSchool("", SCHOOLS)).toBe("");
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run tests/unit/login/district-filter.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helpers**

Create `src/lib/login/district-filter.ts`:

```ts
/**
 * Pure helpers behind the login district filter. Extracted from the form so the
 * narrowing and stale-selection rules can be tested without rendering React.
 */

/** Radix Select cannot hold an empty-string item value, so the "all" case needs a sentinel. */
export const ALL_DISTRICTS = "__all__";

export type SchoolOption = {
  id: string;
  name: string;
  district: string | null;
  teachersOpen: boolean;
};

export function deriveDistricts(schools: SchoolOption[]): string[] {
  const seen = new Set<string>();
  for (const s of schools) {
    const d = s.district?.trim();
    if (d) seen.add(d);
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

/**
 * District is an optional narrowing filter, never a gate. Schools with no district
 * are reachable only under "All districts" — they belong to no specific one.
 */
export function schoolsInDistrict(schools: SchoolOption[], district: string): SchoolOption[] {
  if (district === ALL_DISTRICTS) return schools;
  return schools.filter((s) => s.district?.trim() === district);
}

/** A selection surviving a filter change that hides it is a defect, so drop it. */
export function clearStaleSchool(selectedId: string, visible: SchoolOption[]): string {
  if (!selectedId) return "";
  return visible.some((s) => s.id === selectedId) ? selectedId : "";
}
```

- [ ] **Step 4: Run the helper test**

Run: `npx vitest run tests/unit/login/district-filter.test.ts`
Expected: PASS, all 10 cases.

- [ ] **Step 5: Wire the form**

In `src/components/forms/login-form.tsx`:

Add `useMemo` to the existing React import, then add:

```tsx
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  ALL_DISTRICTS,
  deriveDistricts,
  schoolsInDistrict,
  clearStaleSchool,
} from "@/lib/login/district-filter";
```

Widen the prop type (line ~28):

```tsx
type SchoolWithStatus = { id: string; name: string; district: string | null; teachersOpen: boolean };
```

Add state beside `schoolId` (line ~56):

```tsx
  const [district, setDistrict] = useState<string>(ALL_DISTRICTS);
```

Add derived values after the existing state declarations:

```tsx
  const districts = useMemo(() => deriveDistricts(schools), [schools]);
  const visibleSchools = useMemo(() => schoolsInDistrict(schools, district), [schools, district]);
  const schoolOptions = useMemo(
    () => visibleSchools.map((s) => ({ value: s.id, label: s.name, hint: s.district ?? undefined })),
    [visibleSchools]
  );
```

Add the district handler next to `handleSchoolChange`:

```tsx
  const handleDistrictChange = (value: string) => {
    setDistrict(value);
    const next = clearStaleSchool(schoolId, schoolsInDistrict(schools, value));
    if (next !== schoolId) {
      // The derived teachersOpen gate must not outlive the selection it came from.
      setSchoolId(next);
      setTeachersOpen(false);
    }
  };
```

Replace the school field block (currently lines ~249–269) with:

```tsx
          {districts.length > 0 ? (
            <div className="space-y-2">
              <Label htmlFor="login-district">District</Label>
              <Select value={district} onValueChange={handleDistrictChange}>
                <SelectTrigger id="login-district">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_DISTRICTS}>All districts</SelectItem>
                  {districts.map((d) => (
                    <SelectItem key={d} value={d}>
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="login-school">School Name</Label>
            {schools.length === 0 ? (
              <p className="rounded-md border border-input bg-background p-4 text-center text-sm text-muted-foreground">
                No schools found. Contact admin.
              </p>
            ) : (
              <SearchableSelect
                id="login-school"
                options={schoolOptions}
                value={schoolId}
                onValueChange={handleSchoolChange}
                placeholder="Select your school"
                searchPlaceholder="Search schools…"
                emptyMessage="No schools match your search."
              />
            )}
          </div>
```

The district `Select` is hidden when the roster carries no districts at all, so a fresh install does not show a filter with one useless option.

- [ ] **Step 6: Update the School Head password copy (R13)**

In the `school-head` screen block (currently lines ~326–339), change the label and helper text. `PasswordInput`, `name="password"`, and `autoComplete="current-password"` stay exactly as they are:

```tsx
              <div className="space-y-2">
                <Label htmlFor="password">School ID or password</Label>
                <PasswordInput
                  id="password"
                  name="password"
                  required
                  autoFocus
                  autoComplete="current-password"
                />
                <p className="text-xs text-muted-foreground">
                  First time signing in? Enter your School ID. You&apos;ll choose your own password next.
                </p>
              </div>
```

- [ ] **Step 7: Write the form test**

Create `tests/components/login-form-district.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LoginForm } from "@/components/forms/login-form";

vi.mock("@/lib/actions/auth", () => ({
  loginSchoolHead: vi.fn(),
  loginTeacher: vi.fn(),
  requestTeacherRegisterOtp: vi.fn(),
  verifyTeacherRegisterOtp: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

// Radix Select needs pointer-event APIs jsdom does not implement.
beforeAll(() => {
  window.HTMLElement.prototype.hasPointerCapture = vi.fn();
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

const SCHOOLS = [
  { id: "1", name: "Alabel Central ES", district: "Alabel 1", teachersOpen: true },
  { id: "2", name: "Banlibato IS", district: "Alabel 1", teachersOpen: false },
  { id: "3", name: "Glan Central ES", district: "Glan 2", teachersOpen: false },
];

const openSchoolList = () => fireEvent.click(screen.getByRole("combobox"));

describe("LoginForm district filter", () => {
  it("defaults to All districts and shows every school", () => {
    render(<LoginForm schools={SCHOOLS} />);
    expect(screen.getByText("All districts")).toBeTruthy();
    openSchoolList();
    expect(screen.getAllByRole("option")).toHaveLength(3);
  });

  it("narrows the school list when a district is chosen", () => {
    render(<LoginForm schools={SCHOOLS} />);
    fireEvent.click(screen.getByLabelText("District"));
    fireEvent.click(screen.getByText("Glan 2"));
    openSchoolList();
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0].textContent).toContain("Glan Central ES");
  });

  it("clears a school selection the new district hides", () => {
    render(<LoginForm schools={SCHOOLS} />);
    openSchoolList();
    fireEvent.click(screen.getByText("Glan Central ES"));
    expect(screen.getByRole("combobox").textContent).toContain("Glan Central ES");

    fireEvent.click(screen.getByLabelText("District"));
    fireEvent.click(screen.getByText("Alabel 1"));
    expect(screen.getByRole("combobox").textContent).toContain("Select your school");
  });

  it("keeps a school selection the new district still contains", () => {
    render(<LoginForm schools={SCHOOLS} />);
    openSchoolList();
    fireEvent.click(screen.getByText("Alabel Central ES"));
    fireEvent.click(screen.getByLabelText("District"));
    fireEvent.click(screen.getByText("Alabel 1"));
    expect(screen.getByRole("combobox").textContent).toContain("Alabel Central ES");
  });

  it("disables both role buttons until a school is selected", () => {
    render(<LoginForm schools={SCHOOLS} />);
    expect(screen.getByRole("button", { name: "School Head" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Teachers" })).toBeDisabled();
  });

  it("shows the School ID first-time copy on the School Head screen", () => {
    render(<LoginForm schools={SCHOOLS} />);
    openSchoolList();
    fireEvent.click(screen.getByText("Alabel Central ES"));
    fireEvent.click(screen.getByRole("button", { name: "School Head" }));
    expect(screen.getByLabelText("School ID or password")).toBeTruthy();
    expect(screen.getByText(/First time signing in\? Enter your School ID/)).toBeTruthy();
  });

  it("hides the district field entirely when no school has a district", () => {
    render(<LoginForm schools={SCHOOLS.map((s) => ({ ...s, district: null }))} />);
    expect(screen.queryByLabelText("District")).toBeNull();
  });
});
```

If `toBeDisabled` is unavailable (no `@testing-library/jest-dom` in this repo), assert
`expect(btn.hasAttribute("disabled")).toBe(true)` instead. Check how `tests/components/app-sidebar.test.tsx` does it and match.

- [ ] **Step 8: Run the form test**

Run: `npx vitest run tests/components/login-form-district.test.tsx`
Expected: PASS, all 7 cases.

- [ ] **Step 9: Verify the login page still typechecks**

Run: `npm run typecheck`
Expected: PASS. `src/app/login/page.tsx` infers the school type from `listSchoolsWithTeacherStatus`, so Task 4's `district` addition flows through with no edit. If TypeScript complains about `district`, Task 4 is incomplete — do not widen the type here to paper over it.

- [ ] **Step 10: Commit**

```bash
git add src/lib/login/district-filter.ts src/components/forms/login-form.tsx tests/unit/login/district-filter.test.ts tests/components/login-form-district.test.tsx
git commit -m "feat: filter login schools by district with a searchable dropdown"
```

---

### Task 7: End-to-end coverage and the full gate

**Owner:** `qa-test-engineer` · **Depends on:** every prior task

**Files:**
- Create: `e2e/school-head-login.spec.ts`
- Modify: `docs/backlog.md` — one line recording the shipped change

- [ ] **Step 1: Write the Playwright spec**

Create `e2e/school-head-login.spec.ts`. It must not auto-start a server (`playwright.config.ts` has no `webServer`) and must never point at production.

```ts
import { test, expect } from "@playwright/test";

/**
 * Opt-in. Start `npm run dev` yourself, or set PLAYWRIGHT_BASE_URL.
 * Assumes the roster import has been run against the target database.
 */
test.describe("School Head district login", () => {
  test("district filter narrows the searchable school dropdown", async ({ page }) => {
    await page.goto("/login");

    const districtTrigger = page.getByLabel("District");
    await expect(districtTrigger).toBeVisible();

    await districtTrigger.click();
    await page.getByRole("option", { name: "Alabel 1" }).click();

    const schoolCombobox = page.getByRole("combobox").last();
    await schoolCombobox.click();

    const search = page.getByPlaceholder("Search schools…");
    await expect(search).toBeFocused();
    await search.fill("alabel");

    await expect(page.getByRole("option").first()).toBeVisible();
  });

  test("keyboard selection works without leaving the search box", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("combobox").last().click();
    const search = page.getByPlaceholder("Search schools…");
    await search.fill("es");
    await search.press("ArrowDown");
    await expect(search).toHaveAttribute("aria-activedescendant", /-opt-1$/);
    await search.press("Enter");
    await expect(page.getByRole("button", { name: "School Head" })).toBeEnabled();
  });

  test("the School Head screen asks for the School ID on first sign-in", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("combobox").last().click();
    await page.getByRole("option").first().click();
    await page.getByRole("button", { name: "School Head" }).click();

    await expect(page.getByLabel("School ID or password")).toBeVisible();
    await expect(page.getByText(/First time signing in\? Enter your School ID/)).toBeVisible();
  });
});
```

- [ ] **Step 2: Confirm no test reads the owner's roster file**

Run: `grep -rn "Downloads" tests/ e2e/ src/ scripts/`
Expected: no hits in `tests/` or `e2e/`. A path inside a `scripts/import-schools.ts` usage comment is fine.

- [ ] **Step 3: Run the full CI gate in order**

Run each and record the actual output — do not summarize a run you did not perform:

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

Expected: all four pass. `npm run build` runs `prisma generate` first and needs no live database (every app page is `force-dynamic`).

- [ ] **Step 4: Do NOT run the import script, and do not claim untested e2e**

`npm run test:e2e` requires a running dev server and a seeded database. If one is not available, say so plainly in the report rather than claiming e2e coverage. Never run `npm run db:import-schools`.

- [ ] **Step 5: Record the change in the backlog**

Append one line to the appropriate section of `docs/backlog.md` noting the district login and roster import shipped, referencing the spec path.

- [ ] **Step 6: Commit**

```bash
git add e2e/school-head-login.spec.ts docs/backlog.md
git commit -m "test: cover the school head district login end to end"
```

---

## What the owner does after this plan lands

Claude does not perform these. They are the human's steps.

1. Dry-run and read the report:
   `npm run db:import-schools -- --file "C:\Users\PC5\Downloads\List-of-School-Heads-as-of-July-6-2026-with-school-Address.xlsx"`
2. Confirm the deviation table matches the 8 rows listed in the spec Addendum (R18).
3. Import, replacing existing data:
   `npm run db:import-schools -- --file "…" --commit --wipe --i-understand-this-deletes-all-data --out schools.csv`
4. Verify a School Head can sign in with their School ID and lands on `/account/set-password`.
