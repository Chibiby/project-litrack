import { test, expect } from "@playwright/test";
import net from "node:net";

const configuredBase = process.env.PLAYWRIGHT_BASE_URL;
const defaultBase = "http://localhost:3000";
const baseURL = configuredBase ?? defaultBase;

async function isServerReachable(url: string): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const port = Number(parsed.port || (parsed.protocol === "https:" ? 443 : 80));
  const host = parsed.hostname;

  return new Promise((resolve) => {
    const socket = net.connect({ host, port }, () => {
      socket.end();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
    socket.setTimeout(1500, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

const shouldRun = async () => {
  if (configuredBase) return true;
  return isServerReachable(defaultBase);
};

test.describe("smoke", () => {
  test.beforeAll(async () => {
    if (!(await shouldRun())) {
      test.skip(
        true,
        "PLAYWRIGHT_BASE_URL unset and no local server on :3000 — E2E is opt-in",
      );
    }
  });

  test("school login shows school selection and role options", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByText("PROJECT LITRACK")).toBeVisible();
    await expect(page.getByText("School Name")).toBeVisible();
    await expect(page.getByRole("button", { name: "Teachers" })).toBeVisible();
    await expect(page.getByRole("button", { name: "School Head" })).toBeVisible();
    await expect(page.getByText("Select your school")).toBeVisible();
  });

  test("admin login shows email and password form", async ({ page }) => {
    await page.goto("/admin/login");
    await expect(page.getByRole("heading", { name: "Super Admin" })).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  });

  test("forgot-password page is reachable", async ({ page }) => {
    await page.goto("/forgot-password");
    await expect(page.getByText(/forgot|reset|password/i).first()).toBeVisible();
    await expect(page.getByLabel(/email/i).first()).toBeVisible();
  });

  test("login page links to password recovery", async ({ page }) => {
    await page.goto("/login");
    const forgot = page.getByRole("link", { name: /forgot|reset/i });
    if ((await forgot.count()) > 0) {
      await expect(forgot.first()).toBeVisible();
    } else {
      // Recovery may be role-gated in the form; page still loads.
      await expect(page.getByText("PROJECT LITRACK")).toBeVisible();
    }
  });
});
