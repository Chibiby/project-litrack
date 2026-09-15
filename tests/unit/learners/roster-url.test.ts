import { describe, expect, it } from "vitest";
import {
  rosterHref,
  withAdvisory,
  withGrade,
  withSection,
  type AdvisoryOption,
  type RosterUrlState,
} from "@/components/learners/learner-list-toolbar";

const advisories: AdvisoryOption[] = [
  { id: "atis", gradeLevelId: "g3", label: "Grade 3 - Atis" },
  { id: "batuan", gradeLevelId: "g4", label: "Grade 4 - Batuan" },
];

const base: RosterUrlState = {
  q: "",
  grade: "all",
  section: "all",
  advisory: null,
  gender: "all",
  aralStatus: "all",
  sort: "name",
  archivedView: false,
};

describe("roster URL helpers", () => {
  it("leaves defaults out of the URL", () => {
    expect(rosterHref("/teacher/learners", base)).toBe("/teacher/learners");
    expect(
      rosterHref("/teacher/learners", { ...base, archivedView: true, sort: "age" })
    ).toBe("/teacher/learners?filter=archived&sort=age");
  });

  it("picking an advisory pins its grade and clears the section", () => {
    const next = withAdvisory({ ...base, section: "other" }, "batuan", advisories);
    expect(next).toMatchObject({ advisory: "batuan", grade: "g4", section: "all" });
  });

  it("an unknown advisory falls back to all advisories", () => {
    expect(withAdvisory(base, "nope", advisories).advisory).toBeNull();
  });

  it("changing grade drops an advisory from another grade", () => {
    const onAtis = withAdvisory(base, "atis", advisories);
    expect(withGrade(onAtis, "g4", advisories)).toMatchObject({ grade: "g4", advisory: null });
    expect(withGrade(onAtis, "g3", advisories).advisory).toBe("atis");
  });

  it("picking a section drops the advisory", () => {
    const onAtis = withAdvisory(base, "atis", advisories);
    expect(withSection(onAtis, "sec-9")).toMatchObject({ section: "sec-9", advisory: null });
    expect(withSection(onAtis, "all").advisory).toBe("atis");
  });
});
