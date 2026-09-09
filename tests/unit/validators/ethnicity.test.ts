import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ethnicityColumns, ethnicityFields, refineEthnicityPair } from "@/lib/validators/ethnicity";

const formSchema = z
  .object(ethnicityFields)
  .superRefine((data, ctx) => refineEthnicityPair(data, ctx));

const importSchema = z
  .object(ethnicityFields)
  .superRefine((data, ctx) => refineEthnicityPair(data, ctx, { variant: "import" }));

/** Every issue path, flattened to a comparable string. */
function paths(result: z.SafeParseReturnType<unknown, unknown>): string[] {
  return result.success ? [] : result.error.issues.map((i) => i.path.join("."));
}

describe("refineEthnicityPair — the first slot", () => {
  it("accepts a profile that answers neither slot", () => {
    // Every learner rostered, and every teacher profiled, before the question
    // existed. Silence stays legal.
    expect(formSchema.safeParse({}).success).toBe(true);
  });

  it("accepts one ethnicity on its own", () => {
    expect(formSchema.safeParse({ ethnicity: "BISAYA" }).success).toBe(true);
  });

  it("requires the free text when the first slot is Others", () => {
    const result = formSchema.safeParse({ ethnicity: "OTHER" });
    expect(result.success).toBe(false);
    expect(paths(result)).toContain("ethnicityOther");
  });

  it("rejects free text when the first slot is not Others", () => {
    const result = formSchema.safeParse({ ethnicity: "BISAYA", ethnicityOther: "Manobo" });
    expect(result.success).toBe(false);
    expect(paths(result)).toContain("ethnicityOther");
  });
});

describe("refineEthnicityPair — the second slot", () => {
  it("accepts two different ethnicities", () => {
    expect(
      formSchema.safeParse({ ethnicity: "BISAYA", secondaryEthnicity: "ILONGGO" }).success
    ).toBe(true);
  });

  it("rejects a second ethnicity with no first", () => {
    // The UI only offers "Add another" once the first is answered, so this can
    // only arrive from a hand-rolled post.
    const result = formSchema.safeParse({ secondaryEthnicity: "ILONGGO" });
    expect(result.success).toBe(false);
    expect(paths(result)).toContain("secondaryEthnicity");
  });

  it("rejects a second ethnicity that repeats the first", () => {
    const result = formSchema.safeParse({ ethnicity: "BISAYA", secondaryEthnicity: "BISAYA" });
    expect(result.success).toBe(false);
    expect(paths(result)).toContain("secondaryEthnicity");
  });

  it("requires the free text when the second slot is Others", () => {
    const result = formSchema.safeParse({ ethnicity: "BISAYA", secondaryEthnicity: "OTHER" });
    expect(result.success).toBe(false);
    expect(paths(result)).toContain("secondaryEthnicityOther");
  });

  it("rejects second free text when the second slot is not Others", () => {
    const result = formSchema.safeParse({
      ethnicity: "BISAYA",
      secondaryEthnicity: "ILONGGO",
      secondaryEthnicityOther: "Manobo",
    });
    expect(result.success).toBe(false);
    expect(paths(result)).toContain("secondaryEthnicityOther");
  });

  it("rejects second free text with no second ethnicity chosen", () => {
    const result = formSchema.safeParse({
      ethnicity: "BISAYA",
      secondaryEthnicityOther: "Manobo",
    });
    expect(result.success).toBe(false);
    expect(paths(result)).toContain("secondaryEthnicityOther");
  });

  it("accepts two Others that name different peoples", () => {
    expect(
      formSchema.safeParse({
        ethnicity: "OTHER",
        ethnicityOther: "Manobo",
        secondaryEthnicity: "OTHER",
        secondaryEthnicityOther: "Subanen",
      }).success
    ).toBe(true);
  });

  it("rejects two Others that name the same people, however typed", () => {
    const result = formSchema.safeParse({
      ethnicity: "OTHER",
      ethnicityOther: "Manobo",
      secondaryEthnicity: "OTHER",
      secondaryEthnicityOther: "  manobo ",
    });
    expect(result.success).toBe(false);
    expect(paths(result)).toContain("secondaryEthnicityOther");
  });
});

describe("refineEthnicityPair — the import variant", () => {
  it("ignores a details column filled in on a row that names no ethnicity", () => {
    // A spreadsheet with a stray note in the details column should not fail the
    // whole row when the ethnicity cell is blank.
    expect(importSchema.safeParse({ ethnicityOther: "Manobo" }).success).toBe(true);
    expect(importSchema.safeParse({ secondaryEthnicityOther: "Subanen" }).success).toBe(true);
  });

  it("still requires details when Others is the answer", () => {
    expect(importSchema.safeParse({ ethnicity: "OTHER" }).success).toBe(false);
    expect(
      importSchema.safeParse({ ethnicity: "BISAYA", secondaryEthnicity: "OTHER" }).success
    ).toBe(false);
  });

  it("still rejects a repeat and a second with no first", () => {
    expect(
      importSchema.safeParse({ ethnicity: "BISAYA", secondaryEthnicity: "BISAYA" }).success
    ).toBe(false);
    expect(importSchema.safeParse({ secondaryEthnicity: "BISAYA" }).success).toBe(false);
  });
});

describe("ethnicityFields", () => {
  it("treats an empty string as no answer, the way an unfilled select posts", () => {
    const parsed = formSchema.safeParse({
      ethnicity: "",
      ethnicityOther: "",
      secondaryEthnicity: "",
      secondaryEthnicityOther: "",
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.ethnicity).toBeUndefined();
    expect(parsed.success && parsed.data.secondaryEthnicity).toBeUndefined();
  });
});

describe("ethnicityColumns", () => {
  it("writes nulls for a person who answered neither slot", () => {
    expect(ethnicityColumns({})).toEqual({
      ethnicity: null,
      ethnicityOther: null,
      secondaryEthnicity: null,
      secondaryEthnicityOther: null,
    });
  });

  it("keeps the free text only for the slot that chose Others", () => {
    expect(
      ethnicityColumns({
        ethnicity: "OTHER",
        ethnicityOther: "  Manobo ",
        secondaryEthnicity: "ILONGGO",
        secondaryEthnicityOther: "left over",
      })
    ).toEqual({
      ethnicity: "OTHER",
      ethnicityOther: "Manobo",
      secondaryEthnicity: "ILONGGO",
      secondaryEthnicityOther: null,
    });
  });

  it("drops the second ethnicity when the first is cleared", () => {
    // Removing the first answer in an edit must not strand the second.
    expect(
      ethnicityColumns({ secondaryEthnicity: "OTHER", secondaryEthnicityOther: "Subanen" })
    ).toEqual({
      ethnicity: null,
      ethnicityOther: null,
      secondaryEthnicity: null,
      secondaryEthnicityOther: null,
    });
  });
});
