import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { resolveSchoolContext } from "@/lib/school-context";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/dashboard/empty-state";
import {
  CreateAnnouncementForm,
  AnnouncementActions,
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

  const [announcements, school] = await Promise.all([
    prisma.announcement.findMany({
      where: { schoolId, deletedAt: null },
      orderBy: { publishedAt: "desc" },
      include: { author: { select: { fullName: true } } },
    }),
    prisma.school.findUnique({ where: { id: schoolId }, select: { name: true } }),
  ]);

  return (
    <AppShell
      title={isSuperAdminView ? `Announcements — ${school?.name ?? ""}` : "Announcements"}
      subtitle="School notices for teachers and staff"
      role={user.role}
      userName={user.fullName || `${user.firstName} ${user.lastName}`}
      schoolName={school?.name}
      isSuperAdminView={isSuperAdminView}
      viewedSchoolName={school?.name}
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
              <ul className="space-y-4">
                {announcements.map((a) => (
                  <li key={a.id} className="rounded-lg border border-border/80 p-4">
                    <h3 className="font-semibold">{a.title}</h3>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                      {a.body}
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {a.author.fullName} · {a.publishedAt.toISOString().slice(0, 10)}
                    </p>
                    {!isSuperAdminView ? (
                      <AnnouncementActions
                        announcementId={a.id}
                        title={a.title}
                        body={a.body}
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
