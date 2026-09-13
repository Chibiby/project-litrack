import "server-only";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/session";
import { isSyntheticEmail } from "@/lib/auth/synthetic-email";
import { AppError } from "@/lib/errors/app-error";

export type AdminEmailRecipientOption = {
  id: string;
  email: string;
  name: string;
  role: "Teacher" | "School Head";
  schoolName: string;
};

export async function listAdminEmailRecipients(): Promise<AdminEmailRecipientOption[]> {
  const user = await requireUser();
  if (user.role !== "SUPER_ADMIN") {
    throw new AppError("AUTH_FORBIDDEN", { params: { what: "admin email" } });
  }

  const people = await prisma.user.findMany({
    where: { role: { in: ["TEACHER", "SCHOOL_HEAD"] }, isActive: true, deletedAt: null },
    orderBy: [{ school: { name: "asc" } }, { lastName: "asc" }, { firstName: "asc" }],
    select: {
      id: true,
      email: true,
      fullName: true,
      firstName: true,
      lastName: true,
      role: true,
      school: { select: { name: true } },
    },
  });

  return people
    .filter((person) => !isSyntheticEmail(person.email))
    .map((person) => ({
      id: person.id,
      email: person.email.toLowerCase(),
      name: person.fullName?.trim() || `${person.firstName ?? ""} ${person.lastName ?? ""}`.trim() || person.email,
      role: person.role === "SCHOOL_HEAD" ? "School Head" : "Teacher",
      schoolName: person.school?.name ?? "No school",
    }));
}
