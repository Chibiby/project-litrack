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
} from "@/lib/learners/pagination";
import { Eye, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { deleteLearners } from "@/lib/actions/learner";
import { LearnerProfileModal } from "@/components/learners/learner-profile-modal";
import {
  AssignAralTutorDialog,
  type AssignAralTutorTarget,
} from "@/components/learners/assign-aral-tutor-dialog";
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
 *  - Actions holds two controls, both dialogs rather than navigations. View
 *    opens the read-only Student Profile dialog (learner-profile-modal); Edit
 *    moved into that dialog's footer, so the row no longer carries a pencil.
 *    The violet spark enrolls into ARAL, and appears only on a learner who is
 *    not in the program yet — for one already in it, the same decision is a
 *    change of tutor, which lives on the profile dialog's ARAL tab.
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
  /** Grade owning this learner — used for the detail link in multi-grade lists. */
  gradeLevelId: string;
  gradeType: string;
};

export type LearnerListClientProps = {
  /** List route base — defaults to `/teacher/learners`. */
  basePath?: string;
  grade?: LearnerListGradeFilter;
  gender: LearnerGenderFilter;
  aralStatus: LearnerAralStatusFilter;
  grades?: LearnerGradeOption[];
  /**
   * Sections in the listed grades. Not a facet any more — the presence of any
   * section is what decides whether the Section column earns its width, which
   * an empty page of rows could not answer on its own.
   */
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
  /** Learner whose read-only profile dialog is open; `null` when closed. */
  const [profileLearnerId, setProfileLearnerId] = useState<string | null>(null);
  /** Subject of the open ARAL tutor picker; `null` when closed. */
  const [aralTarget, setAralTarget] = useState<AssignAralTutorTarget | null>(
    null
  );
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

  /** One row's spark: a learner not in ARAL yet, so this is always an enrolment. */
  const openEnrollOne = (l: LearnerListRow) =>
    setAralTarget({
      learnerIds: [l.id],
      learnerName: l.fullName,
      currentTutorId: null,
      enrolling: true,
    });

  const openBulkAral = () => {
    const picked = optimisticLearners.filter((l) => selected.has(l.id));
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

  return (
    <Surface as="section" className="overflow-hidden">
      <LearnerListToolbar
        basePath={basePath}
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
              onEnrollAral={openBulkAral}
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
                : gender !== "all" || aralStatus !== "all"
                  ? "No learners match these filters"
                  : "No learners yet"
            }
            description={
              q.trim()
                ? "Try a different name search."
                : gender !== "all" || aralStatus !== "all"
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
                <TableHead className={HEAD_CLASS}>ARAL Profile</TableHead>
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
                          type="button"
                          size="icon"
                          variant="outline"
                          className="h-8 w-8"
                          onClick={() => setProfileLearnerId(l.id)}
                        >
                          <Eye className="h-4 w-4" aria-hidden />
                          <span className="sr-only">
                            View {l.fullName}&apos;s profile
                          </span>
                        </Button>
                        {!isSuperAdmin && !l.isAralLearner && !l.archivedAt && (
                          <Button
                            type="button"
                            size="icon"
                            variant="outline"
                            className="h-8 w-8 border-violet-200 text-violet-700 hover:bg-violet-soft hover:text-violet-soft-foreground"
                            disabled={pending}
                            title="Enroll as ARAL"
                            onClick={() => openEnrollOne(l)}
                          >
                            <Sparkles className="h-4 w-4" aria-hidden />
                            <span className="sr-only">
                              Enroll {l.fullName} as ARAL
                            </span>
                          </Button>
                        )}
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

      {/* One dialog instance for the whole page — the open row is state, not
          markup, so switching rows re-fetches instead of remounting. The row's
          ARAL flag rides along so the dialog's footer names its ARAL action
          correctly while the fetch is still in flight. */}
      <LearnerProfileModal
        learnerId={profileLearnerId}
        onClose={() => setProfileLearnerId(null)}
        isSuperAdmin={isSuperAdmin}
        initialIsAralLearner={
          optimisticLearners.find((l) => l.id === profileLearnerId)
            ?.isAralLearner ?? false
        }
      />

      {/* Also one instance, and for the same reason: the row spark and the bulk
          menu are two ways into one decision, so they set its subject rather
          than each carrying a dialog of their own. */}
      <AssignAralTutorDialog
        target={aralTarget}
        onClose={() => setAralTarget(null)}
        onDone={() => setSelected(new Set())}
      />
    </Surface>
  );
}
