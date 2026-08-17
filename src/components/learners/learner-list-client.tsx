"use client";

import {
  useEffect,
  useMemo,
  useOptimistic,
  useRef,
  useState,
  useTransition,
} from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Surface } from "@/components/ui/surface";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { GENDER_LABELS } from "@/lib/constants/enum-labels";
import { LearnerAvatar } from "@/components/learners/learner-avatar";
import {
  AralChip,
  AralProfilePill,
  ReadingBandPill,
} from "@/components/learners/reading-band-pill";
import { LearnerBulkActions } from "@/components/learners/learner-bulk-actions";
import { LearnerListFooter } from "@/components/learners/learner-list-footer";
import {
  LearnerListToolbar,
  type LearnerGradeOption,
  type SectionOption,
} from "@/components/learners/learner-list-toolbar";
import { EmptyState } from "@/components/dashboard";
import {
  LEARNER_LIST_DEFAULT_PAGE_SIZE,
  totalPages as calcTotalPages,
  type LearnerAralStatusFilter,
  type LearnerGenderFilter,
  type LearnerListGradeFilter,
  type LearnerListSectionFilter,
} from "@/lib/learners/pagination";
import { Eye, Pencil } from "lucide-react";
import { deleteLearners } from "@/lib/actions/learner";
import { invalidateNavWarm } from "@/components/nav-prefetcher";
import {
  listOptimisticReducer,
  runOptimistic,
  settleActionResult,
  type ListOptimisticOp,
} from "@/lib/ui/optimistic";

/*
 * DIRECTION CONTRACT — teacher roster (/teacher/learners)
 *
 * THESIS      The supplied comp is the spec. This surface reproduces its
 *             layout — page header with the add control, four read-only stat
 *             cards, then one panel holding toolbar, table and footer — and
 *             adapts LITRACK's real columns into it rather than inventing a
 *             structure of its own.
 * OWN-WORLD   LITRACK's committed identity, unchanged: blue-gray field, white
 *             Surface panels, blue primary, violet reserved for ARAL. Colour
 *             lives in chips, pills and icon tiles, never in a card body.
 * FORM        Reproduction of the user-supplied comp; the pinned brief outranks
 *             any roll of taste.
 *
 * TRUTH NOTES
 *  - The comp shows a photo per learner. `Learner` has no photo column, so the
 *    slot keeps its geometry and carries initials instead. See learner-avatar.
 *  - The comp tints "High Emergent" green and "Grade-level Ready" blue, which
 *    breaks the band ramp on a page read to find struggling readers. The pill
 *    treatment is kept; the hue order is corrected. See reading-band-pill.
 *  - Grade is a column only for a teacher who holds more than one grade — the
 *    comp's single-grade case renders exactly as drawn.
 */

/** Debounce pause before applying typed search (ms). */
export const SEARCH_DEBOUNCE_MS = 500;

export type LearnerListRow = {
  id: string;
  fullName: string;
  age: number;
  gender: keyof typeof GENDER_LABELS;
  isAralLearner: boolean;
  /** Whether a Section B–E ARAL profile has been saved for this learner. */
  hasAralProfile: boolean;
  archivedAt: string | null;
  englishReadingProfile: string;
  filipinoReadingProfile: string;
  section: { id: string; name: string } | null;
  /** Grade owning this learner — used for detail/edit links in multi-grade lists. */
  gradeLevelId: string;
  gradeType: string;
};

export type LearnerListClientProps = {
  /** List route base — defaults to `/teacher/learners`. */
  basePath?: string;
  grade?: LearnerListGradeFilter;
  section: LearnerListSectionFilter;
  gender: LearnerGenderFilter;
  aralStatus: LearnerAralStatusFilter;
  grades?: LearnerGradeOption[];
  sections: SectionOption[];
  schoolId?: string;
  isSuperAdmin: boolean;
  /** Current page rows from the server (already filtered/paginated). */
  learners: LearnerListRow[];
  page: number;
  pageSize: number;
  totalCount: number;
  q: string;
};

type LearnerOp = ListOptimisticOp<LearnerListRow>;

const HEAD_CLASS =
  "whitespace-nowrap text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";

export function LearnerListClient({
  basePath = "/teacher/learners",
  grade = "all",
  section,
  gender,
  aralStatus,
  grades = [],
  sections,
  schoolId,
  isSuperAdmin,
  learners,
  page,
  pageSize = LEARNER_LIST_DEFAULT_PAGE_SIZE,
  totalCount,
  q,
}: LearnerListClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [inputValue, setInputValue] = useState(q);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [optimisticLearners, dispatchOptimistic] = useOptimistic(
    learners,
    (state: LearnerListRow[], op: LearnerOp) => listOptimisticReducer(state, op)
  );

  useEffect(() => {
    setInputValue(q);
  }, [q]);

  const visibleIds = useMemo(
    () => optimisticLearners.map((l) => l.id),
    [optimisticLearners]
  );

  // A new page (or a new filter) is a different set of rows — carrying a
  // selection across it would let a teacher delete learners they can't see.
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const visible = new Set(visibleIds);
      const next = new Set([...prev].filter((id) => visible.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [visibleIds]);

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

  const pages = calcTotalPages(totalCount, pageSize);
  const showGradeColumn = grades.length > 1;
  const showSection = sections.length > 0;
  const gradeLabelById = Object.fromEntries(grades.map((g) => [g.id, g.label]));

  const pageSearchParams: Record<string, string | undefined> = {
    q: q.trim() || undefined,
    grade: grade !== "all" ? grade : undefined,
    section: section !== "all" ? section : undefined,
    gender: gender !== "all" ? gender : undefined,
    aralStatus: aralStatus !== "all" ? aralStatus : undefined,
    perPage:
      pageSize !== LEARNER_LIST_DEFAULT_PAGE_SIZE ? String(pageSize) : undefined,
    schoolId,
  };

  const selectedOnPage = visibleIds.filter((id) => selected.has(id));
  const allSelected =
    visibleIds.length > 0 && selectedOnPage.length === visibleIds.length;
  const someSelected = selectedOnPage.length > 0 && !allSelected;

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

  const handleBulkDelete = () =>
    runOptimistic(startTransition, async () => {
      const ids = selectedOnPage;
      if (ids.length === 0) return;
      for (const id of ids) dispatchOptimistic({ type: "remove", id });

      const fd = new FormData();
      for (const id of ids) fd.append("learnerIds", id);
      const res = await deleteLearners(fd);
      await settleActionResult(
        res,
        `${ids.length} learner${ids.length === 1 ? "" : "s"} deleted`
      );
      setSelected(new Set());
      invalidateNavWarm();
    });

  return (
    <Surface as="section" className="overflow-hidden">
      <LearnerListToolbar
        basePath={basePath}
        section={section}
        sections={sections}
        gender={gender}
        aralStatus={aralStatus}
        schoolId={schoolId}
        q={q}
        perPage={pageSize}
        searchValue={inputValue}
        onSearchChange={handleSearchChange}
        onSearchSubmit={handleSearchSubmit}
        bulkActions={
          isSuperAdmin ? null : (
            <LearnerBulkActions
              selectedCount={selectedOnPage.length}
              onDelete={handleBulkDelete}
              pending={pending}
            />
          )
        }
      />

      {totalCount === 0 ? (
        <div className="p-4">
          <EmptyState
            title={
              q.trim()
                ? "No matching learners"
                : section !== "all" || gender !== "all" || aralStatus !== "all"
                  ? "No learners match these filters"
                  : "No learners yet"
            }
            description={
              q.trim()
                ? "Try a different name search."
                : section !== "all" || gender !== "all" || aralStatus !== "all"
                  ? "Clear a filter to widen the list."
                  : "Add a learner using the button above the stat cards."
            }
          />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {!isSuperAdmin && (
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
                <TableHead className={HEAD_CLASS}>Name</TableHead>
                <TableHead className={HEAD_CLASS}>Age</TableHead>
                <TableHead className={HEAD_CLASS}>Gender</TableHead>
                {showGradeColumn && (
                  <TableHead className={HEAD_CLASS}>Grade</TableHead>
                )}
                {showSection && (
                  <TableHead className={HEAD_CLASS}>Section</TableHead>
                )}
                <TableHead className={HEAD_CLASS}>ARAL Status</TableHead>
                <TableHead className={HEAD_CLASS}>English Level</TableHead>
                <TableHead className={HEAD_CLASS}>Filipino Level</TableHead>
                <TableHead className={`${HEAD_CLASS} text-right`}>
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {optimisticLearners.map((l, i) => {
                const isSelected = selected.has(l.id);
                return (
                  <TableRow
                    key={l.id}
                    data-state={isSelected ? "selected" : undefined}
                    className={l.archivedAt ? "opacity-70" : undefined}
                  >
                    {!isSuperAdmin && (
                      <TableCell className="w-10">
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={(v) => toggleOne(l.id, v === true)}
                          aria-label={`Select ${l.fullName}`}
                        />
                      </TableCell>
                    )}
                    <TableCell className="tabular-nums text-muted-foreground">
                      {(page - 1) * pageSize + i + 1}
                    </TableCell>
                    <TableCell>
                      <span className="flex items-center gap-3">
                        <LearnerAvatar id={l.id} fullName={l.fullName} />
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="font-medium text-foreground">
                            {l.fullName}
                          </span>
                          {l.isAralLearner && <AralChip />}
                          {l.archivedAt && (
                            <Badge variant="outline">Archived</Badge>
                          )}
                        </span>
                      </span>
                    </TableCell>
                    <TableCell className="tabular-nums">{l.age}</TableCell>
                    <TableCell>{GENDER_LABELS[l.gender]}</TableCell>
                    {showGradeColumn && (
                      <TableCell className="text-sm text-muted-foreground">
                        {gradeLabelById[l.gradeLevelId] ?? "—"}
                      </TableCell>
                    )}
                    {showSection && (
                      <TableCell className="text-sm text-muted-foreground">
                        {l.section?.name ?? "—"}
                      </TableCell>
                    )}
                    <TableCell>
                      <AralProfilePill hasProfile={l.hasAralProfile} />
                    </TableCell>
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
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          asChild
                          size="icon"
                          variant="outline"
                          className="h-8 w-8"
                        >
                          <Link
                            href={`/teacher/grade/${l.gradeLevelId}/learners/${l.id}`}
                          >
                            <Eye className="h-4 w-4" aria-hidden />
                            <span className="sr-only">
                              View {l.fullName}&apos;s profile
                            </span>
                          </Link>
                        </Button>
                        <Button
                          asChild
                          size="icon"
                          variant="outline"
                          className="h-8 w-8"
                        >
                          <Link
                            href={`/teacher/grade/${l.gradeLevelId}/learners/${l.id}/edit`}
                          >
                            <Pencil className="h-4 w-4" aria-hidden />
                            <span className="sr-only">Edit {l.fullName}</span>
                          </Link>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
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
  );
}
