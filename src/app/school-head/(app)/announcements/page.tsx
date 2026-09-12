import { prisma } from "@/lib/prisma";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";
import { resolveSchoolHeadView } from "@/lib/school-head/view";
import { SchoolHeadPage } from "@/components/school-head/school-head-page";
import { Surface, SurfaceHeader, SurfaceBody } from "@/components/ui/surface";
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
  const { view } = await resolveSchoolHeadView(
    params.schoolId,
    SCHOOL_HEAD_ROUTES.announcements
  );

  const announcements = await prisma.announcement.findMany({
    where: { schoolId: view.schoolId, deletedAt: null },
    orderBy: { publishedAt: "desc" },
    include: { author: { select: { fullName: true } } },
  });

  return (
    <SchoolHeadPage
      title="Announcements"
      description="School notices for teachers and staff."
      view={view}
      // The compose form and the published list are peers, so they share one grid
      // rather than stacking. `contentClassName` replaces the frame's default
      // `space-y-6`, which is what we want here — the grid owns the gaps.
      contentClassName="grid gap-6 lg:grid-cols-2"
    >
      {!view.isSuperAdminView ? (
        <Surface as="section">
          <SurfaceHeader>
            <h2 className="text-base font-semibold">Post an announcement</h2>
          </SurfaceHeader>
          <SurfaceBody>
            <CreateAnnouncementForm />
          </SurfaceBody>
        </Surface>
      ) : null}

      <Surface
        as="section"
        className={view.isSuperAdminView ? "lg:col-span-2" : undefined}
      >
        <SurfaceHeader>
          <h2 className="text-base font-semibold">Published</h2>
        </SurfaceHeader>
        <SurfaceBody>
          {announcements.length === 0 ? (
            <EmptyState
              title="No announcements yet"
              description={
                view.isSuperAdminView
                  ? "Notices published by this School Head will appear here."
                  : "Write your first notice in the form beside this list."
              }
              icon={Megaphone}
            />
          ) : (
            <AnnouncementsList
              readOnly={view.isSuperAdminView}
              announcements={announcements.map((a) => ({
                id: a.id,
                title: a.title,
                body: a.body,
                authorName: a.author.fullName,
                publishedAt: a.publishedAt.toISOString().slice(0, 10),
              }))}
            />
          )}
        </SurfaceBody>
      </Surface>
    </SchoolHeadPage>
  );
}
