import { describe, expect, it } from "vitest";
import {
  DEMO_DISTRICT_NAME,
  DEMO_ENABLED_KEY,
  DEMO_SCHOOL_ID_CODE,
  DEMO_SCHOOL_NAME,
} from "@/lib/demo/constants";
import { demoSchoolFilter } from "@/lib/settings/system-settings";
import {
  RESET_DEMO_CONFIRMATION,
  resetDemoSchema,
  setDemoModeSchema,
} from "@/lib/validators/demo.schema";
import { createSchoolSchema } from "@/lib/validators/school.schema";
import {
  ALL_DISTRICTS,
  deriveDistricts,
  schoolsInDistrict,
  type SchoolOption,
} from "@/lib/login/district-filter";
import { SNAPSHOT_MODELS } from "@/lib/db/schema-order";
import { schoolHeadSyntheticEmail } from "@/lib/auth/synthetic-email";

describe("demo tenant constants", () => {
  // These strings are read aloud and shown on screen in the training video.
  // Anything that changes them silently desynchronises the recording from the app.
  it("names the district and school exactly as the training script does", () => {
    expect(DEMO_DISTRICT_NAME).toBe("[demo district]");
    expect(DEMO_SCHOOL_NAME).toBe("[demo school]");
  });

  it("uses 123456 as the School ID", () => {
    expect(DEMO_SCHOOL_ID_CODE).toBe("123456");
  });

  it("keeps a School ID the real create-school form would also accept", () => {
    // The demo must not be a special case: the video teaches the ordinary rule
    // that first-login password === School ID, so the demo's ID has to satisfy
    // the same validator every real school's does.
    const parsed = createSchoolSchema.safeParse({
      name: DEMO_SCHOOL_NAME,
      schoolIdCode: DEMO_SCHOOL_ID_CODE,
    });
    expect(parsed.success).toBe(true);
  });

  it("derives a usable synthetic School Head email from the School ID", () => {
    expect(schoolHeadSyntheticEmail(DEMO_SCHOOL_ID_CODE)).toMatch(/^sh@123456\./);
  });
});

describe("demoSchoolFilter", () => {
  it("adds no clause at all when demo mode is on", () => {
    // An empty object matters, not just an equivalent one: it must leave the
    // query exactly as it was before this feature existed.
    expect(demoSchoolFilter(true)).toEqual({});
    expect(Object.keys(demoSchoolFilter(true))).toHaveLength(0);
  });

  it("excludes demo rows when demo mode is off", () => {
    expect(demoSchoolFilter(false)).toEqual({ isDemo: false });
  });
});

describe("setDemoModeSchema", () => {
  it.each([
    ["true", true],
    ["on", true],
    ["false", false],
    ["off", false],
  ])("reads %s as %s", (input, expected) => {
    const parsed = setDemoModeSchema.safeParse({ enabled: input });
    expect(parsed.success && parsed.data.enabled).toBe(expected);
  });

  it("accepts real booleans", () => {
    expect(setDemoModeSchema.parse({ enabled: true }).enabled).toBe(true);
    expect(setDemoModeSchema.parse({ enabled: false }).enabled).toBe(false);
  });

  it("rejects anything else rather than guessing", () => {
    expect(setDemoModeSchema.safeParse({ enabled: "yes" }).success).toBe(false);
    expect(setDemoModeSchema.safeParse({}).success).toBe(false);
  });
});

describe("resetDemoSchema", () => {
  it("requires the exact confirmation phrase", () => {
    expect(resetDemoSchema.safeParse({ confirm: RESET_DEMO_CONFIRMATION }).success).toBe(true);
  });

  it("tolerates surrounding whitespace but not a different phrase", () => {
    expect(resetDemoSchema.safeParse({ confirm: "  RESET DEMO  " }).success).toBe(true);
    expect(resetDemoSchema.safeParse({ confirm: "reset demo" }).success).toBe(false);
    expect(resetDemoSchema.safeParse({ confirm: "RESET" }).success).toBe(false);
    expect(resetDemoSchema.safeParse({ confirm: "" }).success).toBe(false);
  });
});

describe("demo district on the login page", () => {
  const opt = (name: string, district: string | null): SchoolOption => ({
    id: name,
    name,
    district,
    teachersOpen: true,
  });

  it("appears as its own district once the demo school is in the list", () => {
    const schools = [opt("Real ES", "District I"), opt(DEMO_SCHOOL_NAME, DEMO_DISTRICT_NAME)];
    expect(deriveDistricts(schools)).toContain(DEMO_DISTRICT_NAME);
    expect(schoolsInDistrict(schools, DEMO_DISTRICT_NAME).map((s) => s.name)).toEqual([
      DEMO_SCHOOL_NAME,
    ]);
  });

  it("leaves no trace in the district list once the school is filtered out", () => {
    // Districts are derived from the school rows, so hiding the school is what
    // hides the district — there is no second place demo mode has to reach.
    const schools = [opt("Real ES", "District I")];
    expect(deriveDistricts(schools)).not.toContain(DEMO_DISTRICT_NAME);
    expect(schoolsInDistrict(schools, ALL_DISTRICTS)).toHaveLength(1);
  });
});

describe("SystemSetting in the backup order", () => {
  const entry = SNAPSHOT_MODELS.find((m) => m.model === "SystemSetting");

  it("is included, so demo mode survives a backup and restore", () => {
    expect(entry).toBeDefined();
    expect(entry?.delegate).toBe("systemSetting");
  });

  it("is not operational, so clearing operational data leaves the switch alone", () => {
    expect(entry?.operational).toBe(false);
  });
});

describe("demo.enabled key", () => {
  it("is namespaced so future switches can share the table", () => {
    expect(DEMO_ENABLED_KEY).toBe("demo.enabled");
  });
});
