import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const page = readFileSync(
  path.resolve(__dirname, "../../../src/app/teacher/(app)/aral/page.tsx"),
  "utf8"
);

/**
 * With no specific `?section=`, the ARAL learners count and the requested page
 * of rows start beside the section/candidate/teacher reads. Each used to wait
 * for the round trip before it, adding two to every load of the page.
 */
describe("teacher ARAL page reads", () => {
  it("starts the count inside the first batch when the section is known", () => {
    const batch = page.slice(page.indexOf("await Promise.all(["));
    const batchBody = batch.slice(0, batch.indexOf("]);"));
    expect(batchBody).toContain("earlyWhere ? prisma.learner.count({ where: earlyWhere }) : null");
  });

  it("starts the requested rows before the batch and hands them to the table", () => {
    expect(page.indexOf("const requestedRows =")).toBeLessThan(page.indexOf("await Promise.all(["));
    expect(page).toContain("requestedRows={requestedRows}");
    expect(page).toMatch(/requestedRows && skip === requestedSkip/);
  });

  it("still counts and pages through one shared where", () => {
    expect(page).toContain("const aralWhere = earlyWhere ?? buildAralWhere(section);");
    expect(page).toContain("where={aralWhere}");
  });
});
