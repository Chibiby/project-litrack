"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  LEARNING_AREA_LABELS,
  LEARNING_AREA_ORDER,
} from "@/lib/constants/enum-labels";
import { generalAverage } from "@/lib/terms/average";
import { saveTermGrades } from "@/lib/actions/term-grades";
import type { TermGradesSaveInput } from "@/lib/validators/term-grade.schema";
import { cn } from "@/lib/utils";

/**
 * 60 is the input floor, not 75. 75 is DepEd's passing mark, so it only tints a
 * cell — a failing learner has to be recordable or the sheet pushes teachers to
 * enter a false 75.
 */
const SCORE_MIN = 60;
const SCORE_MAX = 100;
const PASSING_SCORE = 75;

/** Borrowed from the reading-level grid's ramp so the ARAL grids read as one system. */
const TONE_FAILING =
  "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-300";

export type TermKey = "FIRST" | "SECOND" | "THIRD";

type LearningArea = (typeof LEARNING_AREA_ORDER)[number];

export type TermGradesGridLearner = {
  id: string;
  fullName: string;
  sectionName: string | null;
};

export type TermGradesGridExisting = {
  learnerId: string;
  subject: string;
  score: number;
};

export type AralTermGradesGridFormHandle = { save: () => void };

/** A cell holds the raw input string so an emptied cell stays distinct from a 0. */
type RowState = Partial<Record<LearningArea, string>>;

function isLearningArea(value: string): value is LearningArea {
  return LEARNING_AREA_ORDER.some((subject) => subject === value);
}

function toRows(
  learners: TermGradesGridLearner[],
  existing: TermGradesGridExisting[]
): Record<string, RowState> {
  const byLearner = new Map<string, RowState>();
  for (const record of existing) {
    if (!isLearningArea(record.subject)) continue;
    const row = byLearner.get(record.learnerId) ?? {};
    row[record.subject] = String(record.score);
    byLearner.set(record.learnerId, row);
  }

  const init: Record<string, RowState> = {};
  for (const learner of learners) {
    init[learner.id] = { ...(byLearner.get(learner.id) ?? {}) };
  }
  return init;
}

function cellValue(row: RowState | undefined, subject: LearningArea): string {
  return row?.[subject] ?? "";
}

/** Whole number inside the recordable range. Anything else is refused on save. */
function isValidScore(raw: string): boolean {
  const value = Number(raw);
  return Number.isInteger(value) && value >= SCORE_MIN && value <= SCORE_MAX;
}

function rowAverage(row: RowState | undefined): number | null {
  const scores: number[] = [];
  for (const subject of LEARNING_AREA_ORDER) {
    const raw = cellValue(row, subject).trim();
    if (!raw || !isValidScore(raw)) continue;
    scores.push(Number(raw));
  }
  return generalAverage(scores);
}

type Props = {
  gradeLevelId: string;
  term: TermKey;
  learners: TermGradesGridLearner[];
  initialGrades: TermGradesGridExisting[];
  /** Row-number offset so numbering continues across pages. */
  indexOffset?: number;
  readOnly?: boolean;
  onSavePendingChange?: (pending: boolean) => void;
};

export const AralTermGradesGridForm = forwardRef<
  AralTermGradesGridFormHandle,
  Props
>(function AralTermGradesGridForm(
  {
    gradeLevelId,
    term,
    learners,
    initialGrades,
    indexOffset = 0,
    readOnly,
    onSavePendingChange,
  },
  ref
) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  /**
   * What the sheet looked like when it loaded. Saves send the difference, so an
   * untouched cell is never rewritten and "No changes to save" is honest.
   */
  const [initial, setInitial] = useState(() => toRows(learners, initialGrades));
  const [rows, setRows] = useState(initial);

  useEffect(() => {
    onSavePendingChange?.(pending);
  }, [pending, onSavePendingChange]);

  function setScore(learnerId: string, subject: LearningArea, value: string) {
    setRows((prev) => ({
      ...prev,
      [learnerId]: { ...(prev[learnerId] ?? {}), [subject]: value },
    }));
  }

  const handleSave = useCallback(() => {
    if (readOnly || pending) return;

    const entries: TermGradesSaveInput["entries"] = [];
    const invalid: string[] = [];

    for (const learner of learners) {
      for (const subject of LEARNING_AREA_ORDER) {
        const before = cellValue(initial[learner.id], subject).trim();
        const after = cellValue(rows[learner.id], subject).trim();
        if (before === after) continue;
        if (after === "") {
          entries.push({ learnerId: learner.id, subject, score: null });
          continue;
        }
        if (!isValidScore(after)) {
          if (!invalid.includes(learner.fullName)) invalid.push(learner.fullName);
          continue;
        }
        entries.push({ learnerId: learner.id, subject, score: Number(after) });
      }
    }

    if (invalid.length > 0) {
      const names = invalid.slice(0, 3).join(", ");
      const rest = invalid.length > 3 ? ` and ${invalid.length - 3} more` : "";
      toast.error(
        `Grades must be whole numbers from ${SCORE_MIN} to ${SCORE_MAX}. Check ${names}${rest}.`
      );
      return;
    }

    if (entries.length === 0) {
      toast("No changes to save");
      return;
    }

    startTransition(async () => {
      const toastId = toast.loading("Saving term grades…");
      const payload: TermGradesSaveInput = { gradeLevelId, term, entries };
      const res = await saveTermGrades(payload);
      if (!res.ok) {
        toast.error(res.error, { id: toastId });
        return;
      }

      const saved = res.data?.saved ?? 0;
      const cleared = res.data?.cleared ?? 0;
      toast.success(
        cleared > 0
          ? `Saved ${saved} grade${saved === 1 ? "" : "s"} and cleared ${cleared}`
          : `Saved ${saved} grade${saved === 1 ? "" : "s"}`,
        { id: toastId }
      );

      // The sheet is clean again, so the next save sends only what changes after
      // this point rather than resending the whole term.
      setInitial(rows);
      router.refresh();
    });
  }, [
    readOnly,
    pending,
    learners,
    initial,
    rows,
    gradeLevelId,
    term,
    router,
  ]);

  useImperativeHandle(ref, () => ({ save: handleSave }), [handleSave]);

  if (learners.length === 0) {
    return (
      <p className="p-4 text-sm text-muted-foreground">
        No learners match this filter.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead colSpan={2} scope="colgroup">
              Learner
            </TableHead>
            <TableHead
              colSpan={LEARNING_AREA_ORDER.length}
              scope="colgroup"
              className="border-l border-border/60 text-center"
            >
              <span className="block">Subjects and Grades</span>
              <span className="block font-normal normal-case tracking-normal text-muted-foreground">
                Scores {SCORE_MIN}–{SCORE_MAX}
              </span>
            </TableHead>
            <TableHead
              rowSpan={2}
              scope="col"
              className="border-l border-border/60 text-center text-violet-700 dark:text-violet-300"
            >
              <span className="block">General</span>
              <span className="block">Average</span>
            </TableHead>
          </TableRow>
          <TableRow>
            <TableHead className="w-10">#</TableHead>
            <TableHead className="min-w-[200px]">Complete Name</TableHead>
            {LEARNING_AREA_ORDER.map((subject, index) => (
              <TableHead
                key={subject}
                className={cn(
                  "min-w-[104px] text-center",
                  index === 0 && "border-l border-border/60"
                )}
              >
                {LEARNING_AREA_LABELS[subject]}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {learners.map((learner, index) => {
            const row = rows[learner.id];
            const average = rowAverage(row);
            return (
              <TableRow key={learner.id}>
                <TableCell className="text-sm text-muted-foreground tabular-nums">
                  {indexOffset + index + 1}
                </TableCell>
                <TableCell className="font-medium">{learner.fullName}</TableCell>
                {LEARNING_AREA_ORDER.map((subject, subjectIndex) => {
                  const raw = cellValue(row, subject);
                  const trimmed = raw.trim();
                  const valid = trimmed !== "" && isValidScore(trimmed);
                  const failing = valid && Number(trimmed) < PASSING_SCORE;
                  return (
                    <TableCell
                      key={subject}
                      className={cn(
                        subjectIndex === 0 && "border-l border-border/60"
                      )}
                    >
                      <Input
                        type="number"
                        inputMode="numeric"
                        min={SCORE_MIN}
                        max={SCORE_MAX}
                        step={1}
                        value={raw}
                        disabled={readOnly || pending}
                        onChange={(e) =>
                          setScore(learner.id, subject, e.target.value)
                        }
                        aria-label={`${learner.fullName} — ${LEARNING_AREA_LABELS[subject]} grade`}
                        aria-invalid={trimmed !== "" && !valid}
                        title={
                          failing
                            ? `Below the passing mark of ${PASSING_SCORE}`
                            : undefined
                        }
                        className={cn(
                          "h-8 min-w-[4.5rem] px-2 text-center tabular-nums",
                          failing && TONE_FAILING
                        )}
                      />
                    </TableCell>
                  );
                })}
                <TableCell className="border-l border-border/60 text-center text-sm font-semibold tabular-nums text-violet-700 dark:text-violet-300">
                  {average === null ? "—" : average.toFixed(2)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
});
