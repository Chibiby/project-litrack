import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireUser, findMany } = vi.hoisted(() => ({ requireUser: vi.fn(), findMany: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findMany } } }));

import { listAdminEmailRecipients } from "@/lib/admin-email/queries";

beforeEach(() => {
  requireUser.mockReset().mockResolvedValue({ id: "admin", role: "SUPER_ADMIN" });
  findMany.mockReset().mockResolvedValue([
    { id: "1", email: "teacher@example.com", fullName: "Ana Teacher", firstName: "Ana", lastName: "Teacher", role: "TEACHER", school: { name: "North School" } },
    { id: "2", email: "head@school.local", fullName: "Hidden Head", firstName: "Hidden", lastName: "Head", role: "SCHOOL_HEAD", school: { name: "North School" } },
  ]);
});

describe("listAdminEmailRecipients", () => {
  it("returns only real active staff addresses", async () => {
    await expect(listAdminEmailRecipients()).resolves.toEqual([
      { id: "1", email: "teacher@example.com", name: "Ana Teacher", role: "Teacher", schoolName: "North School" },
    ]);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { role: { in: ["TEACHER", "SCHOOL_HEAD"] }, isActive: true, deletedAt: null },
    }));
  });

  it("refuses non-admin users before reading recipients", async () => {
    requireUser.mockResolvedValue({ id: "teacher", role: "TEACHER" });
    await expect(listAdminEmailRecipients()).rejects.toMatchObject({ code: "AUTH_FORBIDDEN" });
    expect(findMany).not.toHaveBeenCalled();
  });
});
