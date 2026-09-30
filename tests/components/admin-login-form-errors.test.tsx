import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AdminLoginForm } from "@/components/forms/admin-login-form";

const loginAdmin = vi.fn();

vi.mock("@/lib/actions/auth", () => ({
  loginAdmin: (...args: unknown[]) => loginAdmin(...args),
}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
}));

afterEach(cleanup);

describe("AdminLoginForm failures", () => {
  it("wrong username or password marks both fields and prints one message", async () => {
    const message = "Incorrect username or password.";
    loginAdmin.mockResolvedValue({
      ok: false,
      code: "AUTH_INCORRECT_CREDENTIALS",
      error: message,
      fieldErrors: { username: message, password: message },
    });
    render(<AdminLoginForm />);
    const username = screen.getByLabelText(/Username/) as HTMLInputElement;
    const password = screen.getByLabelText(/Password/) as HTMLInputElement;
    fireEvent.change(username, { target: { value: "division.admin" } });
    fireEvent.change(password, { target: { value: "Passw0rd123" } });
    fireEvent.submit(username.closest("form")!);

    await waitFor(() => expect(screen.getAllByText(message)).toHaveLength(1));
    const alert = screen.getByText(message);
    expect(username.getAttribute("aria-invalid")).toBe("true");
    expect(password.getAttribute("aria-invalid")).toBe("true");
    expect(username.getAttribute("aria-describedby")).toBe(alert.id);
    expect(password.getAttribute("aria-describedby")).toBe(alert.id);
    expect(username.value).toBe("division.admin");
    expect(password.value).toBe("Passw0rd123");
  });

  it("offline: no server call and the No internet message shows", async () => {
    Object.defineProperty(window.navigator, "onLine", { value: false, configurable: true });
    try {
      loginAdmin.mockClear();
      render(<AdminLoginForm />);
      const username = screen.getByLabelText(/Username/) as HTMLInputElement;
      fireEvent.change(username, { target: { value: "division.admin" } });
      fireEvent.change(screen.getByLabelText(/Password/), { target: { value: "Passw0rd123" } });
      fireEvent.submit(username.closest("form")!);

      expect(await screen.findByText(/No internet connection/)).toBeTruthy();
      expect(loginAdmin).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true });
    }
  });
});
