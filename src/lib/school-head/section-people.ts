/**
 * Who belongs to a section, for the expandable row on the School Head's Grade
 * and Section page. Pure so the page query stays a plain select and the rules
 * (who counts as a teacher of the section, in what order) can be tested alone.
 */

export type SectionTeacherRole = "ADVISER" | "TEACHER" | "ARAL";

export type SectionPersonTeacher = {
  id: string;
  name: string;
  /** Every way this teacher serves the section, adviser first. */
  roles: SectionTeacherRole[];
  /** Deactivated or removed: still shown, because the link still exists. */
  inactive: boolean;
};

export type SectionPersonLearner = {
  id: string;
  name: string;
  isAral: boolean;
  /** A section transfer request is already waiting for this learner. */
  pendingRequest: boolean;
};

export type SectionPeople = {
  /**
   * The section's adviser. `usable` is false for one who is removed,
   * deactivated or not a teacher: learners cannot be moved into the section
   * until it has a usable adviser (the rule `evaluateSectionTransfer` applies).
   */
  adviser: { id: string; name: string; usable: boolean } | null;
  teachers: SectionPersonTeacher[];
  learners: SectionPersonLearner[];
};

type PersonRow = {
  id: string;
  firstName: string;
  lastName: string;
  isActive?: boolean;
  deletedAt?: Date | null;
  role?: string;
};

export type SectionPeopleSource = {
  adviser: PersonRow | null;
  teachers: { teacher: PersonRow }[];
  learners: (PersonRow & { isAralLearner: boolean; aralTeacher: PersonRow | null })[];
};

const ROLE_ORDER: SectionTeacherRole[] = ["ADVISER", "TEACHER", "ARAL"];

export function personName(p: { firstName: string; lastName: string }): string {
  return `${p.lastName.trim()}, ${p.firstName.trim()}`;
}

const isInactive = (row: PersonRow) => row.isActive === false || Boolean(row.deletedAt);

const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name, "en", { sensitivity: "base" });

export function buildSectionPeople(
  source: SectionPeopleSource,
  pendingLearnerIds: ReadonlySet<string> = new Set()
): SectionPeople {
  const teachers = new Map<string, SectionPersonTeacher>();
  const add = (row: PersonRow | null, role: SectionTeacherRole) => {
    if (!row) return;
    const existing = teachers.get(row.id);
    if (existing) {
      if (!existing.roles.includes(role)) existing.roles.push(role);
      return;
    }
    teachers.set(row.id, { id: row.id, name: personName(row), roles: [role], inactive: isInactive(row) });
  };

  add(source.adviser, "ADVISER");
  for (const t of source.teachers) add(t.teacher, "TEACHER");
  for (const l of source.learners) if (l.isAralLearner) add(l.aralTeacher, "ARAL");

  const sorted = [...teachers.values()].map((t) => ({
    ...t,
    roles: [...t.roles].sort((a, b) => ROLE_ORDER.indexOf(a) - ROLE_ORDER.indexOf(b)),
  }));
  // Adviser on top, then everyone else by name.
  sorted.sort((a, b) => {
    const aAdv = a.roles.includes("ADVISER") ? 0 : 1;
    const bAdv = b.roles.includes("ADVISER") ? 0 : 1;
    return aAdv - bAdv || byName(a, b);
  });

  const a = source.adviser;
  return {
    adviser: a
      ? {
          id: a.id,
          name: personName(a),
          usable: !isInactive(a) && (a.role === undefined || a.role === "TEACHER"),
        }
      : null,
    teachers: sorted,
    learners: source.learners
      .map((l) => ({
        id: l.id,
        name: personName(l),
        isAral: l.isAralLearner,
        pendingRequest: pendingLearnerIds.has(l.id),
      }))
      .sort(byName),
  };
}
