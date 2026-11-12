import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  SchoolYearBadgeView,
  closedReasonLine,
  type HeaderSchoolYearGate,
} from "@/components/shell/school-year-badge";

afterEach(cleanup);

const closed = (over: Partial<HeaderSchoolYearGate>): HeaderSchoolYearGate => ({
  open: false,
  reason: "NO_WINDOW",
  isLastMonth: false,
  label: null,
  activeStart: null,
  activeEnd: null,
  ...over,
});

describe("closedReasonLine", () => {
  it("tells people to wait when nothing is set", () => {
    expect(closedReasonLine(closed({ reason: "NO_WINDOW" }))).toBe(
      "Wait for the Division Admin to set an active school year."
    );
    expect(closedReasonLine(closed({ reason: "NO_ACTIVE_YEAR" }))).toBe(
      "Wait for the Division Admin to set an active school year."
    );
  });

  it("names the opening month before the duration starts", () => {
    expect(
      closedReasonLine(closed({ reason: "NOT_STARTED", label: "2027-2028", activeStart: "2027-06-01" }))
    ).toBe("2027-2028 opens Jun 2027.");
  });

  it("names the closing month after the duration ends", () => {
    expect(
      closedReasonLine(closed({ reason: "ENDED", label: "2026-2027", activeEnd: "2027-04-30" }))
    ).toBe("2026-2027 ended Apr 2027.");
  });
});

describe("SchoolYearBadgeView", () => {
  it("renders nothing while the year is open", () => {
    const { container } = render(
      <SchoolYearBadgeView gate={{ ...closed({}), open: true, reason: null, label: "2026-2027" }} />
    );
    expect(container.textContent).toBe("");
  });

  it("shows a subtle note in the last month", () => {
    render(
      <SchoolYearBadgeView
        gate={{ ...closed({}), open: true, reason: null, isLastMonth: true, label: "2026-2027" }}
      />
    );
    expect(screen.getByText("Last month of 2026-2027")).toBeTruthy();
  });

  it("opens the explanation when the closed badge is clicked", async () => {
    render(<SchoolYearBadgeView gate={closed({})} />);
    fireEvent.click(screen.getByRole("button", { name: /No active school year/ }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain(
      "Learners, ARAL, MOSY, BOSY and every school record are read-only"
    );
    expect(dialog.textContent).toContain("Wait for the Division Admin to set an active school year.");
    expect(screen.queryByRole("link", { name: "Set the active school year" })).toBeNull();
  });

  it("gives a Division Admin the way to set it", async () => {
    render(<SchoolYearBadgeView gate={closed({})} isDivisionAdmin />);
    fireEvent.click(screen.getByRole("button", { name: /No active school year/ }));
    const link = await screen.findByRole("link", { name: "Set the active school year" });
    expect(link.getAttribute("href")).toBe("/admin/school-setup/school-years");
  });
});
