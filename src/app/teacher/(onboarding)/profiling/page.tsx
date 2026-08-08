import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { isSyntheticEmail } from "@/lib/auth/synthetic-email";
import { TeacherProfileForm } from "@/components/forms/teacher-profile-form";

export const dynamic = "force-dynamic";

export default async function TeacherProfilingPage() {
  const user = await requireUser("TEACHER");
  const profile = await prisma.teacherProfile.findUnique({ where: { userId: user.id } });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
          Teacher Profiling
        </h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Complete this to start adding learners
        </p>
      </div>
      <TeacherProfileForm
        defaultValues={{
          firstName: user.firstName,
          middleName: user.middleName ?? "",
          lastName: user.lastName,
          accountEmail: user.email,
          accountEmailIsSynthetic: isSyntheticEmail(user.email),
          ...(profile ?? {}),
        }}
      />
    </div>
  );
}
