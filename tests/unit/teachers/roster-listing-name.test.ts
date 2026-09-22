import { describe, expect, it } from "vitest";
import { toManagedRow, type ManagedTeacher } from "@/lib/teachers/roster";

/**
 * `listingName` — the surname-first display name the Active/Inactive teacher
 * tables render instead of `fullName`. Built by `toManagedRow` via
 * `formatListingNameFromRecord`, never by parsing `fullName` apart (see
 * `src/lib/names.ts`), because a surname like "Dela Cruz" cannot be split back
 * out of the "Firstname Middlename Lastname" shape `fullName` stores.
 */

const BASE = {
  id: "teacher-marivic",
  fullName: "Marivic Santos Cruz",
  firstName: "Marivic",
  middleName: "Santos",
  lastName: "Cruz",
  email: "marivic@example.test",
  avatarPath: null,
  profileCompleted: true,
  approvedAt: new Date(2026, 5, 1),
  advisorySections: [],
  teacherProfile: { designation: "Teacher", advisoryMode: "DEFAULT" },
  _count: { managedLearners: 12, aralLearners: 3 },
} satisfies ManagedTeacher;

describe("toManagedRow — listingName", () => {
  it("renders surname-first, from the separate name columns", () => {
    const row = toManagedRow(BASE);
    expect(row.listingName).toBe("Cruz, Marivic Santos");
  });

  it("keeps fullName exactly as stored, unchanged, alongside listingName", () => {
    const row = toManagedRow(BASE);
    expect(row.fullName).toBe("Marivic Santos Cruz");
  });

  it("collapses cleanly for a teacher with no middle name", () => {
    const row = toManagedRow({ ...BASE, middleName: null });
    expect(row.listingName).toBe("Cruz, Marivic");
  });
});
