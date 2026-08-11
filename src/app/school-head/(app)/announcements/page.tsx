import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getSchoolName } from "@/lib/cache/school";
import { prisma } from "@/lib/prisma";
import { resolveSchoolContext } from "@/lib/school-context";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/dashboard/empty-state";
import {
  CreateAnnouncementForm,
  AnnouncementsList,
} from "@/components/school-head/announcement-forms";
import { Megaphone } from "lucide-react";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ schoolId?: string }>;
}

export default async function AnnouncementsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const user = await requireUser("SCHOOL_HEAD");
  if (!user.profileCompleted && user.role !== "SUPER_ADMIN") redirect("/school-head/profiling");

  const { schoolId, isSuperAdminView } = await resolveSchoolContext(
    user,
    params.schoolId,
    "/school-head/announcements"
  );

  const [announcements, schoolName] = await Promise.all([
    prisma.announcement.findMany({
      where: { schoolId, deletedAt: null },
      orderBy: { publishedAt: "desc" },
      include: { author: { select: { fullName: true } } },
    }),
    getSchoolName(schoolId),
  ]);

  return (
    <AppShell
      title={isSuperAdminView ? `Announcements — ${schoolName ?? ""}` : "Announcements"}
      subtitle="School notices for teachers and staff"
      role={user.role}
      userName={user.fullName || `${user.firstName} ${user.lastName}`}
      schoolName={schoolName ?? undefined}
      isSuperAdminView={isSuperAdminView}
      viewedSchoolName={schoolName ?? undefined}
    >
      <div className="grid gap-6 lg:grid-cols-2">
        {!isSuperAdminView ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">New announcement</CardTitle>
            </CardHeader>
            <CardContent>
              <CreateAnnouncementForm />
            </CardContent>
          </Card>
        ) : null}

        <Card className={isSuperAdminView ? "lg:col-span-2" : undefined}>
          <CardHeader>
            <CardTitle className="text-base">Published</CardTitle>
          </CardHeader>
          <CardContent>
            {announcements.length === 0 ? (
              <EmptyState
                title="No announcements"
                description="Publish a notice for your school."
                icon={Megaphone}
              />
            ) : (
              <AnnouncementsList
                readOnly={isSuperAdminView}
                announcements={announcements.map((a) => ({
                  id: a.id,
                  title: a.title,
                  body: a.body,
                  authorName: a.author.fullName,
                  publishedAt: a.publishedAt.toISOString().slice(0, 10),
                }))}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
