import { ArrowRight, MapPin } from "lucide-react";
import { PrefetchLink } from "@/components/nav/prefetch-link";
import { Surface } from "@/components/ui/surface";
import { DISTRICT_ROUTES, type DistrictSummaryFacetId } from "@/lib/routes/district";
import { NO_DISTRICT_LABEL } from "@/lib/summary/shape/rollup";

export type DistrictCard = {
  /** Null groups the schools with no district recorded. */
  district: string | null;
  schoolCount: number;
  activeCount: number;
};

const QUICK_LINKS: { facet: DistrictSummaryFacetId; label: string }[] = [
  { facet: "learners", label: "Learners" },
  { facet: "attendance", label: "Attendance" },
  { facet: "compliance", label: "Compliance" },
];

function schoolCountLabel(count: number): string {
  return count === 1 ? "1 school" : `${count.toLocaleString("en-PH")} schools`;
}

/** Quick links for one district; none for the "No district" bucket, which no summary filter can select. */
export function districtQuickLinks(district: string | null): { href: string; label: string }[] {
  if (district === null) return [];
  const q = encodeURIComponent(district);
  return [
    ...QUICK_LINKS.map((link) => ({
      label: link.label,
      href: `${DISTRICT_ROUTES.summary(link.facet)}?district=${q}`,
    })),
    { label: "Schools", href: `${DISTRICT_ROUTES.schools}?q=${q}` },
  ];
}

const PILL =
  "inline-flex min-h-10 items-center rounded-full bg-blue-50 px-3 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-blue-950/40 dark:text-blue-200 dark:hover:bg-blue-900/50 lg:min-h-8";

/**
 * One card per district in the admin's scope: school count, how many are
 * active, and links straight into that district's summaries. Styled like the
 * School Head dashboard's panels (icon tile, rounded-2xl surface).
 */
export function DistrictsPanel({
  title,
  districts,
  totalSchools,
}: {
  title: string;
  districts: readonly DistrictCard[];
  totalSchools: number;
}) {
  return (
    <Surface as="section" aria-labelledby="district-list-title" className="min-w-0 rounded-2xl">
      <div className="flex flex-wrap items-center gap-3 px-4 pt-4 sm:px-5">
        <span
          aria-hidden
          className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200"
        >
          <MapPin className="size-5" />
        </span>
        <h2 id="district-list-title" className="min-w-0 flex-1 text-base font-semibold tracking-tight text-foreground sm:text-lg">
          {title}
        </h2>
        <PrefetchLink
          href={DISTRICT_ROUTES.schools}
          prefetch
          className="inline-flex min-h-10 items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:min-h-0"
        >
          {schoolCountLabel(totalSchools)} in all
          <ArrowRight aria-hidden className="size-4" />
        </PrefetchLink>
      </div>

      {districts.length === 0 ? (
        <p className="px-4 pb-5 pt-3 text-sm text-muted-foreground sm:px-5">
          No schools are recorded in your scope yet.
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 px-4 pb-4 pt-3 sm:grid-cols-2 sm:px-5 sm:pb-5 2xl:grid-cols-3">
          {districts.map((item) => {
            const label = item.district ?? NO_DISTRICT_LABEL;
            const links = districtQuickLinks(item.district);
            const inactive = item.schoolCount - item.activeCount;
            return (
              <li
                key={label}
                className="flex min-w-0 flex-col rounded-xl border border-border/70 bg-muted/20 p-3 sm:p-4"
              >
                <p className="truncate font-semibold text-foreground">{label}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {schoolCountLabel(item.schoolCount)}
                  {inactive > 0 ? ` · ${inactive} inactive` : ""}
                </p>
                {links.length > 0 ? (
                  <ul aria-label={`Summaries for ${label}`} className="mt-3 flex flex-wrap gap-2">
                    {links.map((link) => (
                      <li key={link.label}>
                        <PrefetchLink href={link.href} prefetch className={PILL}>
                          {link.label}
                        </PrefetchLink>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </Surface>
  );
}
