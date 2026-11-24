import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const panel = vi.fn((props: { schoolId: string; kindParam: string; kindHref: (k: string) => string }) => (
  <div data-testid="panel" data-school={props.schoolId} data-href={props.kindHref("teachers")} />
));

vi.mock("@/components/transfers/transfer-panel", () => ({
  TransferPanel: (props: { schoolId: string; kindParam: string; kindHref: (k: string) => string }) =>
    panel(props),
}));

const { SchoolTransfersSection } = await import("@/components/transfers/school-transfers-section");

const schools = [
  { id: "s1", name: "Alpha Elementary" },
  { id: "s2", name: "Bravo Elementary" },
];

describe("SchoolTransfersSection", () => {
  afterEach(cleanup);

  it("asks for the school people move from, listing only the schools given", () => {
    render(
      <SchoolTransfersSection schools={schools} schoolParam="" kindParam={undefined} basePath="/admin/management/transfers" />
    );
    const select = screen.getByLabelText("School they are moving from");
    expect(select.querySelectorAll("option")).toHaveLength(3);
    expect(screen.queryByTestId("panel")).toBeNull();
  });

  it("opens the chosen school's workspace, tabs linking back to the same page", () => {
    render(
      <SchoolTransfersSection schools={schools} schoolParam="s2" kindParam="learners" basePath="/admin/management/transfers" />
    );
    const node = screen.getByTestId("panel");
    expect(node.dataset.school).toBe("s2");
    expect(node.dataset.href).toBe("/admin/management/transfers?school=s2&kind=teachers");
  });

  it("never loads a school outside the list, even when the URL names it", () => {
    panel.mockClear();
    render(
      <SchoolTransfersSection schools={schools} schoolParam="other-school" kindParam={undefined} basePath="/district/transfers" />
    );
    expect(panel).not.toHaveBeenCalled();
    expect(screen.getByText(/Choose a school to send its people/)).toBeTruthy();
  });
});
