import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { TERM_PERIODS } from "@/lib/terms/windows";
import { cn } from "@/lib/utils";

/**
 * Busy state for the three ARAL weekly/monthly grid sheets.
 *
 * Two entry points, one drawing. `AralGridSkeleton` (via the three presets) is
 * the sheet on its own, handed to each page's `<Suspense fallback>`; the three
 * `*RouteSkeleton` exports wrap that same preset in the gutter and title block
 * and are what each route's `loading.tsx` renders.
 *
 * The split is the padding contract. `loading.tsx` replaces the page whole,
 * `AppShell` included, so it owns the gutter and has to draw the title block
 * itself. The fallback lands *inside* `AppShell`'s already-padded
 * `<main className="w-full p-4 lg:p-6">`, below a real `PageTitleBlock` — so the
 * bare preset must carry neither. Give padding to the shared piece instead and
 * one of the two paths double-pads; draw no title block in the boundary and the
 * grid sits ~60px too high, then jumps down the moment the page streams. That
 * jump is the regression this file exists to prevent, so the geometry below
 * mirrors `PageTitleBlock` line for line rather than approximating it.
 *
 * `TableSectionSkeleton` is deliberately not reused here. It draws every column
 * as an equal `flex-1` bar, and these grids are the opposite shape: a 2.5rem
 * index, a 180–200px learner name, then a long run of narrow numeric cells. The
 * equal-width version put its widest bar where the narrowest cell lands, so the
 * handover visibly reflowed.
 *
 * Server-safe and CSS-only — no `"use client"`, so it costs no client JS.
 */

/** The violet banner shell both grid sheets open with. */
const BANNER_SHELL =
  "mb-4 rounded-xl border border-violet-200 bg-violet-50/70 p-4 dark:border-violet-900/60 dark:bg-violet-950/30";

/** Matches `AralDateNav`'s own container and the term sheet's plain toolbar. */
const CARD_HEADER =
  "flex flex-wrap items-center gap-3 border-b border-border/60 p-4";

export type AralGridBanner = "items" | "progress" | "chips" | "none";

/**
 * Which control bar sits above the grid.
 *
 * `week-nav` and `month-nav` are both `AralDateNav`, but they are not the same
 * row: the weekly sheet passes `navLabels`, so prev/next are wide labelled
 * buttons, and it puts the Filter popover in `actions` on the right. The monthly
 * sheet leaves `navLabels` off — prev/next are square icon buttons — and keeps
 * Filter on the left in `filter`, followed by its facet selects. One shared
 * variant drew the monthly row with 130px navigation buttons it does not have.
 */
export type AralGridHeader = "week-nav" | "month-nav" | "toolbar";

export interface AralGridSkeletonProps {
  /** Roster rows drawn. Matches the default page size closely enough to fill. */
  rows?: number;
  /** `min-w` of the learner-name column, mirroring the grid's own value. */
  nameWidth?: number;
  /** Attendance carries a Section column between the name and the day cells. */
  sectionColumn?: boolean;
  /** The repeating narrow block: 7 days, 5 reading scales, 8 subjects. */
  dataColumns?: number;
  /** `min-w` of one cell in that block (68 days / 84 scales / 104 subjects). */
  dataColumnWidth?: number;
  /** Narrow columns after the block — P/A/E/%, Remarks+Actions, or Average. */
  tailColumns?: number;
  /** A wide free-text column closing the row (attendance's Remarks). */
  trailingWide?: boolean;
  /** Two header rows, for the term sheet's `colgroup` grouping. */
  groupedHeader?: boolean;
  header?: AralGridHeader;
  banner?: AralGridBanner;
  /** Violet cards below the grid. */
  infoCards?: 0 | 1 | 2;
  /** A single full-width violet card above the grid (the term sheet's lock note). */
  leadInfoCard?: boolean;
  /** The `LearnerListFooter` pager. Attendance has none — it does not paginate. */
  footer?: boolean;
  className?: string;
}

/** One violet info card — icon tile, title line, body line. */
function InfoCardSkeleton() {
  return (
    <div
      className="flex gap-3 rounded-xl border border-violet-200 bg-violet-50/70 p-4 dark:border-violet-900/60 dark:bg-violet-950/30"
      data-slot="info-card-skeleton"
    >
      <Skeleton className="size-9 shrink-0 rounded-lg" />
      <div className="min-w-0 flex-1">
        <Skeleton className="h-4 w-[45%]" />
        <Skeleton className="mt-2 h-3.5 w-[85%]" />
      </div>
    </div>
  );
}

/** The three-up status banner the attendance sheet opens with. */
function BannerItems() {
  return (
    <section className={BANNER_SHELL} data-slot="aral-grid-banner" aria-hidden>
      <div className="grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex gap-2">
            <Skeleton className="mt-1 size-2.5 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1">
              <Skeleton className="h-4 w-[60%]" />
              <Skeleton className="mt-2 h-3.5 w-[90%]" />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Status text, a progress bar, and three stat tiles — the monthly banner. */
function BannerProgress() {
  return (
    <section className={BANNER_SHELL} data-slot="aral-grid-banner" aria-hidden>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-5 w-20 rounded-full" />
          </div>
          <Skeleton className="mt-2 h-3.5 w-[90%]" />
        </div>

        <div className="min-w-0">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="mt-2 h-4 w-[70%]" />
          <Skeleton className="mt-2 h-2 w-full rounded-full" />
        </div>

        <div className="flex flex-wrap gap-2 md:col-span-2 xl:col-span-1">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-24 rounded-lg" />
          ))}
        </div>
      </div>
    </section>
  );
}

/**
 * The term switcher — an eyebrow over a row of two-line chip buttons.
 *
 * The count comes from `TERM_PERIODS`, not a literal: the sheet renders one chip
 * per term window, so a fourth term would add a chip here and a hardcoded number
 * would quietly draw the wrong row.
 */
function BannerChips() {
  return (
    <section className="mb-4" data-slot="aral-grid-banner" aria-hidden>
      <Skeleton className="h-3 w-20" />
      <div className="mt-2 flex flex-wrap gap-2">
        {TERM_PERIODS.map((term) => (
          <Skeleton key={term} className="h-12 w-[8.5rem] rounded-lg" />
        ))}
      </div>
    </section>
  );
}

/**
 * `AralGridSkeleton` is exported for reuse, but the three presets below are the
 * intended entry points — they keep every column count in this file, so a route
 * never restates a number that belongs to the grid.
 */
export function AralGridSkeleton({
  rows = 8,
  nameWidth = 200,
  sectionColumn = false,
  dataColumns = 5,
  dataColumnWidth = 84,
  tailColumns = 1,
  trailingWide = false,
  groupedHeader = false,
  header = "week-nav",
  banner = "none",
  infoCards = 0,
  leadInfoCard = false,
  footer = false,
  className,
}: AralGridSkeletonProps) {
  // Widths come through `style` rather than `min-w-[…]`: Tailwind generates
  // arbitrary values by scanning source text, so a class built from a variable
  // is never emitted and the column would collapse.
  const nameStyle = { minWidth: nameWidth };
  const dataStyle = { minWidth: dataColumnWidth };

  return (
    <div className={className} data-slot="aral-grid-skeleton" aria-hidden>
      {banner === "items" ? <BannerItems /> : null}
      {banner === "progress" ? <BannerProgress /> : null}
      {banner === "chips" ? <BannerChips /> : null}

      {leadInfoCard ? (
        <div className="mb-4">
          <InfoCardSkeleton />
        </div>
      ) : null}

      <Card>
        <div className={CARD_HEADER} data-slot="aral-grid-header">
          {header === "week-nav" ? (
            <>
              {/* Labelled prev/next, the week-range picker between them. */}
              <Skeleton className="h-9 w-[150px] rounded-lg" />
              <Skeleton className="h-9 w-[282px] max-w-full rounded-md" />
              <Skeleton className="h-9 w-[130px] rounded-lg" />
              <div className="ml-auto flex items-center gap-2">
                <Skeleton className="h-9 w-[92px] rounded-lg" />
                <Skeleton className="h-9 w-[205px] rounded-lg" />
              </div>
            </>
          ) : null}

          {header === "month-nav" ? (
            <>
              {/* Icon-only prev/next — this nav omits `navLabels`. */}
              <Skeleton className="h-9 w-9 rounded-lg" />
              <Skeleton className="h-9 w-[205px] max-w-full rounded-md" />
              <Skeleton className="h-9 w-9 rounded-lg" />
              <Skeleton className="h-9 w-[92px] rounded-lg" />
              {/* Section and Gender facets; Section only when the grade has any. */}
              <Skeleton className="h-9 w-[150px] rounded-lg" />
              <Skeleton className="h-9 w-[150px] rounded-lg" />
              <div className="ml-auto flex items-center gap-2">
                <Skeleton className="h-9 w-[180px] rounded-lg" />
              </div>
            </>
          ) : null}

          {header === "toolbar" ? (
            <>
              <Skeleton className="h-9 w-[92px] rounded-lg" />
              <Skeleton className="h-9 w-full rounded-md sm:w-[16rem]" />
              <div className="ml-auto flex items-center gap-2">
                <Skeleton className="h-9 w-[104px] rounded-lg" />
                <Skeleton className="h-9 w-[132px] rounded-lg" />
              </div>
            </>
          ) : null}
        </div>

        <CardContent className="p-0">
          <div className="overflow-x-auto" data-slot="aral-grid-table">
            <div className="min-w-full">
              {groupedHeader ? (
                <div className="flex items-center gap-3 border-b border-border/60 px-4 py-3">
                  <Skeleton
                    className="h-3.5"
                    style={{ width: 40 + nameWidth }}
                  />
                  <Skeleton
                    className="h-3.5 flex-1"
                    style={{ minWidth: dataColumns * dataColumnWidth }}
                  />
                  <Skeleton className="h-3.5 w-[72px]" />
                </div>
              ) : null}

              <div className="flex items-center gap-3 border-b border-border/60 px-4 py-3">
                <Skeleton className="h-3.5 w-6" />
                <Skeleton className="h-3.5" style={nameStyle} />
                {sectionColumn ? <Skeleton className="h-3.5 w-[90px]" /> : null}
                {Array.from({ length: dataColumns }).map((_, i) => (
                  <Skeleton key={i} className="h-3.5 flex-1" style={dataStyle} />
                ))}
                {Array.from({ length: tailColumns }).map((_, i) => (
                  <Skeleton key={i} className="h-3.5 w-[64px]" />
                ))}
                {trailingWide ? (
                  <Skeleton className="h-3.5" style={{ minWidth: 180 }} />
                ) : null}
              </div>

              {Array.from({ length: rows }).map((_, row) => (
                <div
                  key={row}
                  className="flex items-center gap-3 border-b border-border/40 px-4 py-3 last:border-0"
                >
                  <Skeleton className="h-4 w-4" />
                  <Skeleton className="h-4" style={nameStyle} />
                  {sectionColumn ? <Skeleton className="h-4 w-[90px]" /> : null}
                  {Array.from({ length: dataColumns }).map((_, col) => (
                    <Skeleton
                      key={col}
                      className="h-8 flex-1 rounded-md"
                      style={dataStyle}
                    />
                  ))}
                  {Array.from({ length: tailColumns }).map((_, col) => (
                    <Skeleton key={col} className="h-4 w-[64px]" />
                  ))}
                  {trailingWide ? (
                    <Skeleton
                      className="h-8 rounded-md"
                      style={{ minWidth: 180 }}
                    />
                  ) : null}
                </div>
              ))}
            </div>
          </div>

          {footer ? (
            <div
              className="flex flex-col items-center gap-3 border-t border-border/60 px-4 py-3 md:flex-row md:justify-between"
              data-slot="aral-grid-footer"
            >
              <Skeleton className="h-4 w-[190px]" />
              <div className="flex items-center gap-1">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-8 rounded-md" />
                ))}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {infoCards > 0 ? (
        <div
          className={cn(
            "mt-4 grid gap-4",
            infoCards === 2 && "md:grid-cols-2"
          )}
        >
          {Array.from({ length: infoCards }).map((_, i) => (
            <InfoCardSkeleton key={i} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Weekly attendance: `#`, Learner, Section, seven day cells, Present/Absent/
 * Excused/Attendance %, then a wide Remarks column. No pager — the sheet loads
 * the whole ARAL roster for the grade.
 */
export function AralAttendanceSkeleton() {
  return (
    <AralGridSkeleton
      banner="items"
      header="week-nav"
      nameWidth={180}
      sectionColumn
      dataColumns={7}
      dataColumnWidth={68}
      tailColumns={4}
      trailingWide
      footer={false}
      infoCards={2}
    />
  );
}

/**
 * Monthly reading level: `#`, Learner, the five assessment scales, then
 * Remarks and Actions. Paginated, so it carries the roster pager.
 */
export function AralReadingLevelSkeleton() {
  return (
    <AralGridSkeleton
      banner="progress"
      header="month-nav"
      nameWidth={200}
      dataColumns={5}
      dataColumnWidth={84}
      tailColumns={2}
      footer
      infoCards={2}
    />
  );
}

/**
 * End of terms reports: the term switcher, the auto-lock note, then a grouped
 * two-row header over `#`, Complete Name, the eight learning areas, and the
 * General Average. Paginated; no trailing info cards.
 */
export function AralTermGradesSkeleton() {
  return (
    <AralGridSkeleton
      banner="chips"
      header="toolbar"
      nameWidth={200}
      dataColumns={8}
      dataColumnWidth={104}
      tailColumns={1}
      groupedHeader
      footer
      infoCards={0}
      leadInfoCard
    />
  );
}

/** One header action pill. `tall` marks the default-size trigger (h-10 vs h-9). */
interface AralRouteAction {
  width: number;
  tall?: boolean;
}

/** `size="sm"` cross-links, at roughly their rendered label widths. */
const LINK_ATTENDANCE = 165; // "Weekly attendance"
const LINK_READING = 190; // "Monthly reading level"
const LINK_TERMS = 185; // "End of terms reports"

/**
 * "Enroll to ARAL" — the one default-size button in these headers, and the one
 * an adviser sees but a Super Admin does not. Drawing it unconditionally costs a
 * Super Admin one extra pill's width in a `justify-between` row that has room
 * for it; omitting it would shortchange the adviser, who is who these sheets are
 * for. On the attendance route it is also exactly the pill that page's own inner
 * `<Suspense>` draws while the enroll lists load, so the two agree.
 */
const ACTION_ENROLL: AralRouteAction = { width: 150, tall: true };

/**
 * Mirrors `AppShell`'s `PageTitleBlock`: same wrapper classes, the same three
 * pieces at the same heights and offsets. The grid below it therefore starts on
 * the row the page's grid will, and the handover moves nothing.
 */
function AralPageTitleSkeleton({
  titleWidth,
  subtitleWidth,
  actions,
}: {
  titleWidth: number;
  subtitleWidth: number;
  actions: AralRouteAction[];
}) {
  return (
    <div
      className="mb-4 flex flex-wrap items-start justify-between gap-3 lg:mb-6"
      data-slot="aral-title-skeleton"
      aria-hidden
    >
      <div className="min-w-0 flex-1">
        {/* The `h1` is `text-xl sm:text-2xl`: a 28px line that grows to 32px. */}
        <Skeleton
          className="h-7 max-w-full sm:h-8"
          style={{ width: titleWidth }}
        />
        {/* `mt-0.5` over a 20px `text-sm` line, where the real subtitle sits. */}
        <Skeleton
          className="mt-0.5 h-5 max-w-full"
          style={{ width: subtitleWidth }}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {actions.map((action, i) => (
          <Skeleton
            key={i}
            className="rounded-lg"
            style={{ width: action.width, height: action.tall ? 40 : 36 }}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * The gutter, the title block, and the sheet — what a route's `loading.tsx`
 * draws.
 *
 * The subtree is `aria-hidden`, so the announcement has to come from here:
 * without `aria-busy` and one line of screen-reader text, a boundary that
 * replaces the whole page is silence to anyone not looking at it. Both existing
 * route boundaries pair them the same way.
 */
function AralRouteSkeleton({
  label,
  titleWidth,
  subtitleWidth,
  actions,
  children,
}: {
  label: string;
  titleWidth: number;
  subtitleWidth: number;
  actions: AralRouteAction[];
  children: ReactNode;
}) {
  return (
    <div className="w-full p-4 lg:p-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>
      <AralPageTitleSkeleton
        titleWidth={titleWidth}
        subtitleWidth={subtitleWidth}
        actions={actions}
      />
      {children}
    </div>
  );
}

/** `loading.tsx` for `/teacher/aral/[gradeId]/attendance`. */
export function AralAttendanceRouteSkeleton() {
  return (
    <AralRouteSkeleton
      label="Loading weekly attendance"
      titleWidth={260}
      subtitleWidth={200}
      actions={[
        { width: LINK_READING },
        { width: LINK_TERMS },
        ACTION_ENROLL,
      ]}
    >
      <AralAttendanceSkeleton />
    </AralRouteSkeleton>
  );
}

/** `loading.tsx` for `/teacher/aral/[gradeId]/reading-level`. */
export function AralReadingLevelRouteSkeleton() {
  return (
    <AralRouteSkeleton
      label="Loading monthly reading levels"
      titleWidth={280}
      subtitleWidth={160}
      actions={[{ width: LINK_ATTENDANCE }, { width: LINK_TERMS }]}
    >
      <AralReadingLevelSkeleton />
    </AralRouteSkeleton>
  );
}

/** `loading.tsx` for `/teacher/aral/[gradeId]/terms-reports`. */
export function AralTermGradesRouteSkeleton() {
  return (
    <AralRouteSkeleton
      label="Loading end of terms reports"
      titleWidth={280}
      subtitleWidth={280}
      actions={[
        { width: LINK_ATTENDANCE },
        { width: LINK_READING },
        ACTION_ENROLL,
      ]}
    >
      <AralTermGradesSkeleton />
    </AralRouteSkeleton>
  );
}
