import { CalendarRange } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { listDistrictOptions } from "@/lib/admin/management";
import { AdminPage } from "@/components/admin/admin-page";
import { SchoolHeadHero } from "@/components/school-head/school-head-hero";
import { districtField } from "@/components/admin/management/filter-fields";
import type { ListFilterField } from "@/components/admin/management/list-filter-bar";
import {
  AdminSchoolYearsTable,
  type AdminSchoolYearRow,
} from "@/components/admin/school-years-table";
import { CreateDivisionSchoolYearDialog } from "@/components/school-head/school-year-forms";
import { toMonthKey } from "@/lib/school-year/months";
import { DivisionDurationPanel, type DurationRow } from "@/components/admin/division-duration";
import { evaluateWindow } from "@/lib/school-year/window";
import { formatLocalDateKey, schoolToday } from "@/lib/date-keys";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

interface PageProps {
  searchParams: Promise<{ q?: string; district?: string; status?: string; page?: string }>;
}

/** "2027-2028" from the newest label any school has, else from today. */
function nextLabel(labels: string[]): string {
  const starts = labels.map((l) => Number(l.slice(0, 4))).filter((n) => Number.isFinite(n));
  const next = starts.length ? Math.max(...starts) + 1 : new Date().getFullYear();
  return `${next}-${next + 1}`;
}

export default async function AdminSchoolYearsPage({ searchParams }: PageProps) {
  const user = await requireUser("SUPER_ADMIN");
  const params = await searchParams;
  const q = (params.q ?? "").trim();
  const district = (params.district ?? "").trim();
  const status = params.status === "active" || params.status === "inactive" ? params.status : "";
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  const where: Prisma.SchoolYearWhereInput = {
    school: {
      deletedAt: null,
      ...(q ? { name: { contains: q, mode: "insensitive" } } : {}),
      ...(district ? { district } : {}),
    },
    ...(status ? { isActive: status === "active" } : {}),
  };

  const [rows, totalCount, activeCount, liveSchools, schoolsWithActive, labels, districts] =
    await Promise.all([
      prisma.schoolYear.findMany({
        where,
        orderBy: [{ school: { name: "asc" } }, { startDate: "desc" }],
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        select: {
          id: true,
          label: true,
          startDate: true,
          endDate: true,
          isActive: true,
          school: { select: { id: true, name: true, district: true } },
          _count: { select: { enrollments: { where: { status: "ACTIVE" } } } },
        },
      }),
      prisma.schoolYear.count({ where }),
      prisma.schoolYear.count({ where: { isActive: true, school: { deletedAt: null } } }),
      prisma.school.count({ where: { deletedAt: null } }),
      prisma.school.count({ where: { deletedAt: null, schoolYears: { some: { isActive: true } } } }),
      prisma.schoolYear.groupBy({
        by: ["label"],
        where: { school: { deletedAt: null } },
        _count: { _all: true },
      }),
      listDistrictOptions(),
    ]);
  const windows = await prisma.divisionSchoolYear.findMany();
  const todayKey = formatLocalDateKey(schoolToday());
  const durationRows: DurationRow[] = labels
    .map((l) => {
      const w = windows.find((x) => x.label === l.label) ?? null;
      const state = evaluateWindow(w, todayKey);
      return {
        label: l.label,
        startMonth: w ? toMonthKey(w.activeStart) : null,
        endMonth: w ? toMonthKey(w.activeEnd) : null,
        state: !w ? "NOT_SET" : state.open ? "OPEN" : state.reason === "NOT_STARTED" ? "NOT_STARTED" : "ENDED",
        isLastMonth: state.isLastMonth,
        schools: l._count._all,
      } satisfies DurationRow;
    })
    .sort((a, b) => b.label.localeCompare(a.label));

  const items: AdminSchoolYearRow[] = rows.map((y) => ({
    id: y.id,
    schoolId: y.school.id,
    schoolName: y.school.name,
    district: y.school.district,
    label: y.label,
    startMonth: toMonthKey(y.startDate),
    endMonth: y.endDate ? toMonthKey(y.endDate) : null,
    isActive: y.isActive,
    enrolled: y._count.enrollments,
  }));

  const filters: ListFilterField[] = [
    districtField(districts, district || undefined),
    {
      key: "status",
      label: "Status",
      allLabel: "Active and inactive",
      value: status,
      options: [
        { value: "active", label: "Active" },
        { value: "inactive", label: "Inactive" },
      ],
    },
  ];

  const missing = liveSchools - schoolsWithActive;

  return (
    <AdminPage
      title="School years"
      role={user.role}
      userName={user.fullName || user.email}
      hero={
        <SchoolHeadHero
          eyebrow="Calendar"
          eyebrowIcon={CalendarRange}
          title="School years"
          subtitle="You create each school year for every school at once. School Heads set when it starts and ends at their school."
          meta={`${activeCount.toLocaleString()} active · ${liveSchools.toLocaleString()} schools${
            missing > 0 ? ` · ${missing.toLocaleString()} without an active year` : ""
          }`}
          topRight={<CreateDivisionSchoolYearDialog suggestedLabel={nextLabel(labels.map((l) => l.label))} />}
        />
      }
    >
      <DivisionDurationPanel rows={durationRows} />
      <AdminSchoolYearsTable
        rows={items}
        filters={filters}
        list={{
          q,
          page,
          pageSize: PAGE_SIZE,
          totalCount,
          totalPages: Math.max(1, Math.ceil(totalCount / PAGE_SIZE)),
        }}
      />
    </AdminPage>
  );
}
