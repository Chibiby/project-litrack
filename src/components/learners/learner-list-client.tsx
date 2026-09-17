"use client";

import {
  useEffect,
  useMemo,
  useOptimistic,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Surface } from "@/components/ui/surface";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { GENDER_LABELS, GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import { LearnerAvatar } from "@/components/learners/learner-avatar";
import { ReadingBandPill } from "@/components/learners/reading-band-pill";
import { LearnerBulkActions } from "@/components/learners/learner-bulk-actions";
import { LearnerListFooter } from "@/components/learners/learner-list-footer";
import {
  LearnerListToolbar,
  LearnerRosterNav,
  type AdvisoryOption,
  type LearnerGradeOption,
  type RosterUrlState,
  type SectionOption,
} from "@/components/learners/learner-list-toolbar";
import { EmptyState } from "@/components/dashboard";
import {
  LEARNER_LIST_DEFAULT_PAGE_SIZE,
  totalPages as calcTotalPages,
  type LearnerAralStatusFilter,
  type LearnerGenderFilter,
  type LearnerListGradeFilter,
  type LearnerListSort,
} from "@/lib/learners/pagination";
import { Archive, Eye, MoreVertical, RotateCcw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { archiveLearners, restoreLearner } from "@/lib/actions/learner";
import { LearnerProfileModal } from "@/components/learners/learner-profile-modal";
import {
  AssignAralTutorDialog,
  type AssignAralTutorTarget,
} from "@/components/learners/assign-aral-tutor-dialog";
import { invalidateNavWarm } from "@/components/nav-prefetcher";
import { settleActionResult } from "@/lib/ui/optimistic";
import { cn } from "@/lib/utils";

/*
 * DIRECTION CONTRACT — teacher roster (/teacher/learners), v2
 *
 * THESIS      The owner's v2 Learners mockups are the spec: tabs and the
 *             Advisory switcher above one panel holding the filter bar, the
 *             table (xl and up) or a one-line-per-learner list (below xl), and
 *             the footer.
 *
 * TRUTH NOTES
 *  - The mockup shows an LRN column. `Learner` stores no LRN, so the column
 *    shows Age, which the roster already had (owner decision).
 *  - The mockup shows a photo per learner. `Learner` has no photo column, so
 *    the slot carries initials instead. See learner-avatar.
 *  - The mockup tints "High Emergent" green and "Grade-level Ready" blue,
 *    which breaks the band ramp on a page read to find struggling readers.
 *    The pill treatment is kept; the hue order is corrected. See
 *    reading-band-pill.
 *  - Actions: View opens the read-only Student Profile dialog; the ⋮ menu
 *    holds Enroll as ARAL (only for a learner not in the program yet) and
 *    Archive. Edit lives in the profile dialog's footer, so no row carries it.
 *    The archived view keeps its visible Restore button.
 */

/** Debounce pause before applying typed search (ms). */
export const SEARCH_DEBOUNCE_MS = 500;

export type LearnerListRow = {
  id: string;
  fullName: string;
  age: number;
  gender: keyof typeof GENDER_LABELS;
  isAralLearner: boolean;
  archivedAt: string | null;
  /** Null when the learner's grade doesn't collect English (Grade 1/Grade 2). */
  englishReadingProfile: string | null;
  filipinoReadingProfile: string;
  section: { id: string; name: string } | null;
  /** Grade owning this learner — used for the detail link in multi-advisory lists. */
  gradeLevelId: string;
  gradeType: string;
};

export type LearnerListClientProps = {
  /** List route base — defaults to `/teacher/learners`. */
  basePath?: string;
  grade?: LearnerListGradeFilter;
  section?: string;
  advisory?: string | null;
  gender: LearnerGenderFilter;
  aralStatus: LearnerAralStatusFilter;
  sort?: LearnerListSort;
  grades?: LearnerGradeOption[];
  /** Sections in the listed grades — the Section facet's options. */
  sections: SectionOption[];
  /** Sections this teacher advises — the switcher, facet and Advisory column. */
  advisories?: AdvisoryOption[];
  schoolId?: string;
  isSuperAdmin: boolean;
  /** Current page rows from the server (already filtered/paginated). */
  learners: LearnerListRow[];
  page: number;
  pageSize: number;
  totalCount: number;
  q: string;
  /** Whether this is the recoverable archived-records view. */
  archivedView?: boolean;
  /** The streamed Add New Learner control, rendered beside the switcher. */
  addControl?: React.ReactNode;
};

const HEAD_CLASS =
  "whitespace-nowrap text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";

/** "Grade 3" → "3", "Kinder" → "K"; the Advisory chip's short grade. */
function shortGrade(gradeType: string): string {
  const label = GRADE_LEVEL_LABELS[gradeType] ?? gradeType;
  const m = /^Grade (\d+)$/.exec(label);
  if (m) return m[1];
  return label === "Kinder" ? "K" : label;
}

function gradeAndSection(l: LearnerListRow): string {
  const grade = GRADE_LEVEL_LABELS[l.gradeType] ?? l.gradeType;
  return l.section ? `${grade} - ${l.section.name}` : grade;
}

const ARAL_CHIP =
  "inline-flex items-center rounded-full bg-violet-100 px-2.5 py-1 text-xs font-semibold text-violet-700 dark:bg-violet-900/40 dark:text-violet-200";

/** Stable passthrough: a new Set per render would re-run the optimistic reducer. */
const NO_LEAVING_IDS: ReadonlySet<string> = new Set();

export function LearnerListClient({
  basePath = "/teacher/learners",
  grade = "all",
  section = "all",
  advisory = null,
  gender,
  aralStatus,
  sort = "name",
  sections,
  advisories = [],
  grades = [],
  schoolId,
  isSuperAdmin,
  learners: serverLearners,
  page,
  pageSize = LEARNER_LIST_DEFAULT_PAGE_SIZE,
  totalCount,
  q,
  archivedView = false,
  addControl,
}: LearnerListClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [inputValue, setInputValue] = useState(q);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** Learner whose read-only profile dialog is open; `null` when closed. */
  const [profileLearnerId, setProfileLearnerId] = useState<string | null>(null);
  /** Subject of the open ARAL tutor picker; `null` when closed. */
  const [aralTarget, setAralTarget] = useState<AssignAralTutorTarget | null>(
    null
  );

  // Adopt the URL's `q` (e.g. browser back/forward) during render, per the
  // React docs "adjusting state when a prop changes" pattern.
  const [prevQ, setPrevQ] = useState(q);
  if (q !== prevQ) {
    setPrevQ(q);
    setInputValue(q);
  }

  /**
   * Rows that leave this view on archive (or restore, in the archived view)
   * disappear on click rather than after the refresh lands. Reverts on its own
   * if the action fails, because the transition ends without new props.
   */
  const [leavingIds, markLeaving] = useOptimistic(
    NO_LEAVING_IDS,
    (prev: ReadonlySet<string>, ids: string[]): ReadonlySet<string> =>
      new Set([...prev, ...ids])
  );
  // React replays the reducer on every render while the transition is pending,
  // so `leavingIds` is a new Set each time. Memoize on its contents, or every
  // render hands children a new `learners` array and effects keyed on it loop.
  const leavingKey = [...leavingIds].sort().join(",");
  const learners = useMemo(() => {
    if (!leavingKey) return serverLearners;
    const leaving = new Set(leavingKey.split(","));
    return serverLearners.filter((l) => !leaving.has(l.id));
  }, [serverLearners, leavingKey]);

  const visibleIds = useMemo(() => learners.map((l) => l.id), [learners]);

  // A new page (or a new filter) is a different set of rows — carrying a
  // selection across it would let a teacher delete learners they can't see.
  // Adjusted during render (React docs "adjusting state when a prop changes"
  // pattern) rather than an effect.
  const [prevVisibleIds, setPrevVisibleIds] = useState(visibleIds);
  if (visibleIds !== prevVisibleIds) {
    setPrevVisibleIds(visibleIds);
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const visible = new Set(visibleIds);
      const next = new Set([...prev].filter((id) => visible.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }

  const clearDebounce = () => {
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  };

  useEffect(() => () => clearDebounce(), []);

  const pushSearch = (raw: string) => {
    clearDebounce();
    const next = raw.trim();
    const params = new URLSearchParams(searchParams.toString());
    if (next) params.set("q", next);
    else params.delete("q");
    params.delete("page");
    const qs = params.toString();
    router.push(qs ? `${basePath}?${qs}` : basePath);
  };

  const handleSearchChange = (value: string) => {
    setInputValue(value);
    clearDebounce();
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      pushSearch(value);
    }, SEARCH_DEBOUNCE_MS);
  };

  const handleSearchSubmit = () => {
    pushSearch(inputValue);
  };

  const urlState: RosterUrlState = {
    q,
    grade,
    section,
    advisory,
    gender,
    aralStatus,
    sort,
    perPage: pageSize !== LEARNER_LIST_DEFAULT_PAGE_SIZE ? pageSize : undefined,
    schoolId,
    archivedView,
  };

  const pages = calcTotalPages(totalCount, pageSize);
  const advisoryById = new Map(advisories.map((a) => [a.id, a]));
  const filtered =
    grade !== "all" ||
    section !== "all" ||
    advisory !== null ||
    gender !== "all" ||
    aralStatus !== "all";

  const pageSearchParams: Record<string, string | undefined> = {
    q: q.trim() || undefined,
    grade: grade !== "all" ? grade : undefined,
    section: section !== "all" ? section : undefined,
    advisory: advisory ?? undefined,
    gender: gender !== "all" ? gender : undefined,
    aralStatus: aralStatus !== "all" ? aralStatus : undefined,
    sort: sort !== "name" ? sort : undefined,
    perPage:
      pageSize !== LEARNER_LIST_DEFAULT_PAGE_SIZE ? String(pageSize) : undefined,
    schoolId,
    filter: archivedView ? "archived" : undefined,
  };

  const selectedOnPage = visibleIds.filter((id) => selected.has(id));
  const allSelected =
    visibleIds.length > 0 && selectedOnPage.length === visibleIds.length;
  const someSelected = selectedOnPage.length > 0 && !allSelected;
  const selectable = !isSuperAdmin && !archivedView;

  const toggleAll = (checked: boolean) => {
    setSelected(checked ? new Set(visibleIds) : new Set());
  };

  const toggleOne = (id: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const archive = (ids: string[]) => {
    startTransition(async () => {
      if (ids.length === 0) return;
      markLeaving(ids);
      const fd = new FormData();
      for (const id of ids) fd.append("learnerIds", id);
      const res = await archiveLearners(fd);
      try {
        await settleActionResult(
          res,
          `${ids.length} learner${ids.length === 1 ? "" : "s"} archived`
        );
      } catch {
        return; // Already toasted; the rows come back as the transition ends.
      }
      setSelected(new Set());
      invalidateNavWarm();
      router.refresh();
    });
  };

  const handleRestoreOne = (id: string) => {
    startTransition(async () => {
      markLeaving([id]);
      const fd = new FormData();
      fd.set("id", id);
      const res = await restoreLearner(fd);
      try {
        await settleActionResult(res, "Learner restored");
      } catch {
        return; // Already toasted; the row comes back as the transition ends.
      }
      invalidateNavWarm();
      router.refresh();
    });
  };

  /** The row menu's enrolment: a learner not in ARAL yet. */
  const openEnrollOne = (l: LearnerListRow) =>
    setAralTarget({
      learnerIds: [l.id],
      learnerName: l.fullName,
      currentTutorId: null,
      enrolling: true,
    });

  const openBulkAral = () => {
    const picked = learners.filter((l) => selected.has(l.id));
    if (picked.length === 0) return;
    // Archived learners live behind their own filter, so a selection is wholly
    // archived or wholly active — never mixed. The action would refuse them with
    // a message about the roster, which is not the reason.
    if (picked.every((l) => l.archivedAt)) {
      toast.error("Archived learners cannot be enrolled in ARAL");
      return;
    }
    const rows = picked.filter((l) => !l.archivedAt);
    setAralTarget({
      learnerIds: rows.map((l) => l.id),
      learnerName: rows.length === 1 ? (rows[0]?.fullName ?? null) : null,
      currentTutorId: null,
      // Every one of them already in ARAL makes this a change of tutor, and the
      // dialog says so rather than offering to enroll them twice.
      enrolling: rows.some((l) => !l.isAralLearner),
    });
  };

  /** ⋮ menu for a row. `withView` adds View profile (phone list). */
  const rowMenu = (l: LearnerListRow, withView: boolean) => {
    const canEnroll = !isSuperAdmin && !l.isAralLearner && !l.archivedAt;
    const canArchive = !isSuperAdmin && !l.archivedAt;
    if (!withView && !canEnroll && !canArchive) return null;
    return (
      // Not modal: its items open dialogs, and a modal menu handing focus to a
      // modal dialog loops between the two focus traps.
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="icon"
            variant="outline"
            className="size-9 shrink-0 rounded-xl"
            disabled={pending}
            aria-label={`More actions for ${l.fullName}`}
          >
            <MoreVertical className="size-4" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          {withView ? (
            <DropdownMenuItem onSelect={() => setProfileLearnerId(l.id)}>
              <Eye className="size-4" aria-hidden />
              View profile
            </DropdownMenuItem>
          ) : null}
          {canEnroll ? (
            <DropdownMenuItem
              onSelect={() => openEnrollOne(l)}
              className="text-violet-700 focus:text-violet-700 dark:text-violet-300 dark:focus:text-violet-300"
            >
              <Sparkles className="size-4" aria-hidden />
              Enroll as ARAL
            </DropdownMenuItem>
          ) : null}
          {canArchive ? (
            <DropdownMenuItem onSelect={() => archive([l.id])}>
              <Archive className="size-4" aria-hidden />
              Archive
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  const restoreButton = (l: LearnerListRow) => (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="rounded-xl"
      disabled={pending}
      onClick={() => handleRestoreOne(l.id)}
      aria-label={`Restore ${l.fullName}`}
    >
      <RotateCcw className="size-4" aria-hidden />
      Restore
    </Button>
  );

  const rowNumber = (i: number) => (page - 1) * pageSize + i + 1;

  return (
    <div className="flex flex-col gap-4">
      <LearnerRosterNav
        basePath={basePath}
        state={urlState}
        showProfiling={!isSuperAdmin}
        addControl={addControl}
      />

      <Surface as="section" className="overflow-hidden rounded-2xl">
        <LearnerListToolbar
          basePath={basePath}
          state={urlState}
          grades={grades}
          sections={sections}
          advisories={advisories}
          pageSize={pageSize}
          searchValue={inputValue}
          onSearchChange={handleSearchChange}
          onSearchSubmit={handleSearchSubmit}
          onNavigate={(href) => router.push(href)}
          bulkActions={
            selectable ? (
              <LearnerBulkActions
                selectedCount={selectedOnPage.length}
                onArchive={() => archive(selectedOnPage)}
                onEnrollAral={openBulkAral}
                pending={pending}
              />
            ) : null
          }
        />

        {totalCount === 0 ? (
          <div className="p-4">
            <EmptyState
              title={
                q.trim()
                  ? "No matching learners"
                  : filtered
                    ? "No learners match these filters"
                    : archivedView
                      ? "No archived learners"
                      : "No learners yet"
              }
              description={
                q.trim()
                  ? "Try a different name search."
                  : filtered
                    ? "Clear a filter to widen the list."
                    : archivedView
                      ? "Learners you archive will appear here and can be restored."
                      : "Add a learner using the Add New Learner button."
              }
            />
          </div>
        ) : (
          <>
            {/* xl and up: the full table, as in the desktop mockup. */}
            <div className="hidden overflow-x-auto xl:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    {selectable && (
                      <TableHead className="w-10">
                        <Checkbox
                          checked={
                            allSelected ? true : someSelected ? "indeterminate" : false
                          }
                          onCheckedChange={(v) => toggleAll(v === true)}
                          aria-label="Select all learners on this page"
                        />
                      </TableHead>
                    )}
                    <TableHead className={`${HEAD_CLASS} w-10`}>#</TableHead>
                    <TableHead className={HEAD_CLASS}>Learner Name</TableHead>
                    <TableHead className={HEAD_CLASS}>Age</TableHead>
                    <TableHead className={HEAD_CLASS}>Grade &amp; Section</TableHead>
                    <TableHead className={HEAD_CLASS}>Advisory</TableHead>
                    <TableHead className={HEAD_CLASS}>Gender</TableHead>
                    <TableHead className={HEAD_CLASS}>English Level</TableHead>
                    <TableHead className={HEAD_CLASS}>Filipino Level</TableHead>
                    <TableHead className={HEAD_CLASS}>ARAL Status</TableHead>
                    <TableHead className={`${HEAD_CLASS} text-right`}>
                      Actions
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {learners.map((l, i) => {
                    const isSelected = selected.has(l.id);
                    const adv = l.section ? advisoryById.get(l.section.id) : undefined;
                    return (
                      <TableRow
                        key={l.id}
                        data-state={isSelected ? "selected" : undefined}
                        className={l.archivedAt ? "opacity-70" : undefined}
                      >
                        {selectable && (
                          <TableCell className="w-10">
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={(v) => toggleOne(l.id, v === true)}
                              aria-label={`Select ${l.fullName}`}
                            />
                          </TableCell>
                        )}
                        <TableCell className="tabular-nums text-muted-foreground">
                          {rowNumber(i)}
                        </TableCell>
                        <TableCell>
                          <span className="flex items-center gap-3">
                            <LearnerAvatar id={l.id} fullName={l.fullName} />
                            <span className="flex flex-wrap items-center gap-1.5">
                              <span className="whitespace-nowrap font-medium text-foreground">
                                {l.fullName}
                              </span>
                              {l.archivedAt && (
                                <Badge variant="outline">Archived</Badge>
                              )}
                            </span>
                          </span>
                        </TableCell>
                        <TableCell className="tabular-nums">{l.age}</TableCell>
                        <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                          {gradeAndSection(l)}
                        </TableCell>
                        <TableCell>
                          {adv && l.section ? (
                            <span className="inline-flex whitespace-nowrap rounded-lg bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-800 dark:bg-blue-900/30 dark:text-blue-200">
                              {shortGrade(l.gradeType)} - {l.section.name}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>{GENDER_LABELS[l.gender]}</TableCell>
                        <TableCell>
                          <ReadingBandPill
                            profile={l.englishReadingProfile}
                            gradeType={l.gradeType}
                          />
                        </TableCell>
                        <TableCell>
                          <ReadingBandPill
                            profile={l.filipinoReadingProfile}
                            gradeType={l.gradeType}
                          />
                        </TableCell>
                        <TableCell>
                          {l.isAralLearner ? (
                            <span className={ARAL_CHIP}>ARAL</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-1.5">
                            {!archivedView && (
                              <Button
                                type="button"
                                size="icon"
                                variant="outline"
                                className="size-9 rounded-xl"
                                onClick={() => setProfileLearnerId(l.id)}
                              >
                                <Eye className="size-4" aria-hidden />
                                <span className="sr-only">
                                  View {l.fullName}&apos;s profile
                                </span>
                              </Button>
                            )}
                            {!isSuperAdmin && archivedView
                              ? restoreButton(l)
                              : rowMenu(l, false)}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {/* Below xl: one line per learner, as in the phone mockup. */}
            <ul className="divide-y divide-border/60 xl:hidden" aria-label="Learners">
              {learners.map((l, i) => {
                const isSelected = selected.has(l.id);
                const pill = l.englishReadingProfile ?? l.filipinoReadingProfile;
                return (
                  <li
                    key={l.id}
                    className={cn(
                      "flex items-center gap-2.5 px-3 py-3 sm:gap-3 sm:px-4",
                      isSelected && "bg-muted/60",
                      l.archivedAt && "opacity-70"
                    )}
                  >
                    {selectable && (
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={(v) => toggleOne(l.id, v === true)}
                        aria-label={`Select ${l.fullName} in list`}
                      />
                    )}
                    <span className="w-5 shrink-0 text-center text-sm tabular-nums text-muted-foreground">
                      {rowNumber(i)}
                    </span>
                    <LearnerAvatar id={l.id} fullName={l.fullName} />
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-auto min-w-0 flex-1 flex-col items-start gap-0 whitespace-normal px-1 py-0.5 text-left hover:bg-transparent"
                      onClick={() => (archivedView ? undefined : setProfileLearnerId(l.id))}
                    >
                      <span className="line-clamp-1 text-sm font-medium text-foreground sm:text-base">
                        {l.fullName}
                      </span>
                      <span className="line-clamp-1 text-xs font-normal text-muted-foreground sm:text-sm">
                        Age {l.age} · {gradeAndSection(l)}
                        {l.isAralLearner ? " · ARAL" : ""}
                      </span>
                    </Button>
                    <ReadingBandPill
                      profile={pill}
                      gradeType={l.gradeType}
                      className="hidden min-[400px]:inline-flex"
                    />
                    {!isSuperAdmin && archivedView
                      ? restoreButton(l)
                      : rowMenu(l, true)}
                  </li>
                );
              })}
            </ul>
          </>
        )}

        <LearnerListFooter
          basePath={basePath}
          page={page}
          totalPages={pages}
          totalCount={totalCount}
          pageSize={pageSize}
          searchParams={pageSearchParams}
        />
      </Surface>

      {/* One dialog instance for the whole page — the open row is state, not
          markup, so switching rows re-fetches instead of remounting. The row's
          ARAL flag rides along so the dialog's footer names its ARAL action
          correctly while the fetch is still in flight. */}
      <LearnerProfileModal
        learnerId={profileLearnerId}
        onClose={() => setProfileLearnerId(null)}
        isSuperAdmin={isSuperAdmin}
        initialIsAralLearner={
          learners.find((l) => l.id === profileLearnerId)?.isAralLearner ?? false
        }
      />

      {/* Also one instance, and for the same reason: the row menu and the bulk
          menu are two ways into one decision, so they set its subject rather
          than each carrying a dialog of their own. */}
      <AssignAralTutorDialog
        target={aralTarget}
        onClose={() => setAralTarget(null)}
        onDone={() => setSelected(new Set())}
      />
    </div>
  );
}
