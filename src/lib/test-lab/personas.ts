import { DEMO_SCHOOLS } from "@/lib/demo/constants";
import { schoolHeadSyntheticEmail, teacherSyntheticEmail } from "@/lib/auth/synthetic-email";

/**
 * Page Test Lab personas (docs/test-lab-spec.md).
 *
 * Every persona is an account inside the one demo school, found by a fixed
 * synthetic email. The email alone is never trusted as proof of "demo": the
 * lookup in `startTestLabSession` also requires `school.isDemo`, and
 * `assertTestableSchool` re-checks the school — so a real account that somehow
 * held one of these addresses still could not be started from Test Lab.
 *
 * Pure: no Prisma, no `server-only`, so the Test Lab page and its tests can
 * import it.
 */

export const TEST_LAB_PERSONAS = ["head", "teacher", "pending-teacher"] as const;
export type TestLabPersona = (typeof TEST_LAB_PERSONAS)[number];

/** The demo school Test Lab works in. `DEMO_SCHOOLS` holds exactly this one. */
export const TEST_LAB_SCHOOL = DEMO_SCHOOLS[0];

/**
 * The fixed synthetic email for each persona.
 *
 * The head is the demo school's existing School Head. The teacher addresses use
 * the ordinary teacher convention (`<username>@school.local`); the `testlab.`
 * prefix can never collide with a real teacher, whose usernames are always
 * `teacher.<lastname>.<4hex>`.
 */
export function testLabPersonaEmail(persona: TestLabPersona): string {
  const code = TEST_LAB_SCHOOL.emailCode;
  switch (persona) {
    case "head":
      return schoolHeadSyntheticEmail(code);
    case "teacher":
      return teacherSyntheticEmail(`testlab.teacher.${code}`);
    case "pending-teacher":
      return teacherSyntheticEmail(`testlab.pending.${code}`);
  }
}

export function testLabPersonaRole(persona: TestLabPersona): "SCHOOL_HEAD" | "TEACHER" {
  return persona === "head" ? "SCHOOL_HEAD" : "TEACHER";
}

export function testLabRoleHome(persona: TestLabPersona): "/school-head" | "/teacher" {
  return persona === "head" ? "/school-head" : "/teacher";
}

/**
 * Whether `next` is a safe in-app destination for this persona.
 *
 * Deliberately a prefix rule for now; the spec's final rule is "exactly a
 * checklist href for the persona's role", and this is the one function to
 * tighten when the checklist lands. Refuses: anything outside the persona's
 * role tree (including look-alikes such as `/teachers`), protocol-relative
 * `//`, backslashes (browsers read `\` as `/`), a scheme, and whitespace or
 * control characters.
 */
export function isAllowedTestLabNext(persona: TestLabPersona, next: string): boolean {
  const home = testLabRoleHome(persona);
  if (next !== home && !next.startsWith(`${home}/`) && !next.startsWith(`${home}?`)) {
    return false;
  }
  if (next.includes("//") || next.includes("\\")) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(next)) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001f\u007f]/.test(next)) return false;
  return true;
}

/** `next` when allowed, else the persona's role home. */
export function resolveTestLabNext(persona: TestLabPersona, next: string | undefined): string {
  return next !== undefined && isAllowedTestLabNext(persona, next) ? next : testLabRoleHome(persona);
}
