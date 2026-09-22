import { describe, expect, it } from "vitest";
import { REPORT_KIND_LABELS } from "@/lib/constants/enum-labels";
import { reportGenerateSchema } from "@/lib/validators/report.schema";

/**
 * `reportGenerateSchema`'s `kind` field is a hand-written Zod literal list,
 * not derived from `REPORT_KIND_LABELS` (see report.schema.ts for why: a
 * `z.enum` built from `Object.keys(REPORT_KIND_LABELS)` widens to `string`
 * because `Object.keys` never returns a literal-typed array, which would
 * widen `ReportGenerateInput["kind"]` off the `ReportKind` union for every
 * caller). That means the two lists can drift silently: a kind added to one
 * and not the other type-checks fine and only fails at runtime with a
 * generic "Invalid input" from the validator. This test is the guard against
 * that drift.
 */
describe("reportGenerateSchema kind list vs REPORT_KIND_LABELS", () => {
  it("accepts exactly the kinds REPORT_KIND_LABELS declares", () => {
    const schemaKinds = new Set(reportGenerateSchema._def.schema.shape.kind.options);
    const labelKinds = new Set(Object.keys(REPORT_KIND_LABELS));

    expect(schemaKinds).toEqual(labelKinds);
  });
});
