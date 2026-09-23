import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PrintableLearnersReport } from "@/components/reports/printable-learners-report";
import { SYSTEM_GENERATED_NOTE } from "@/lib/reports/sheet-header";
import type { PrintableReportLearner } from "@/lib/actions/export-learners";

afterEach(cleanup);

const learner: PrintableReportLearner = {
  id: "l1",
  fullName: "Dela Cruz, Juan",
  age: 8,
  gender: "MALE",
  englishReadingProfile: null,
  filipinoReadingProfile: "FULL_ALPHABET_KNOWLEDGE",
  isAralLearner: true,
  gradeLevel: { type: "GRADE_2" },
  section: { name: "Narra" },
};

const baseProps = {
  schoolName: "Sample Elementary School",
  generatedAt: new Date("2026-09-01T00:00:00Z"),
  learners: [learner],
  aralCount: 1,
  byGrade: [{ type: "GRADE_2", learners: [learner] }],
};

describe("PrintableLearnersReport header/footer block", () => {
  it("renders the DepEd header rows in order when header is provided", () => {
    render(
      <PrintableLearnersReport
        {...baseProps}
        header={[
          { label: "School ID", value: "123456" },
          { label: "School Name", value: "Sample Elementary School" },
          { label: "Region", value: "Region IV-A" },
          { label: "Division", value: "Batangas" },
          { label: "District", value: "District 1" },
          { label: "School Year", value: "2026-2027" },
          { label: "Grade / Section", value: "Grade 2 - Narra" },
          { label: "Prepared by", value: "Juana Dela Cruz" },
        ]}
      />
    );

    const labels = [
      "School ID:",
      "School Name:",
      "Region:",
      "Division:",
      "District:",
      "School Year:",
      "Grade / Section:",
      "Prepared by:",
    ];
    const found = labels.map((label) => screen.getByText(label));
    for (const el of found) {
      expect(el.tagName).toBe("DT");
    }
    // DOM order matches the array order passed in.
    const positions = found.map((el) =>
      Array.prototype.indexOf.call(el.parentElement?.parentElement?.children ?? [], el.parentElement)
    );
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("renders the footer lines and logo when footer is provided", () => {
    render(
      <PrintableLearnersReport
        {...baseProps}
        footer={{ preparedBy: "Juana Dela Cruz", notedBy: "Maria Santos" }}
      />
    );

    expect(screen.getByText("Prepared by: Juana Dela Cruz")).toBeTruthy();
    expect(screen.getByText("Noted by: Maria Santos")).toBeTruthy();
    expect(screen.getByText(SYSTEM_GENERATED_NOTE)).toBeTruthy();
    const logos = screen.getAllByRole("img");
    expect(logos.map((img) => img.getAttribute("alt"))).toEqual([
      "DepEd seal",
      "Bagong Pilipinas",
      "DepEd",
      "DepEd Division of Sarangani",
    ]);
    expect(logos[0]!.getAttribute("src")).toBe("/brand/report/deped-seal.png");
  });

  it("renders fine without header or footer (older data shape)", () => {
    render(<PrintableLearnersReport {...baseProps} />);

    expect(screen.getByText("Sample Elementary School")).toBeTruthy();
    expect(screen.queryByText("School ID:")).toBeNull();
    expect(screen.queryByText(SYSTEM_GENERATED_NOTE)).toBeNull();
  });
});
