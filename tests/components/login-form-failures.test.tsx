import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { LoginForm } from "@/components/forms/login-form";
import { formatMessage } from "@/lib/errors/codes";

/**
 * The teacher sign-in is one server action now: `loginTeacher` checks the
 * password against Better Auth on the server and either redirects or returns a
 * failure. There is no browser-side password grant (and so no separate
 * "report the failure" call) to fail independently any more.
 */

const loginTeacher = vi.fn();

vi.mock("@/lib/actions/auth", () => ({
  loginSchoolHead: vi.fn(),
  loginTeacher: (...args: unknown[]) => loginTeacher(...args),
  registerTeacher: vi.fn(),
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
    expect(loginTeacher).not.toHaveBeenCalled();
    expect(emailInput().value).toBe("ana@school.edu");
    expect(passwordInput().value).toBe("hunter22");
  });

  it("a dropped connection mid-request shows the unreachable message and keeps input", async () => {
    loginTeacher.mockRejectedValue(new TypeError("Failed to fetch"));
    openTeacherSignIn();
    typeAndSubmit();

    expect(await screen.findByText(/Couldn't reach LITRACK/)).toBeTruthy();
    expect(emailInput().value).toBe("ana@school.edu");
    expect(passwordInput().value).toBe("hunter22");
  });

  it("wrong email: message under Email, field marked invalid and focused", async () => {
    const message = "No teacher account uses this email at the selected school.";
    loginTeacher.mockResolvedValue({
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

  it("wrong password reported by the server action: message under Password, focused, input kept", async () => {
    loginTeacher.mockResolvedValue({
      ok: false,
      code: "AUTH_INCORRECT_PASSWORD",
      error: formatMessage("AUTH_INCORRECT_PASSWORD"),
    });
    openTeacherSignIn();
    typeAndSubmit();

    const alert = await screen.findByText(/Incorrect password/);
    expect(alert.id).toBe("teacherPassword-error");
    expect(passwordInput().getAttribute("aria-invalid")).toBe("true");
    expect(passwordInput().getAttribute("aria-describedby")).toBe("teacherPassword-error");
    await waitFor(() => expect(document.activeElement).toBe(passwordInput()));
    expect(passwordInput().value).toBe("hunter22");
    expect(loginTeacher).toHaveBeenCalledTimes(1);
  });

  it("rate limiting is shown above the button, never as a wrong password", async () => {
    loginTeacher.mockResolvedValue({
      ok: false,
      code: "AUTH_PROVIDER_RATE_LIMITED",
      error: formatMessage("AUTH_PROVIDER_RATE_LIMITED"),
    });
    openTeacherSignIn();
    typeAndSubmit();

    const alert = await screen.findByText(/no need to reset it/);
    expect(alert.id).toBe("login-form-error");
    expect(screen.queryByText(/Incorrect password/)).toBeNull();
    expect(passwordInput().getAttribute("aria-invalid")).toBeNull();
    expect(passwordInput().value).toBe("hunter22");
  });

  it("going offline while the request is in flight says no internet, not a wrong password", async () => {
    loginTeacher.mockImplementation(async () => {
      Object.defineProperty(window.navigator, "onLine", { value: false, configurable: true });
      throw new TypeError("Failed to fetch");
    });
    openTeacherSignIn();
    typeAndSubmit();

    expect(await screen.findByText(/No internet connection/)).toBeTruthy();
    expect(screen.queryByText(/Incorrect password/)).toBeNull();
  });

  it("does not print 'No schools found' when the list failed to load", () => {
    render(<LoginForm schools={[]} notice="Couldn't load schools." />);
    expect(screen.getByText("Couldn't load schools.")).toBeTruthy();
    expect(screen.queryByText(/No schools found/)).toBeNull();
  });
});
