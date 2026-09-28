import { describe, expect, it } from "vitest";
import { summaryExportSchema } from "@/lib/validators/summary.schema";

/**
 * The compliance Flag filter (`?flag=`) on the export payload: a known flag
 * id (or the no-district-admin list) validates, an unknown one is rejected,
 * and an absent/empty value reads as "all flags".
 */
describe("summaryExportSchema flag", () => {
  it("accepts every known compliance flag id", () => {
    for (const flag of ["NO_ENCODED_DATA", "PENDING", "NOT_UPDATED", "INCOMPLETE", "DISCREPANCIES", "noDistrictAdmin"]) {
      const parsed = summaryExportSchema.safeParse({ facet: "compliance", format: "EXCEL", flag });
      expect(parsed.success).toBe(true);
      if (parsed.success) expect(parsed.data.flag).toBe(flag);
    }
  });

  it("rejects an unknown flag id", () => {
    const parsed = summaryExportSchema.safeParse({ facet: "compliance", format: "EXCEL", flag: "BOGUS" });
    expect(parsed.success).toBe(false);
  });

  it("treats an absent or empty flag as not given", () => {
    const absent = summaryExportSchema.safeParse({ facet: "compliance", format: "EXCEL" });
    expect(absent.success).toBe(true);
    if (absent.success) expect(absent.data.flag).toBeUndefined();

    const empty = summaryExportSchema.safeParse({ facet: "compliance", format: "EXCEL", flag: "" });
    expect(empty.success).toBe(true);
    if (empty.success) expect(empty.data.flag).toBeUndefined();
  });

  it("still requires facet and format regardless of flag", () => {
    const parsed = summaryExportSchema.safeParse({ flag: "NO_ENCODED_DATA" });
    expect(parsed.success).toBe(false);
  });
});
