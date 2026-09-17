import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ErrorLogRow } from "@/components/admin/error-log-table";

import { ErrorLogTable } from "@/components/admin/error-log-table";

afterEach(cleanup);

function row(overrides: Partial<ErrorLogRow>): ErrorLogRow {
  return {
    id: "event-1",
    createdAt: new Date("2026-09-01T00:00:00Z"),
    code: "VALIDATION_FAILED",
    severity: "system",
    message: "Something failed",
    context: null,
    stack: null,
    route: "/admin/errors",
    routeType: "page",
    schoolId: "school-1",
    schoolName: "Malandag Central ES",
    isDemoSchool: false,
    userId: null,
    ref: "abc123",
    ...overrides,
  };
}

describe("ErrorLogTable", () => {
  it("marks a demo school's event and leaves a real school's event unmarked", () => {
    render(
      <ErrorLogTable
        events={[
          row({ id: "real", schoolName: "Malandag Central ES", isDemoSchool: false }),
          row({ id: "demo", schoolId: "school-2", schoolName: "Test Lab Demo School", isDemoSchool: true }),
        ]}
        hasRefFilter={false}
      />
    );

    expect(screen.getAllByText("Demo")).toHaveLength(1);
  });

  it("shows the empty state when there are no events", () => {
    render(<ErrorLogTable events={[]} hasRefFilter={false} />);
    expect(screen.getByText("No errors recorded")).not.toBeNull();
  });
});
