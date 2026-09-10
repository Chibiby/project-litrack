import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import {
  DELETE_ORDER,
  EXCLUDED_TABLES,
  OPERATIONAL_DELETE_ORDER,
  SNAPSHOT_MODELS,
  WRITE_ORDER,
} from "@/lib/db/schema-order";

/**
 * These tests exist because the failure they catch is silent. A model added to
 * `schema.prisma` but not to `SNAPSHOT_MODELS` does not break anything at build
 * time — it just quietly stops being in any backup, and nobody finds out until
 * a restore comes back missing a table.
 */

const dmmfModels = Prisma.dmmf.datamodel.models.map((m) => m.name);

describe("snapshot model coverage", () => {
  it("covers every model in the Prisma schema", () => {
    const listed = new Set(SNAPSHOT_MODELS.map((m) => m.model));
    const missing = dmmfModels.filter((name) => !listed.has(name));

    expect(
      missing,
      `Model(s) in schema.prisma but missing from SNAPSHOT_MODELS — they would be silently absent from every backup: ${missing.join(", ")}`
    ).toEqual([]);
  });

  it("lists no model that the schema does not have", () => {
    const known = new Set(dmmfModels);
    expect(SNAPSHOT_MODELS.filter((m) => !known.has(m.model)).map((m) => m.model)).toEqual([]);
  });

  it("names each model exactly once", () => {
    const names = SNAPSHOT_MODELS.map((m) => m.model);
    expect(new Set(names).size).toBe(names.length);
  });

  it("maps each model to a delegate that exists on the Prisma client", () => {
    // Guards against a typo in the delegate key, which would otherwise surface
    // as a crash partway through a restore that has already deleted rows.
    const prismaModule = Prisma.dmmf.datamodel.models;
    for (const { model, delegate } of SNAPSHOT_MODELS) {
      const dm = prismaModule.find((m) => m.name === model);
      expect(dm, `${model} not in DMMF`).toBeDefined();
      const expected = model.charAt(0).toLowerCase() + model.slice(1);
      expect(delegate, `${model} delegate should be "${expected}"`).toBe(expected);
    }
  });

  it("excludes only tables that have no Prisma model", () => {
    // If one of these ever gains a model, it must move into SNAPSHOT_MODELS
    // rather than stay silently excluded from backups.
    const known = new Set(dmmfModels);
    for (const table of EXCLUDED_TABLES) {
      expect(known.has(table), `${table} now has a Prisma model and must be snapshotted`).toBe(
        false
      );
    }
  });
});

describe("write and delete ordering", () => {
  const position = (model: string) => WRITE_ORDER.findIndex((m) => m.model === model);

  it("deletes in exactly the reverse of write order", () => {
    expect(DELETE_ORDER.map((m) => m.model)).toEqual(
      [...WRITE_ORDER].reverse().map((m) => m.model)
    );
  });

  it("writes every model after each model it points at", () => {
    // Derived from the DMMF rather than hand-listed, so a new relation added in
    // schema.prisma is checked automatically.
    const problems: string[] = [];

    for (const dm of Prisma.dmmf.datamodel.models) {
      const self = position(dm.name);
      if (self < 0) continue;

      for (const field of dm.fields) {
        // Only the side that actually holds the foreign key columns constrains
        // insert order; the back-relation side has no `relationFromFields`.
        if (field.kind !== "object") continue;
        if (!field.relationFromFields?.length) continue;
        if (field.relationToFields?.length === 0) continue;

        const target = position(field.type);
        if (target < 0) continue;
        // Self-references are satisfied within a single table's insert.
        if (field.type === dm.name) continue;

        if (target > self) {
          problems.push(
            `${dm.name}.${field.name} → ${field.type}, but ${field.type} is written after ${dm.name}`
          );
        }
      }
    }

    expect(problems, problems.join("\n")).toEqual([]);
  });

  it("puts User before Section, because Section.adviserId points at it", () => {
    // Called out separately because this pair has now pointed BOTH ways, and
    // whichever way it points it is easy to "fix" into a bug.
    //
    // Before Wave A of multi-advisory the key ran User -> Section and this
    // assertion was the other way round. Inverting it created a cycle for as
    // long as both keys existed, so `20260911000001_section_adviser_pointer`
    // dropped the old one and left `advisorySectionId` a plain column. The
    // derived test above is what actually catches a regression here; this one
    // states the intended direction so a reader does not have to infer it.
    expect(position("User")).toBeLessThan(position("Section"));
  });

  it("puts School first and AuditLog last", () => {
    expect(WRITE_ORDER[0].model).toBe("School");
    expect(WRITE_ORDER[WRITE_ORDER.length - 1].model).toBe("AuditLog");
  });
});

describe("operational subset", () => {
  it("keeps the structural tables an admin expects to survive a data clear", () => {
    const operational = new Set(OPERATIONAL_DELETE_ORDER.map((m) => m.model));
    for (const kept of [
      "School",
      "SchoolYear",
      "GradeLevel",
      "Section",
      "User",
      "SchoolHeadProfile",
      "TeacherProfile",
      "TeacherSection",
    ]) {
      expect(operational.has(kept), `${kept} must survive "clear operational data"`).toBe(false);
    }
  });

  it("clears the learner record tables", () => {
    const operational = new Set(OPERATIONAL_DELETE_ORDER.map((m) => m.model));
    for (const cleared of [
      "Learner",
      "Enrollment",
      "AralProfile",
      "Attendance",
      "ReadingLevelRecord",
      "TermGrade",
    ]) {
      expect(operational.has(cleared), `${cleared} must be cleared`).toBe(true);
    }
  });

  it("deletes operational tables children-first", () => {
    const order = OPERATIONAL_DELETE_ORDER.map((m) => m.model);
    // Learner is a parent of every learner record table, so it goes last.
    for (const child of ["Enrollment", "AralProfile", "Attendance", "ReadingLevelRecord", "TermGrade"]) {
      expect(
        order.indexOf(child),
        `${child} must be deleted before Learner`
      ).toBeLessThan(order.indexOf("Learner"));
    }
    // SupportTicket is pointed at by both UnlockGrant and Notification.
    expect(order.indexOf("UnlockGrant")).toBeLessThan(order.indexOf("SupportTicket"));
    expect(order.indexOf("Notification")).toBeLessThan(order.indexOf("SupportTicket"));
  });
});

/**
 * A school-scoped clear filters every table itself rather than relying on
 * cascades, so each operational model needs a route to `schoolId`. A missing or
 * misspelled one is the silent-failure shape again: the wrong route throws at
 * runtime, but a *missing* one would empty that table for every school.
 */
describe("school scoping", () => {
  const SCHOOL_ID = "5c3b1f2e-0d4a-4c6b-9f1e-7a2b3c4d5e6f";

  /**
   * Walk a scope's `where` against the DMMF: every key is a real field, every
   * relation hop lands on a real model, and every leaf is `schoolId` carrying
   * the id it was given.
   */
  function assertScopeResolves(model: string, where: Record<string, unknown>, path: string[] = []) {
    const dm = Prisma.dmmf.datamodel.models.find((m) => m.name === model);
    expect(dm, `${model} is not a Prisma model`).toBeDefined();

    for (const [key, value] of Object.entries(where)) {
      const field = dm!.fields.find((f) => f.name === key);
      const where_ = [...path, `${model}.${key}`].join(" → ");
      expect(field, `${where_} does not exist`).toBeDefined();

      if (field!.kind === "object") {
        assertScopeResolves(field!.type, value as Record<string, unknown>, [...path, `${model}.${key}`]);
      } else {
        expect(key, `${where_} should be the schoolId leaf`).toBe("schoolId");
        expect(value, `${where_} should carry the given id`).toBe(SCHOOL_ID);
      }
    }
  }

  it("gives every operational model a way to reach one school", () => {
    for (const { model, schoolScope } of OPERATIONAL_DELETE_ORDER) {
      expect(schoolScope, `${model} has no schoolScope`).toBeTypeOf("function");
    }
  });

  it("resolves every scope to a real relation path ending at schoolId", () => {
    for (const { model, schoolScope } of OPERATIONAL_DELETE_ORDER) {
      assertScopeResolves(model, schoolScope!(SCHOOL_ID));
    }
  });

  it("leaves the structural models unscoped, because a clear never touches them", () => {
    for (const entry of SNAPSHOT_MODELS.filter((m) => !m.operational)) {
      expect(entry.schoolScope, `${entry.model} is structural and needs no scope`).toBeUndefined();
    }
  });
});
