import { cleanup, render, screen, within } from "@testing-library/react";
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

    // One demo event, drawn once in the desktop table and once in the phone list.
    const table = screen.getByRole("table");
    const list = screen.getByRole("list", { name: "Error events" });
    expect(within(table).getAllByText("Demo")).toHaveLength(1);
    expect(within(list).getAllByText("Demo")).toHaveLength(1);
  });

  it("lists every event in the phone layout with its reference", () => {
    render(
      <ErrorLogTable
        events={[row({ id: "a", ref: "E-AAAA1111" }), row({ id: "b", ref: "E-BBBB2222" })]}
        hasRefFilter={false}
      />
    );
    const list = screen.getByRole("list", { name: "Error events" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(within(list).getByText("E-AAAA1111")).not.toBeNull();
    expect(within(list).getByText("E-BBBB2222")).not.toBeNull();
  });

  it("shows the empty state when there are no events", () => {
    render(<ErrorLogTable events={[]} hasRefFilter={false} />);
    expect(screen.getByText("No errors recorded")).not.toBeNull();
  });
});
