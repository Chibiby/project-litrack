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
    .replace(/[̀-ͯ]/g, "")
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

// exceljs bundles its own local `Buffer extends ArrayBuffer {}` shim (see its index.d.ts) that
// predates TypeScript's ES2024 resizable-ArrayBuffer members. Under this repo's `lib: ["esnext"]`
// a real Node Buffer no longer satisfies that shim structurally, even though it works at runtime.
type ExcelLoadInput = Parameters<InstanceType<typeof ExcelJS.Workbook>["xlsx"]["load"]>[0];

export async function parseSchoolRoster(input: string | Buffer): Promise<ParseResult> {
  const wb = new ExcelJS.Workbook();
  if (typeof input === "string") {
    await wb.xlsx.readFile(input);
  } else {
    await wb.xlsx.load(input as unknown as ExcelLoadInput);
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
