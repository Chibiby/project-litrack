import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { LoginForm } from "@/components/forms/login-form";

const beginTeacherLogin = vi.fn();
const finishTeacherLogin = vi.fn();
const reportLoginFailure = vi.fn();
const signInWithPassword = vi.fn();

vi.mock("@/lib/actions/auth", () => ({
  loginSchoolHead: vi.fn(),
  loginTeacher: vi.fn(),
  registerTeacher: vi.fn(),
}));
vi.mock("@/lib/actions/login", () => ({
  beginTeacherLogin: (...args: unknown[]) => beginTeacherLogin(...args),
  finishTeacherLogin: (...args: unknown[]) => finishTeacherLogin(...args),
  beginSchoolHeadLogin: vi.fn(),
  finishSchoolHeadLogin: vi.fn(),
  reportLoginFailure: (...args: unknown[]) => reportLoginFailure(...args),
}));
vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: () => ({ auth: { signInWithPassword } }),
}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
}));

beforeAll(() => {
  window.HTMLElement.prototype.hasPointerCapture = vi.fn();
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

beforeEach(() => {
  vi.clearAllMocks();
  reportLoginFailure.mockResolvedValue({ ok: true });
});

afterEach(() => {
  cleanup();
  Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true });
});

const SCHOOLS = [{ id: "1", name: "Alabel Central ES", district: null, teachersOpen: true }];

function openTeacherSignIn() {
  render(<LoginForm schools={SCHOOLS} />);
  fireEvent.click(screen.getByLabelText("School Name"));
  fireEvent.click(screen.getByText("Alabel Central ES"));
  fireEvent.click(screen.getByRole("button", { name: /^Next: enter/ }));
}

function typeAndSubmit() {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ana@school.edu" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "hunter22" } });
  fireEvent.submit(screen.getByLabelText("Email").closest("form")!);
}

const emailInput = () => screen.getByLabelText("Email") as HTMLInputElement;
const passwordInput = () => screen.getByLabelText("Password") as HTMLInputElement;

describe("LoginForm failures", () => {
  it("offline: sends nothing, says so, keeps the typed email", async () => {
    openTeacherSignIn();
    Object.defineProperty(window.navigator, "onLine", { value: false, configurable: true });
    typeAndSubmit();

    expect(await screen.findByText(/No internet connection/)).toBeTruthy();
    expect(beginTeacherLogin).not.toHaveBeenCalled();
    expect(emailInput().value).toBe("ana@school.edu");
    expect(passwordInput().value).toBe("hunter22");
  });

  it("a dropped connection mid-request shows the unreachable message and keeps input", async () => {
    beginTeacherLogin.mockRejectedValue(new TypeError("Failed to fetch"));
    openTeacherSignIn();
    typeAndSubmit();

    expect(await screen.findByText(/Couldn't reach LITRACK/)).toBeTruthy();
    expect(emailInput().value).toBe("ana@school.edu");
  });

  it("wrong email: message under Email, field marked invalid and focused", async () => {
    const message = "No teacher account uses this email at the selected school.";
    beginTeacherLogin.mockResolvedValue({
      ok: false,
      code: "AUTH_TEACHER_NOT_FOUND",
      error: message,
      fieldErrors: { email: message },
    });
    openTeacherSignIn();
    typeAndSubmit();

    const alert = await screen.findByText(message);
    expect(alert.id).toBe("email-error");
    expect(emailInput().getAttribute("aria-invalid")).toBe("true");
    expect(emailInput().getAttribute("aria-describedby")).toBe("email-error");
    await waitFor(() => expect(document.activeElement).toBe(emailInput()));
    expect(emailInput().value).toBe("ana@school.edu");
  });

  it("wrong password at the browser grant: message under Password", async () => {
    beginTeacherLogin.mockResolvedValue({ ok: true, mode: "browser", email: "ana@school.edu" });
    signInWithPassword.mockResolvedValue({
      error: { name: "AuthApiError", status: 400, code: "invalid_credentials", message: "x" },
    });
    openTeacherSignIn();
    typeAndSubmit();

    const alert = await screen.findByText(/Incorrect password/);
    expect(alert.id).toBe("teacherPassword-error");
    expect(passwordInput().getAttribute("aria-invalid")).toBe("true");
    await waitFor(() => expect(document.activeElement).toBe(passwordInput()));
    expect(passwordInput().value).toBe("hunter22");
  });

  it("a failing reportLoginFailure does not hide the message", async () => {
    beginTeacherLogin.mockResolvedValue({ ok: true, mode: "browser", email: "ana@school.edu" });
    signInWithPassword.mockResolvedValue({
      error: { name: "AuthApiError", status: 400, code: "invalid_credentials", message: "x" },
    });
    reportLoginFailure.mockRejectedValue(new TypeError("Failed to fetch"));
    openTeacherSignIn();
    typeAndSubmit();

    expect(await screen.findByText(/Incorrect password/)).toBeTruthy();
    await waitFor(() => expect(reportLoginFailure).toHaveBeenCalled());
  });

  it("a grant that never reaches Supabase while offline says no internet, not a wrong password", async () => {
    beginTeacherLogin.mockResolvedValue({ ok: true, mode: "browser", email: "ana@school.edu" });
    signInWithPassword.mockImplementation(async () => {
      Object.defineProperty(window.navigator, "onLine", { value: false, configurable: true });
      return { error: { name: "AuthRetryableFetchError", status: 0, message: "Failed to fetch" } };
    });
    openTeacherSignIn();
    typeAndSubmit();

    expect(await screen.findByText(/No internet connection/)).toBeTruthy();
    expect(screen.queryByText(/Incorrect password/)).toBeNull();
    expect(reportLoginFailure).not.toHaveBeenCalled();
  });

  it("does not print 'No schools found' when the list failed to load", () => {
    render(<LoginForm schools={[]} notice="Couldn't load schools." />);
    expect(screen.getByText("Couldn't load schools.")).toBeTruthy();
    expect(screen.queryByText(/No schools found/)).toBeNull();
  });
});
