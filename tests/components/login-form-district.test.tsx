import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { LoginForm } from "@/components/forms/login-form";

vi.mock("@/lib/actions/auth", () => ({
  loginSchoolHead: vi.fn(),
  loginTeacher: vi.fn(),
  registerTeacher: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

// Radix Select needs pointer-event APIs jsdom does not implement.
beforeAll(() => {
  window.HTMLElement.prototype.hasPointerCapture = vi.fn();
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

afterEach(cleanup);

const SCHOOLS = [
  { id: "1", name: "Alabel Central ES", district: "Alabel 1", teachersOpen: true },
  { id: "2", name: "Banlibato IS", district: "Alabel 1", teachersOpen: false },
  { id: "3", name: "Glan Central ES", district: "Glan 2", teachersOpen: false },
];

// Radix's SelectTrigger ALSO renders role="combobox", so once the district filter
// exists there are two on this screen. Query by label, never by role alone.
const schoolTrigger = () => screen.getByLabelText("School Name");
const districtTrigger = () => screen.getByLabelText("District");
const openSchoolList = () => fireEvent.click(schoolTrigger());

describe("LoginForm district filter", () => {
  it("defaults to All districts and shows every school", () => {
    render(<LoginForm schools={SCHOOLS} />);
    expect(districtTrigger().textContent).toContain("All districts");
    openSchoolList();
    expect(screen.getAllByRole("option")).toHaveLength(3);
  });

  it("narrows the school list when a district is chosen", () => {
    render(<LoginForm schools={SCHOOLS} />);
    fireEvent.click(districtTrigger());
    fireEvent.click(screen.getByText("Glan 2"));
    openSchoolList();
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0].textContent).toContain("Glan Central ES");
  });

  it("clears a school selection the new district hides", () => {
    render(<LoginForm schools={SCHOOLS} />);
    openSchoolList();
    fireEvent.click(screen.getByText("Glan Central ES"));
    expect(schoolTrigger().textContent).toContain("Glan Central ES");

    fireEvent.click(districtTrigger());
    fireEvent.click(screen.getByText("Alabel 1"));
    expect(schoolTrigger().textContent).toContain("Select your school");
  });

  it("keeps a school selection the new district still contains", () => {
    render(<LoginForm schools={SCHOOLS} />);
    openSchoolList();
    fireEvent.click(screen.getByText("Alabel Central ES"));
    fireEvent.click(districtTrigger());
    fireEvent.click(screen.getByText("Alabel 1"));
    expect(schoolTrigger().textContent).toContain("Alabel Central ES");
  });

  it("disables both role buttons until a school is selected", () => {
    render(<LoginForm schools={SCHOOLS} />);
    // This repo has no @testing-library/jest-dom — use native DOM assertions only.
    expect(screen.getByRole("button", { name: "School Head" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Teachers" }).hasAttribute("disabled")).toBe(true);
  });

  it("shows the School ID first-time copy on the School Head screen", () => {
    render(<LoginForm schools={SCHOOLS} />);
    openSchoolList();
    fireEvent.click(screen.getByText("Alabel Central ES"));
    fireEvent.click(screen.getByRole("button", { name: "School Head" }));
    expect(screen.getByLabelText("School ID or password")).toBeTruthy();
    expect(screen.getByText(/First time signing in\? Enter your School ID/)).toBeTruthy();
  });

  it("hides the district field entirely when no school has a district", () => {
    render(<LoginForm schools={SCHOOLS.map((s) => ({ ...s, district: null }))} />);
    expect(screen.queryByLabelText("District")).toBeNull();
  });
});
