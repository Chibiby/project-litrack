import { describe, it, expect } from "vitest";
import {
  planDistrictAdmins,
  type DistrictAdminRosterEntry,
  type ExistingDistrictAdminUser,
} from "../../../scripts/lib/district-admin-plan";

const KNOWN_DISTRICTS = [
  "Alabel 1",
  "Alabel 2",
  "Alabel 3",
  "Alabel 4",
  "Glan 1",
  "Glan 2",
  "Glan 3",
  "Glan 4",
];

function entry(overrides: Partial<DistrictAdminRosterEntry> = {}): DistrictAdminRosterEntry {
  return {
    username: "ferdinand.simon",
    email: "ferdinand.simon@litrack.local",
    firstName: "Ferdinand",
    lastName: "Simon",
    districts: ["Alabel 1", "Alabel 2"],
    ...overrides,
  };
}

describe("planDistrictAdmins", () => {
  it("plans a fresh account for a roster entry with no existing user", () => {
    const plan = planDistrictAdmins([entry()], [], KNOWN_DISTRICTS);
    expect(plan.create).toEqual([
      {
        username: "ferdinand.simon",
        firstName: "Ferdinand",
        lastName: "Simon",
        districts: ["Alabel 1", "Alabel 2"],
      },
    ]);
    expect(plan.skip).toEqual([]);
    expect(plan.addAssignments).toEqual([]);
    expect(plan.extraAssignments).toEqual([]);
    expect(plan.conflicts).toEqual([]);
    expect(plan.unknownDistricts).toEqual([]);
    expect(plan.badCounts).toEqual([]);
  });

  it("lands an unknown district in unknownDistricts and creates nothing", () => {
    const plan = planDistrictAdmins(
      [entry({ districts: ["Alabel 1", "Nowhere District"] })],
      [],
      KNOWN_DISTRICTS
    );
    expect(plan.unknownDistricts).toEqual([{ username: "ferdinand.simon", district: "Nowhere District" }]);
    expect(plan.create).toEqual([]);
    expect(plan.skip).toEqual([]);
  });

  it("treats [demo district] as unknown even if it were somehow passed as known", () => {
    const plan = planDistrictAdmins(
      [entry({ districts: ["Alabel 1", "[demo district]"] })],
      [],
      [...KNOWN_DISTRICTS, "[demo district]"]
    );
    expect(plan.unknownDistricts).toEqual([{ username: "ferdinand.simon", district: "[demo district]" }]);
    expect(plan.create).toEqual([]);
  });

  it("skips an existing DISTRICT_ADMIN and plans only the missing assignments", () => {
    const existing: ExistingDistrictAdminUser = {
      id: "user-1",
      username: "ferdinand.simon",
      email: "ferdinand.simon@litrack.local",
      role: "DISTRICT_ADMIN",
      districts: ["Alabel 1"],
    };
    const plan = planDistrictAdmins(
      [entry({ districts: ["Alabel 1", "Alabel 2"] })],
      [existing],
      KNOWN_DISTRICTS
    );
    expect(plan.create).toEqual([]);
    expect(plan.skip).toEqual([{ username: "ferdinand.simon", userId: "user-1", districts: ["Alabel 1", "Alabel 2"] }]);
    expect(plan.addAssignments).toEqual([{ username: "ferdinand.simon", userId: "user-1", district: "Alabel 2" }]);
    expect(plan.extraAssignments).toEqual([]);
  });

  it("reports districts already on an existing admin but absent from the roster as extraAssignments, never removing them", () => {
    const existing: ExistingDistrictAdminUser = {
      id: "user-1",
      username: "ferdinand.simon",
      email: "ferdinand.simon@litrack.local",
      role: "DISTRICT_ADMIN",
      districts: ["Alabel 1", "Alabel 2", "Glan 1"],
    };
    const plan = planDistrictAdmins(
      [entry({ districts: ["Alabel 1", "Alabel 2"] })],
      [existing],
      KNOWN_DISTRICTS
    );
    expect(plan.addAssignments).toEqual([]);
    expect(plan.extraAssignments).toEqual([{ username: "ferdinand.simon", userId: "user-1", district: "Glan 1" }]);
  });

  it("plans nothing to add when an existing admin already has every roster district", () => {
    const existing: ExistingDistrictAdminUser = {
      id: "user-1",
      username: "ferdinand.simon",
      email: "ferdinand.simon@litrack.local",
      role: "DISTRICT_ADMIN",
      districts: ["Alabel 1", "Alabel 2"],
    };
    const plan = planDistrictAdmins(
      [entry({ districts: ["Alabel 1", "Alabel 2"] })],
      [existing],
      KNOWN_DISTRICTS
    );
    expect(plan.skip).toEqual([{ username: "ferdinand.simon", userId: "user-1", districts: ["Alabel 1", "Alabel 2"] }]);
    expect(plan.addAssignments).toEqual([]);
    expect(plan.extraAssignments).toEqual([]);
  });

  it("flags a username already held by a TEACHER as a conflict, and creates nothing", () => {
    const existing: ExistingDistrictAdminUser = {
      id: "user-2",
      username: "ferdinand.simon",
      email: "ferdinand.simon@school.local",
      role: "TEACHER",
      districts: [],
    };
    const plan = planDistrictAdmins([entry()], [existing], KNOWN_DISTRICTS);
    expect(plan.conflicts).toEqual([{ username: "ferdinand.simon", existingRole: "TEACHER" }]);
    expect(plan.create).toEqual([]);
    expect(plan.skip).toEqual([]);
  });

  it("flags a username held by a SCHOOL_HEAD as a conflict too", () => {
    const existing: ExistingDistrictAdminUser = {
      id: "user-3",
      username: "ferdinand.simon",
      email: "sh@500001.litrack.local",
      role: "SCHOOL_HEAD",
      districts: [],
    };
    const plan = planDistrictAdmins([entry()], [existing], KNOWN_DISTRICTS);
    expect(plan.conflicts).toEqual([{ username: "ferdinand.simon", existingRole: "SCHOOL_HEAD" }]);
  });

  it("flags an email collision under a different, non-matching username as a conflict, and creates nothing (MEDIUM-1)", () => {
    const existing: ExistingDistrictAdminUser = {
      id: "user-9",
      username: null,
      email: "ferdinand.simon@litrack.local",
      role: "SCHOOL_HEAD",
      districts: [],
    };
    const plan = planDistrictAdmins(
      [entry({ username: "f.simon", email: "ferdinand.simon@litrack.local" })],
      [existing],
      KNOWN_DISTRICTS
    );
    expect(plan.conflicts).toEqual([{ username: "f.simon", existingRole: "SCHOOL_HEAD" }]);
    expect(plan.create).toEqual([]);
    expect(plan.skip).toEqual([]);
  });

  it("matches an email collision case-insensitively", () => {
    const existing: ExistingDistrictAdminUser = {
      id: "user-10",
      username: "someone.else",
      email: "Ferdinand.Simon@Litrack.local",
      role: "TEACHER",
      districts: [],
    };
    const plan = planDistrictAdmins(
      [entry({ username: "f.simon", email: "ferdinand.simon@litrack.local" })],
      [existing],
      KNOWN_DISTRICTS
    );
    expect(plan.conflicts).toEqual([{ username: "f.simon", existingRole: "TEACHER" }]);
    expect(plan.create).toEqual([]);
  });

  it("skips an existing DISTRICT_ADMIN matched by email alone (username differs)", () => {
    const existing: ExistingDistrictAdminUser = {
      id: "user-11",
      username: "old.handle",
      email: "ferdinand.simon@litrack.local",
      role: "DISTRICT_ADMIN",
      districts: ["Alabel 1"],
    };
    const plan = planDistrictAdmins(
      [entry({ username: "ferdinand.simon", email: "ferdinand.simon@litrack.local" })],
      [existing],
      KNOWN_DISTRICTS
    );
    expect(plan.create).toEqual([]);
    expect(plan.skip).toEqual([
      { username: "ferdinand.simon", userId: "user-11", districts: ["Alabel 1", "Alabel 2"] },
    ]);
    expect(plan.addAssignments).toEqual([{ username: "ferdinand.simon", userId: "user-11", district: "Alabel 2" }]);
  });

  it("lands a zero-district entry in badCounts", () => {
    const plan = planDistrictAdmins([entry({ districts: [] })], [], KNOWN_DISTRICTS);
    expect(plan.badCounts).toEqual([{ username: "ferdinand.simon", count: 0 }]);
    expect(plan.create).toEqual([]);
    expect(plan.unknownDistricts).toEqual([]);
  });

  it("lands a four-district entry in badCounts", () => {
    const plan = planDistrictAdmins(
      [entry({ districts: ["Alabel 1", "Alabel 2", "Alabel 3", "Alabel 4"] })],
      [],
      KNOWN_DISTRICTS
    );
    expect(plan.badCounts).toEqual([{ username: "ferdinand.simon", count: 4 }]);
    expect(plan.create).toEqual([]);
  });

  it("accepts exactly 1 and exactly 3 districts as valid boundaries", () => {
    const one = planDistrictAdmins([entry({ districts: ["Alabel 1"] })], [], KNOWN_DISTRICTS);
    expect(one.badCounts).toEqual([]);
    expect(one.create).toHaveLength(1);

    const three = planDistrictAdmins(
      [entry({ districts: ["Glan 1", "Glan 2", "Glan 3"] })],
      [],
      KNOWN_DISTRICTS
    );
    expect(three.badCounts).toEqual([]);
    expect(three.create).toHaveLength(1);
  });

  it("classifies each roster entry independently in a mixed roster", () => {
    const roster: DistrictAdminRosterEntry[] = [
      entry({ username: "a.new", firstName: "A", lastName: "New", districts: ["Alabel 1"] }),
      entry({ username: "b.taken", firstName: "B", lastName: "Taken", districts: ["Alabel 2"] }),
      entry({ username: "c.unknown", firstName: "C", lastName: "Unknown", districts: ["Nowhere"] }),
      entry({ username: "d.badcount", firstName: "D", lastName: "Badcount", districts: [] }),
      entry({
        username: "e.existing",
        firstName: "E",
        lastName: "Existing",
        districts: ["Glan 1", "Glan 2"],
      }),
    ];
    const existingUsers: ExistingDistrictAdminUser[] = [
      { id: "u-taken", username: "b.taken", email: "b.taken@school.local", role: "TEACHER", districts: [] },
      {
        id: "u-existing",
        username: "e.existing",
        email: "e.existing@litrack.local",
        role: "DISTRICT_ADMIN",
        districts: ["Glan 1"],
      },
    ];

    const plan = planDistrictAdmins(roster, existingUsers, KNOWN_DISTRICTS);

    expect(plan.create.map((c) => c.username)).toEqual(["a.new"]);
    expect(plan.conflicts).toEqual([{ username: "b.taken", existingRole: "TEACHER" }]);
    expect(plan.unknownDistricts).toEqual([{ username: "c.unknown", district: "Nowhere" }]);
    expect(plan.badCounts).toEqual([{ username: "d.badcount", count: 0 }]);
    expect(plan.skip.map((s) => s.username)).toEqual(["e.existing"]);
    expect(plan.addAssignments).toEqual([{ username: "e.existing", userId: "u-existing", district: "Glan 2" }]);
  });
});
