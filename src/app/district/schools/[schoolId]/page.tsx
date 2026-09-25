import Link from "next/link";
import { notFound } from "next/navigation";
import {
  BarChart3,
  Building2,
  ChevronLeft,
  ChevronRight,
  KeyRound,
  Power,
  type LucideIcon,
} from "lucide-react";
import { requireAdminScope, loadSchoolInScope } from "@/lib/auth/district-scope";
import { isAppError } from "@/lib/errors/app-error";
import { reportError } from "@/lib/errors/report";
import { DISTRICT_ROUTES, DISTRICT_SUMMARY_FACETS } from "@/lib/routes/district";
import { cn } from "@/lib/utils";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface";
import { SchoolActiveToggle } from "@/components/admin/school-active-toggle";
import { DistrictSchoolForm } from "@/components/district/district-school-form";
import { SchoolHeadReset } from "@/components/district/school-head-reset";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ schoolId: string }>;
}

const SCHOOL_SELECT = {
  id: true,
  name: true,
  schoolIdCode: true,
  address: true,
  region: true,
  division: true,
  district: true,
  isActive: true,
} as const;

const TILE = {
  primary: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200",
  emerald: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200",
  amber: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-200",
  neutral: "bg-muted text-muted-foreground",
} as const;

/** Icon tile, title and optional line under it — the dashboard panels' header. */
function PanelHeader({
  id,
  icon: Icon,
  tone,
  title,
  description,
}: {
  id: string;
  icon: LucideIcon;
  tone: keyof typeof TILE;
  title: string;
  description?: string;
}) {
  return (
    <div className="flex items-start gap-3 border-b border-border/60 px-4 py-4 sm:px-5">
      <span
        aria-hidden
        className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl", TILE[tone])}
      >
        <Icon className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <h2 id={id} className="text-base font-semibold tracking-tight text-foreground">
          {title}
        </h2>
        {description ? <p className="mt-0.5 text-sm text-muted-foreground">{description}</p> : null}
      </div>
    </div>
  );
}

export default async function DistrictSchoolPage({ params }: PageProps) {
  const { user, scope } = await requireAdminScope();
  const { schoolId } = await params;

  let school;
  try {
    school = await loadSchoolInScope(scope, schoolId, SCHOOL_SELECT);
  } catch (err) {
    if (isAppError(err) && err.code === "NOT_FOUND") {
      // Out-of-scope ids look exactly like missing ones to the person; only
      // the admin error log (severity `security`) tells the two apart.
      if (err.severity === "security") {
        reportError(err, { route: "/district/schools/[schoolId]", routeType: "render" });
      }
      notFound();
    }
    throw err;
  }

  return (
    <AppShell
      title={school.name}
      subtitle={`School ID ${school.schoolIdCode}${school.district ? ` · ${school.district}` : ""}`}
      role={user.role}
      userName={user.fullName || user.email}
      actions={
        <Button asChild variant="outline" size="sm" className="sm:h-10 lg:h-9">
          <Link href={DISTRICT_ROUTES.schools}>
            <ChevronLeft aria-hidden />
            All schools
          </Link>
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Surface as="section" aria-labelledby="school-details-title" className="min-w-0 rounded-2xl">
          <PanelHeader
            id="school-details-title"
            icon={Building2}
            tone="primary"
            title="School details"
            description="Name, address and where the school sits in the division."
          />
          <div className="p-4 sm:p-5">
            <DistrictSchoolForm
              school={school}
              canEditPlacement={scope.kind === "division"}
            />
          </div>
        </Surface>

        {/* Two-up on tablets, where the details form spans the page above;
            a single rail beside the form from xl. */}
        <div className="grid min-w-0 grid-cols-1 content-start gap-6 md:grid-cols-2 xl:grid-cols-1">
          <Surface as="section" aria-labelledby="school-status-title" className="min-w-0 rounded-2xl">
            <PanelHeader
              id="school-status-title"
              icon={Power}
              tone={school.isActive ? "emerald" : "neutral"}
              title="Status"
              description="While a school is inactive, nobody from it can sign in."
            />
            <div className="flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5">
              {school.isActive ? (
                <Badge className="bg-primary/10 text-primary hover:bg-primary/10">Active</Badge>
              ) : (
                <Badge variant="secondary">Inactive</Badge>
              )}
              <SchoolActiveToggle
                schoolId={school.id}
                isActive={school.isActive}
                schoolName={school.name}
                className="sm:h-10 lg:h-9"
              />
            </div>
          </Surface>

          <Surface as="section" aria-labelledby="school-head-title" className="min-w-0 rounded-2xl">
            <PanelHeader id="school-head-title" icon={KeyRound} tone="amber" title="School Head sign-in" />
            <div className="p-4 sm:p-5">
              <SchoolHeadReset schoolId={school.id} schoolName={school.name} />
            </div>
          </Surface>

          <Surface
            as="section"
            aria-labelledby="school-figures-title"
            className="min-w-0 rounded-2xl md:col-span-2 xl:col-span-1"
          >
            <PanelHeader id="school-figures-title" icon={BarChart3} tone="primary" title="This school's figures" />
            <ul className="grid grid-cols-1 p-2 sm:p-3 md:grid-cols-2 xl:grid-cols-1">
              {DISTRICT_SUMMARY_FACETS.map((facet) => (
                <li key={facet.id} className="min-w-0">
                  <Link
                    href={`${DISTRICT_ROUTES.summary(facet.id)}?schoolId=${school.id}`}
                    className="flex min-h-11 items-center justify-between gap-2 rounded-lg px-3 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-10"
                  >
                    <span className="min-w-0 truncate">{facet.label}</span>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </Surface>
        </div>
      </div>
    </AppShell>
  );
}
