"use client";

import { forwardRef, useImperativeHandle, useState } from "react";
import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { generalAverage } from "@/lib/terms/average";
import { termGradingScale, termMarkText, type TermGradingScale } from "@/lib/terms/grading-scale";
import { subjectAbbreviation, subjectWindow } from "@/lib/terms/sheet-view";
import {
  TERM_MARK_OPTIONS,
  TERM_MARK_SHORT_LABELS,
  TERM_MARK_TONE,
} from "@/lib/constants/enum-labels";
import type { TermMark } from "@prisma/client";
import type { TermGradesSaveInput } from "@/lib/validators/term-grade.schema";
import { cn } from "@/lib/utils";

/**
 * 60 is the input floor, not 75. 75 is DepEd's passing mark, so it only tints a
 * cell — a failing learner has to be recordable or the sheet pushes teachers to
 * enter a false 75.
 */
export const SCORE_MIN = 60;
export const SCORE_MAX = 100;
const PASSING_SCORE = 75;

/** Borrowed from the reading-level grid's ramp so the ARAL grids read as one system. */
const TONE_FAILING =
  "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-300";

export type TermKey = "FIRST" | "SECOND" | "THIRD";

/** One column of the sheet — a School Head-managed `TermSubject`. */
export type TermGradesGridSubject = { id: string; name: string };

export type TermGradesGridLearner = {
  id: string;
  fullName: string;
  /** "3 - Atis": the Advisory / Section cell. */
  sectionLabel: string;
};

export type TermGradesGridExisting = {
  learnerId: string;
  termSubjectId: string;
  score: number | null;
  /** Grade 1 letter mark. Not rendered by this grid yet. */
  mark?: TermMark | null;
};

/**
 * The parent owns saving, because one sheet can hold several advisories and
 * each saves as its own section. It asks each grid for its changed cells, posts
 * them, then tells the grid those cells are now the saved state.
 */
export type AralTermGradesGridFormHandle = {
  collect: () => { entries: TermGradesSaveInput["entries"]; invalid: string[] };
  commit: () => void;
};

/**
 * A cell holds the raw input string so an emptied cell stays distinct from a 0.
 *
 * For a LETTER-scale grid (Grade 1) the string is instead one of:
 * - `""` — empty (never saved, or cleared)
 * - `score:87` — a legacy numeric score saved before letter marks existed
 * - `mark:ADVANCING` — a letter mark
 */
type RowState = Record<string, string>;

const LETTER_CLEAR = "CLEAR";
/**
 * The Select's value for a cell still holding a number saved before letter
 * marks existed. It must differ from `LETTER_CLEAR`: Radix only fires
 * `onValueChange` when the chosen value differs from the current one, so if a
 * legacy cell sat on `LETTER_CLEAR`, choosing Clear would be a silent no-op and
 * the old number could never be removed. No `SelectItem` carries this value —
 * the trigger renders the number through `SelectValue`'s children.
 */
const LETTER_LEGACY = "LEGACY";

type LetterCellState =
  | { kind: "empty" }
  | { kind: "legacyScore"; score: number }
  | { kind: "mark"; mark: TermMark };

function encodeMark(mark: TermMark): string {
  return `mark:${mark}`;
}

function encodeLegacyScore(score: number): string {
  return `score:${score}`;
}

function parseLetterCell(raw: string): LetterCellState {
  if (raw.startsWith("mark:")) return { kind: "mark", mark: raw.slice(5) as TermMark };
  if (raw.startsWith("score:")) return { kind: "legacyScore", score: Number(raw.slice(6)) };
  return { kind: "empty" };
}

function toRows(
  learners: TermGradesGridLearner[],
  existing: TermGradesGridExisting[],
  subjectIds: ReadonlySet<string>,
  scale: TermGradingScale
): Record<string, RowState> {
  const byLearner = new Map<string, RowState>();
  for (const record of existing) {
    if (!subjectIds.has(record.termSubjectId)) continue;
    if (scale === "LETTER") {
      const value = record.mark
        ? encodeMark(record.mark)
        : record.score !== null
          ? encodeLegacyScore(record.score)
          : null;
      if (value === null) continue;
      const row = byLearner.get(record.learnerId) ?? {};
      row[record.termSubjectId] = value;
      byLearner.set(record.learnerId, row);
      continue;
    }
    if (record.score === null) continue;
    const row = byLearner.get(record.learnerId) ?? {};
    row[record.termSubjectId] = String(record.score);
    byLearner.set(record.learnerId, row);
  }

  const init: Record<string, RowState> = {};
  for (const learner of learners) {
    init[learner.id] = { ...(byLearner.get(learner.id) ?? {}) };
  }
  return init;
}

function cellValue(row: RowState | undefined, subjectId: string): string {
  return row?.[subjectId] ?? "";
}

/** Whole number inside the recordable range. Anything else is refused on save. */
export function isValidScore(raw: string): boolean {
  const value = Number(raw);
  return Number.isInteger(value) && value >= SCORE_MIN && value <= SCORE_MAX;
}

/** Over EVERY subject, so hiding columns never changes a learner's average. */
function rowAverage(
  row: RowState | undefined,
  subjects: TermGradesGridSubject[]
): number | null {
  const scores: number[] = [];
  for (const subject of subjects) {
    const raw = cellValue(row, subject.id).trim();
    if (!raw || !isValidScore(raw)) continue;
    scores.push(Number(raw));
  }
  return generalAverage(scores);
}

type Props = {
  subjects: TermGradesGridSubject[];
  learners: TermGradesGridLearner[];
  initialGrades: TermGradesGridExisting[];
  /** Raw `GradeLevelType`; decides the scale via `termGradingScale` (Grade 1 = letter marks). */
  gradeType: string;
  /** Row-number offset so numbering continues across pages and groups. */
  indexOffset?: number;
  /** Inputs off: a locked term, an admin view, or a save in flight. */
  disabled?: boolean;
  /** Group heading ("Grade 3 - Atis"), shown when the sheet holds several. */
  groupLabel?: string;
  /** "First Term - 20%": the subjects header's second line. */
  termCaption: string;
  /**
   * The Subject filter. Null shows every column. Hidden columns keep their
   * edits and still count toward the general average.
   */
  visibleSubjectIds?: ReadonlySet<string> | null;
  /** The phone's five-subject window, shared by every group on the sheet. */
  subjectStep: number;
  onNextSubjects: () => void;
};

export const AralTermGradesGridForm = forwardRef<AralTermGradesGridFormHandle, Props>(
  function AralTermGradesGridForm(
    {
      subjects,
      learners,
      initialGrades,
      gradeType,
      indexOffset = 0,
      disabled,
      groupLabel,
      termCaption,
      visibleSubjectIds = null,
      subjectStep,
      onNextSubjects,
    },
    ref
  ) {
    const scale = termGradingScale(gradeType);
    const showGeneralAverage = scale === "NUMERIC";
    const subjectIds = new Set(subjects.map((s) => s.id));
    /**
     * What the sheet looked like when it loaded. Saves send the difference, so an
     * untouched cell is never rewritten and "No changes to save" is honest.
     */
    const [initial, setInitial] = useState(() =>
      toRows(learners, initialGrades, subjectIds, scale)
    );
    const [rows, setRows] = useState(initial);

    function setScore(learnerId: string, subjectId: string, value: string) {
      setRows((prev) => ({
        ...prev,
        [learnerId]: { ...(prev[learnerId] ?? {}), [subjectId]: value },
      }));
    }

    useImperativeHandle(
      ref,
      () => ({
        collect() {
          const entries: TermGradesSaveInput["entries"] = [];
          const invalid: string[] = [];
          for (const learner of learners) {
            for (const subject of subjects) {
              const before = cellValue(initial[learner.id], subject.id).trim();
              const after = cellValue(rows[learner.id], subject.id).trim();
              if (before === after) continue;
              if (scale === "LETTER") {
                if (after === "") {
                  entries.push({
                    learnerId: learner.id,
                    termSubjectId: subject.id,
                    score: null,
                    mark: null,
                  });
                  continue;
                }
                const state = parseLetterCell(after);
                // A "legacyScore" `after` value can't come from user input — the
                // select only ever writes "" (Clear) or a mark — so it is never sent.
                if (state.kind === "mark") {
                  entries.push({
                    learnerId: learner.id,
                    termSubjectId: subject.id,
                    mark: state.mark,
                  });
                }
                continue;
              }
              if (after === "") {
                entries.push({ learnerId: learner.id, termSubjectId: subject.id, score: null });
                continue;
              }
              if (!isValidScore(after)) {
                if (!invalid.includes(learner.fullName)) invalid.push(learner.fullName);
                continue;
              }
              entries.push({
                learnerId: learner.id,
                termSubjectId: subject.id,
                score: Number(after),
              });
            }
          }
          return { entries, invalid };
        },
        // The sheet is clean again, so the next save sends only what changes
        // after this point rather than resending the whole term.
        commit() {
          setInitial(rows);
        },
      }),
      [learners, subjects, initial, rows, scale]
    );

    const shown = visibleSubjectIds
      ? subjects.filter((s) => visibleSubjectIds.has(s.id))
      : subjects;
    const phoneWindow = subjectWindow(shown.length, subjectStep);
    const phoneSubjects = shown.slice(phoneWindow.start, phoneWindow.end);

    function letterMarkSelect(
      learner: TermGradesGridLearner,
      subject: TermGradesGridSubject,
      className: string
    ) {
      const raw = cellValue(rows[learner.id], subject.id);
      const state = parseLetterCell(raw);
      const selectValue =
        state.kind === "mark"
          ? state.mark
          : state.kind === "legacyScore"
            ? LETTER_LEGACY
            : LETTER_CLEAR;
      const legacyTitle =
        state.kind === "legacyScore"
          ? "Saved as a number before letter marks. Pick a letter to replace it."
          : undefined;
      return (
        <Select
          value={selectValue}
          onValueChange={(value) =>
            setScore(
              learner.id,
              subject.id,
              value === LETTER_CLEAR ? "" : encodeMark(value as TermMark)
            )
          }
          disabled={disabled}
        >
          <SelectTrigger
            aria-label={`${learner.fullName} — ${subject.name} grade`}
            title={legacyTitle}
            className={cn(
              "px-1 justify-center [&>svg]:hidden sm:[&>svg]:inline",
              state.kind === "mark" && TERM_MARK_TONE[state.mark].cell,
              className
            )}
          >
            <SelectValue>
              {state.kind === "mark" ? (
                TERM_MARK_SHORT_LABELS[state.mark]
              ) : state.kind === "legacyScore" ? (
                <span className="text-muted-foreground">{state.score}</span>
              ) : (
                "—"
              )}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={LETTER_CLEAR}>Unassigned</SelectItem>
            {TERM_MARK_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className={cn("size-2 shrink-0 rounded-full", TERM_MARK_TONE[option.value].dot)}
                    aria-hidden
                  />
                  <span className={TERM_MARK_TONE[option.value].text}>
                    {termMarkText(option.value)}
                  </span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }

    function scoreInput(
      learner: TermGradesGridLearner,
      subject: TermGradesGridSubject,
      className: string,
      placeholder?: string
    ) {
      if (scale === "LETTER") return letterMarkSelect(learner, subject, className);
      const raw = cellValue(rows[learner.id], subject.id);
      const trimmed = raw.trim();
      const valid = trimmed !== "" && isValidScore(trimmed);
      const failing = valid && Number(trimmed) < PASSING_SCORE;
      return (
        <Input
          type="number"
          inputMode="numeric"
          min={SCORE_MIN}
          max={SCORE_MAX}
          step={1}
          value={raw}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(e) => setScore(learner.id, subject.id, e.target.value)}
          aria-label={`${learner.fullName} — ${subject.name} grade`}
          aria-invalid={trimmed !== "" && !valid}
          title={failing ? `Below the passing mark of ${PASSING_SCORE}` : undefined}
          className={cn(
            "rounded-lg px-1 text-center tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
            className,
            failing && TONE_FAILING
          )}
        />
      );
    }

    const heading = groupLabel ? (
      <p className="border-b border-border/60 bg-violet-50/60 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-violet-700 dark:bg-violet-950/30 dark:text-violet-300">
        {groupLabel}
      </p>
    ) : null;

    if (subjects.length === 0) {
      return (
        <div>
          {heading}
          <p className="p-4 text-sm text-muted-foreground">
            Your School Head has not set subjects for this grade.
          </p>
        </div>
      );
    }

    return (
      <div>
        {heading}

        {/* Desktop (xl): the full sheet, every visible subject in one row. */}
        <div className="hidden overflow-x-auto xl:block">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead rowSpan={2} className="w-12 text-center">
                  #
                </TableHead>
                <TableHead rowSpan={2} className="min-w-[12rem]">
                  Complete Name
                </TableHead>
                <TableHead rowSpan={2} className="min-w-[7rem]">
                  <span className="block">Advisory /</span>
                  <span className="block">Section</span>
                </TableHead>
                <TableHead
                  colSpan={shown.length}
                  scope="colgroup"
                  className="h-auto border-l border-border/60 py-2 text-center"
                >
                  <span className="block">Subjects and Grades</span>
                  <span className="block font-normal normal-case tracking-normal text-muted-foreground">
                    {termCaption}
                  </span>
                </TableHead>
                {showGeneralAverage && (
                  <TableHead
                    rowSpan={2}
                    scope="col"
                    className="w-28 border-l border-border/60 bg-violet-50/70 text-center text-violet-700 dark:bg-violet-950/30 dark:text-violet-300"
                  >
                    <span className="block">General</span>
                    <span className="block">Average</span>
                  </TableHead>
                )}
              </TableRow>
              <TableRow className="hover:bg-transparent">
                {shown.map((subject, index) => (
                  <TableHead
                    key={subject.id}
                    className={cn(
                      "h-auto min-w-[6.5rem] py-2 text-center leading-tight",
                      index === 0 && "border-l border-border/60"
                    )}
                  >
                    {subject.name}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {learners.map((learner, index) => {
                const average = showGeneralAverage ? rowAverage(rows[learner.id], subjects) : null;
                return (
                  <TableRow key={learner.id}>
                    <TableCell className="text-center text-sm tabular-nums text-muted-foreground">
                      {indexOffset + index + 1}
                    </TableCell>
                    <TableCell className="font-medium">{learner.fullName}</TableCell>
                    <TableCell className="text-muted-foreground">{learner.sectionLabel}</TableCell>
                    {shown.map((subject, subjectIndex) => (
                      <TableCell
                        key={subject.id}
                        className={cn("px-2", subjectIndex === 0 && "border-l border-border/60")}
                      >
                        {scoreInput(learner, subject, "h-9 w-full min-w-[4.5rem]")}
                      </TableCell>
                    ))}
                    {showGeneralAverage && (
                      <TableCell className="border-l border-border/60 bg-violet-50/70 text-center text-base font-bold tabular-nums text-violet-700 dark:bg-violet-950/30 dark:text-violet-300">
                        {average === null ? "—" : average.toFixed(2)}
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        {/* Phones and tablets: five subjects at a time; both chevrons step on. */}
        <div className="xl:hidden">
          <div className={cn(PHONE_ROW, "text-xs text-muted-foreground sm:text-sm")}>
            <span className="text-center">#</span>
            <span className="min-w-0 leading-tight">
              <span className="block">Learner Name</span>
              <span className="block text-xs italic">Advisory Section</span>
            </span>
            <span className={cn(PHONE_SUBJECTS, "truncate")}>Subjects ({termCaption})</span>
            <NextSubjectsButton onClick={onNextSubjects} windows={phoneWindow.windows} />
          </div>
          <ul>
            {learners.map((learner, index) => (
              <li key={learner.id} className={cn(PHONE_ROW, "last:border-b-0")}>
                <span className="text-center text-sm tabular-nums text-muted-foreground">
                  {indexOffset + index + 1}
                </span>
                <span className="min-w-0">
                  <span className="line-clamp-2 break-words text-sm font-medium leading-snug text-blue-700 dark:text-blue-300">
                    {learner.fullName}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {learner.sectionLabel}
                  </span>
                </span>
                <span
                  className={cn(PHONE_SUBJECTS, "grid gap-1")}
                  style={{ gridTemplateColumns: `repeat(${Math.max(1, phoneSubjects.length)}, minmax(0, 1fr))` }}
                >
                  {phoneSubjects.map((subject) => {
                    const abbreviation = (
                      <span
                        className="whitespace-nowrap text-[11px] font-medium uppercase tracking-tighter text-muted-foreground"
                        aria-hidden
                      >
                        {subjectAbbreviation(subject.name)}
                      </span>
                    );
                    const control = scoreInput(
                      learner,
                      subject,
                      "h-9 w-full min-w-0 px-0 text-[13px] sm:text-sm",
                      "—"
                    );
                    // A `label` only forwards a tap to a *labelable* element. The
                    // letter-mark control is a button, which is not one, so on a
                    // Grade 1 sheet the abbreviation would look tappable and do
                    // nothing. Plain `div` there; the trigger carries its own
                    // aria-label either way.
                    return scale === "LETTER" ? (
                      <div key={subject.id} className="flex min-w-0 flex-col items-center gap-1">
                        {abbreviation}
                        {control}
                      </div>
                    ) : (
                      <label key={subject.id} className="flex min-w-0 flex-col items-center gap-1">
                        {abbreviation}
                        {control}
                      </label>
                    );
                  })}
                </span>
                <NextSubjectsButton onClick={onNextSubjects} windows={phoneWindow.windows} />
              </li>
            ))}
          </ul>
        </div>

        {scale === "LETTER" && <TermMarkLegend />}
      </div>
    );
  }
);

/** The five letter marks and their colour, once per LETTER-scale grid. */
function TermMarkLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-border/60 px-4 py-3 text-xs text-muted-foreground">
      {TERM_MARK_OPTIONS.map((option) => (
        <span key={option.value} className="inline-flex items-center gap-1.5">
          <span
            className={cn("size-2.5 shrink-0 rounded-full", TERM_MARK_TONE[option.value].dot)}
            aria-hidden
          />
          <span className={TERM_MARK_TONE[option.value].text}>{termMarkText(option.value)}</span>
        </span>
      ))}
    </div>
  );
}

/**
 * The phone row: number, name, the five-subject block, the chevron. The block
 * takes a fixed share of the row — 5 × 30px at 375px wide, enough for "100" —
 * and the name wraps onto two lines in what is left.
 */
const PHONE_ROW =
  "grid grid-cols-[1.25rem_minmax(0,1fr)_auto_1.75rem] items-center gap-2 border-b border-border/60 px-3 py-3 sm:grid-cols-[2rem_minmax(0,1fr)_auto_2rem] sm:gap-3";
const PHONE_SUBJECTS = "w-[10.25rem] sm:w-[18rem] md:w-[24rem]";

function NextSubjectsButton({ onClick, windows }: { onClick: () => void; windows: number }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-8 justify-self-end text-muted-foreground"
      onClick={onClick}
      disabled={windows <= 1}
      aria-label="Next subjects"
    >
      <ChevronRight className="size-5" aria-hidden />
    </Button>
  );
}
