import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The School Head teachers workspace re-reads what its own actions just wrote.
 * On Cloudflare the default `prisma` client goes through a Hyperdrive config
 * with query caching on, so those reads came back about a minute stale and a
 * saved role, advisory, deactivation or removal looked like it had not
 * happened. Every read behind that workspace must use `prismaFresh`.
 */
const TEACHERS_DIR = "src/app/school-head/(app)/teachers";

function pageFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return pageFiles(path);
    return entry.name === "page.tsx" ? [path] : [];
  });
}

const PLAIN_PRISMA_CALL = /\bprisma\.(?!ts\b)/;

describe("teachers workspace reads skip the Hyperdrive query cache", () => {
  const files = [...pageFiles(TEACHERS_DIR), "src/lib/teachers/roster.ts"];

  it("covers all five tab pages plus the roster helpers", () => {
    expect(files.length).toBe(6);
  });

  it.each(files)("%s queries through prismaFresh only", (file) => {
    const source = readFileSync(file, "utf8");
    if (!source.includes("@/lib/prisma")) return;
    expect(source).not.toMatch(PLAIN_PRISMA_CALL);
    expect(source).toMatch(/\bprismaFresh\./);
  });

  it.each([
    ["src/lib/actions/teacher.ts", ["setTeacherAdvisorySection", "setTeacherAdvisorySetting"]],
    [
      "src/lib/actions/school-head.ts",
      ["approveTeacher", "rejectTeacher", "clearRejectedTeacher", "setTeacherActive", "removeTeacher"],
    ],
  ] as const)("%s teacher actions read through prismaFresh", (file, names) => {
    const source = readFileSync(file, "utf8");
    for (const name of names) {
      const start = source.indexOf(`export async function ${name}(`);
      expect(start, name).toBeGreaterThan(-1);
      const next = source.indexOf("\nexport ", start + 1);
      const body = source.slice(start, next === -1 ? undefined : next);
      expect(body, name).not.toMatch(PLAIN_PRISMA_CALL);
      expect(body, name).toMatch(/\bprismaFresh\./);
    }
  });
});
