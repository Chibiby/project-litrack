"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
  useTransition,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, ChevronDown, MessageSquare, MoreVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { LearnerAvatar } from "@/components/learners/learner-avatar";
import {
  READING_PROFILE_LABELS_G4_PLUS,
  READING_PROFILE_LABELS_K3,
  WEEKLY_READING_COMPREHENSION_LEVEL_LABELS,
  WEEKLY_WORD_RECOGNITION_LEVEL_LABELS,
  WEEKLY_WRITING_LEVEL_LABELS,
  isEarlyGradeReadingBand,
} from "@/lib/constants/enum-labels";
import { cn } from "@/lib/utils";
import { bulkRecordMonthlyReadingLevel } from "@/lib/actions/reading-level";

/**
 * The colour ramp, borrowed wholesale from the weekly attendance grid so the two
 * ARAL grids read as one system. Low band → rose, top band → emerald, and empty
 * keeps the neutral input tone so an unassessed cell never looks like a score.
 */
const TONE_EMPTY = "border-input bg-background text-muted-foreground";
const TONE_RAMP = [
  "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-300",
  "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300",
  "border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-300",
  "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300",
];
/**
 * "Not applicable" is a recorded answer, not a blank, so it reads as a filled
 * chip against the empty cell's bare ground and carries full-strength text
 * instead of the placeholder's muted tone. Semantic tokens rather than a slate
 * ramp: they invert with the theme on their own, which is the whole point of the
 * palette rule — and it matches `reading-band-pill`'s neutral, so "no value
 * here" looks the same wherever it appears.
 */
const TONE_NA = "border-border bg-muted text-foreground";

/**
 * A cell's tint comes from where its value sits on that field's OWN scale, not
 * from a shared level number. Reading comprehension tops out at Level 3 and word
 * recognition at Level 5; ranking each within its own range is what stops "the
 * best available answer" from rendering as mid-amber in one column and emerald in
 * the next.
 */
function rampTone(index: number, count: number): string {
  if (count <= 1) return TONE_RAMP[TONE_RAMP.length - 1];
  const fraction = index / (count - 1);
  const slot = Math.min(
    TONE_RAMP.length - 1,
    Math.floor(fraction * TONE_RAMP.length)
  );
  return TONE_RAMP[slot];
}

/** Short codes for the badge face. The dropdown always carries the full label. */
const PROFILE_CODES_K3: Record<string, string> = {
  NON_DECODER_LOW_EMERGENT: "LE",
  FRUSTRATION_HIGH_EMERGENT: "HE",
  INSTRUCTIONAL_DEVELOPING: "DT",
  INDEPENDENT_GRADE_READY: "GR",
};
const PROFILE_CODES_G4_PLUS: Record<string, string> = {
  NON_DECODER_LOW_EMERGENT: "ND",
  FRUSTRATION_HIGH_EMERGENT: "FR",
  INSTRUCTIONAL_DEVELOPING: "IP",
  INDEPENDENT_GRADE_READY: "IPR",
};
const LEVEL_CODES: Record<string, string> = {
  LEVEL_0: "L0",
  LEVEL_1: "L1",
  LEVEL_2: "L2",
  LEVEL_3: "L3",
  LEVEL_4: "L4",
  LEVEL_5: "L5",
  NA: "N/A",
};

/** Low → high. The enum-label maps list `LEVEL_0` last; the scale starts there. */
const PROFILE_ORDER = [
  "NON_DECODER_LOW_EMERGENT",
  "FRUSTRATION_HIGH_EMERGENT",
  "INSTRUCTIONAL_DEVELOPING",
  "INDEPENDENT_GRADE_READY",
];
const WORD_RECOGNITION_ORDER = [
  "LEVEL_0",
  "LEVEL_1",
  "LEVEL_2",
  "LEVEL_3",
  "LEVEL_4",
  "LEVEL_5",
];
const READING_COMPREHENSION_ORDER = ["LEVEL_0", "LEVEL_1", "LEVEL_2", "LEVEL_3"];
const WRITING_ORDER = WORD_RECOGNITION_ORDER;

type BandOption = { value: string; code: string; label: string; tone: string };

/** One scale: ordered options, each carrying its code, full label, and tint. */
function buildBand(
  order: string[],
  codes: Record<string, string>,
  labels: Record<string, string>,
  includeNa: boolean
): BandOption[] {
  const options = order.map((value, index) => ({
    value,
    code: codes[value] ?? value,
    label: labels[value] ?? value,
    tone: rampTone(index, order.length),
  }));
  if (includeNa && "NA" in labels) {
    options.push({
      value: "NA",
      code: codes.NA ?? "N/A",
      label: labels.NA,
      tone: TONE_NA,
    });
  }
  return options;
}

const WORD_RECOGNITION_BAND = buildBand(
  WORD_RECOGNITION_ORDER,
  LEVEL_CODES,
  WEEKLY_WORD_RECOGNITION_LEVEL_LABELS,
  true
);
const READING_COMPREHENSION_BAND = buildBand(
  READING_COMPREHENSION_ORDER,
  LEVEL_CODES,
  WEEKLY_READING_COMPREHENSION_LEVEL_LABELS,
  true
);
const WRITING_BAND = buildBand(
  WRITING_ORDER,
  LEVEL_CODES,
  WEEKLY_WRITING_LEVEL_LABELS,
  true
);

/**
 * The reading profile scale for this grade only. A Grade 3 sheet shows the
 * Kinder–G3 wording and a Grade 5 sheet the G4-and-up wording; showing both at
 * once is how the comp reads, but on a page pinned to one grade the other band is
 * just noise a teacher has to filter out.
 */
function profileBandFor(gradeType: string): BandOption[] {
  const early = isEarlyGradeReadingBand(gradeType);
  return buildBand(
    PROFILE_ORDER,
    early ? PROFILE_CODES_K3 : PROFILE_CODES_G4_PLUS,
    early ? READING_PROFILE_LABELS_K3 : READING_PROFILE_LABELS_G4_PLUS,
    false
  );
}

export type MonthlyReadingLevelGridLearner = {
  id: string;
  fullName: string;
};

export type MonthlyReadingLevelGridExisting = {
  learnerId: string;
  englishProfile: string;
  filipinoProfile: string;
  wordRecognitionLevel: string | null;
  readingComprehensionLevel: string | null;
  writingLevel: string | null;
  notes: string | null;
};

export type AralMonthlyReadingLevelGridFormHandle = { save: () => void };

type ReadingLevelProgress = {
  /** All four required fields set — this learner is assessed for the month. */
  completed: number;
  /** Something entered, but not enough to save. */
  partial: number;
  notAssessed: number;
};

type RowState = {
  englishProfile: string;
  filipinoProfile: string;
  wordRecognitionLevel: string;
  readingComprehensionLevel: string;
  writingLevel: string;
  notes: string;
};

const EMPTY_ROW: RowState = {
  englishProfile: "",
  filipinoProfile: "",
  wordRecognitionLevel: "",
  readingComprehensionLevel: "",
  writingLevel: "",
  notes: "",
};

/**
 * Writing level is deliberately NOT required: the column is nullable, rows
 * predating it have none, and a teacher may have reading data before writing is
 * assessed. It still counts toward `hasAnyValue`, so a row where writing is the
 * only entry prompts for the four required fields rather than saving silently.
 */
function isRowComplete(row: RowState | undefined): boolean {
  return (
    !!row?.englishProfile &&
    !!row.filipinoProfile &&
    !!row.wordRecognitionLevel &&
    !!row.readingComprehensionLevel
  );
}

function hasAnyValue(row: RowState | undefined): boolean {
  if (!row) return false;
  return (
    !!row.englishProfile ||
    !!row.filipinoProfile ||
    !!row.wordRecognitionLevel ||
    !!row.readingComprehensionLevel ||
    !!row.writingLevel ||
    !!row.notes.trim()
  );
}

function toRows(
  learners: MonthlyReadingLevelGridLearner[],
  existing: MonthlyReadingLevelGridExisting[]
): Record<string, RowState> {
  const byLearner = new Map(existing.map((r) => [r.learnerId, r]));
  const init: Record<string, RowState> = {};
  for (const learner of learners) {
    const found = byLearner.get(learner.id);
    init[learner.id] = found
      ? {
          englishProfile: found.englishProfile ?? "",
          filipinoProfile: found.filipinoProfile ?? "",
          wordRecognitionLevel: found.wordRecognitionLevel ?? "",
          readingComprehensionLevel: found.readingComprehensionLevel ?? "",
          writingLevel: found.writingLevel ?? "",
          notes: found.notes ?? "",
        }
      : { ...EMPTY_ROW };
  }
  return init;
}

/**
 * The grid's own live counts, for the footer strip. Deliberately scoped to the
 * learners on screen: the panel's banner shows the grade-wide figure the server
 * counted, and labelling these two differently ("on this page" vs "this month")
 * is what keeps them from reading as a contradiction.
 */
function countRows(rows: Record<string, RowState>, ids: string[]): ReadingLevelProgress {
  let completed = 0;
  let partial = 0;
  for (const id of ids) {
    const row = rows[id];
    if (isRowComplete(row)) completed += 1;
    else if (hasAnyValue(row)) partial += 1;
  }
  return {
    completed,
    partial,
    notAssessed: ids.length - completed - partial,
  };
}

type Props = {
  /** `YYYY-MM-01` — the month this sheet writes to. */
  monthStartKey: string;
  gradeType: string;
  learners: MonthlyReadingLevelGridLearner[];
  existing: MonthlyReadingLevelGridExisting[];
  /** Row-number offset so numbering continues across pages. */
  indexOffset?: number;
  learnerHrefFor?: (learnerId: string) => string;
  readOnly?: boolean;
  onSavePendingChange?: (pending: boolean) => void;
};

export const AralMonthlyReadingLevelGridForm = forwardRef<
  AralMonthlyReadingLevelGridFormHandle,
  Props
>(function AralMonthlyReadingLevelGridForm(
  {
    monthStartKey,
    gradeType,
    learners,
    existing,
    indexOffset = 0,
    learnerHrefFor,
    readOnly,
    onSavePendingChange,
  },
  ref
) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [rows, setRows] = useState(() => toRows(learners, existing));

  const profileBand = useMemo(() => profileBandFor(gradeType), [gradeType]);
  const learnerIds = useMemo(() => learners.map((l) => l.id), [learners]);
  const progress = useMemo(() => countRows(rows, learnerIds), [rows, learnerIds]);

  useEffect(() => {
    onSavePendingChange?.(pending);
  }, [pending, onSavePendingChange]);

  function setField(learnerId: string, field: keyof RowState, value: string) {
    setRows((prev) => {
      const row = prev[learnerId];
      if (!row) return prev;
      return { ...prev, [learnerId]: { ...row, [field]: value } };
    });
  }

  const handleSave = useCallback(() => {
    if (readOnly || pending) return;

    const entries = learners
      .filter((learner) => isRowComplete(rows[learner.id]))
      .map((learner) => {
        const row = rows[learner.id]!;
        return {
          learnerId: learner.id,
          englishProfile: row.englishProfile,
          filipinoProfile: row.filipinoProfile,
          wordRecognitionLevel: row.wordRecognitionLevel,
          readingComprehensionLevel: row.readingComprehensionLevel,
          writingLevel: row.writingLevel || undefined,
          notes: row.notes.trim() || undefined,
        };
      });

    if (entries.length === 0) {
      toast.error(
        "Set English, Filipino, Word recognition, and Reading comprehension for at least one learner"
      );
      return;
    }

    const incomplete = learners.filter(
      (learner) => hasAnyValue(rows[learner.id]) && !isRowComplete(rows[learner.id])
    );
    if (incomplete.length > 0) {
      const names = incomplete.slice(0, 3).map((l) => l.fullName).join(", ");
      const rest = incomplete.length > 3 ? ` and ${incomplete.length - 3} more` : "";
      toast.error(
        `Complete all four reading levels for ${names}${rest}, or clear the row before saving.`
      );
      return;
    }

    startTransition(async () => {
      const toastId = toast.loading("Saving monthly reading levels…");
      const res = await bulkRecordMonthlyReadingLevel({
        monthStart: monthStartKey,
        entries,
      });
      if (!res.ok) {
        toast.error(res.error, { id: toastId });
        return;
      }
      const saved = res.data?.upserted ?? entries.length;
      toast.success(
        `Saved reading levels for ${saved} learner${saved === 1 ? "" : "s"}`,
        { id: toastId }
      );
      router.refresh();
    });
  }, [readOnly, pending, learners, rows, monthStartKey, router]);

  useImperativeHandle(ref, () => ({ save: handleSave }), [handleSave]);

  if (learners.length === 0) {
    return (
      <p className="p-4 text-sm text-muted-foreground">
        No ARAL learners match this filter.
      </p>
    );
  }

  function renderRow(learner: MonthlyReadingLevelGridLearner, rowNumber: number) {
    const row = rows[learner.id] ?? EMPTY_ROW;
    return (
      <TableRow key={learner.id}>
        <TableCell className="text-sm text-muted-foreground tabular-nums">
          {rowNumber}
        </TableCell>
        <TableCell>
          <span className="flex items-center gap-2.5">
            <LearnerAvatar id={learner.id} fullName={learner.fullName} />
            <span className="font-medium">{learner.fullName}</span>
          </span>
        </TableCell>
        <TableCell>
          <BandSelect
            options={profileBand}
            value={row.englishProfile}
            disabled={readOnly || pending}
            label={`${learner.fullName} — English reading level`}
            onChange={(v) => setField(learner.id, "englishProfile", v)}
          />
        </TableCell>
        <TableCell>
          <BandSelect
            options={profileBand}
            value={row.filipinoProfile}
            disabled={readOnly || pending}
            label={`${learner.fullName} — Filipino reading level`}
            onChange={(v) => setField(learner.id, "filipinoProfile", v)}
          />
        </TableCell>
        <TableCell>
          <BandSelect
            options={WORD_RECOGNITION_BAND}
            value={row.wordRecognitionLevel}
            disabled={readOnly || pending}
            label={`${learner.fullName} — word recognition level`}
            onChange={(v) => setField(learner.id, "wordRecognitionLevel", v)}
          />
        </TableCell>
        <TableCell>
          <BandSelect
            options={READING_COMPREHENSION_BAND}
            value={row.readingComprehensionLevel}
            disabled={readOnly || pending}
            label={`${learner.fullName} — reading comprehension level`}
            onChange={(v) => setField(learner.id, "readingComprehensionLevel", v)}
          />
        </TableCell>
        <TableCell>
          <BandSelect
            options={WRITING_BAND}
            value={row.writingLevel}
            disabled={readOnly || pending}
            label={`${learner.fullName} — writing level`}
            onChange={(v) => setField(learner.id, "writingLevel", v)}
          />
        </TableCell>
        <TableCell>
          <RemarksCell
            value={row.notes}
            disabled={readOnly || pending}
            learnerName={learner.fullName}
            onChange={(v) => setField(learner.id, "notes", v)}
          />
        </TableCell>
        {learnerHrefFor && (
          <TableCell>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label={`Actions for ${learner.fullName}`}
                >
                  <MoreVertical className="size-4" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <Link href={learnerHrefFor(learner.id)}>View reading history</Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </TableCell>
        )}
      </TableRow>
    );
  }

  return (
    <>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">#</TableHead>
              <TableHead className="min-w-[200px]">Learner</TableHead>
              <ScaleHead title="English" sub="Reading Level" />
              <ScaleHead title="Filipino" sub="Reading Level" />
              <ScaleHead title="Word Recognition" sub="Level" />
              <ScaleHead title="Reading Comprehension" sub="Level" />
              <ScaleHead title="Writing" sub="Level" />
              <TableHead className="w-24 text-center">Remarks</TableHead>
              {learnerHrefFor && (
                <TableHead className="w-12 text-center">Actions</TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {learners.map((learner, index) =>
              renderRow(learner, indexOffset + index + 1)
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border/60 p-4 text-xs text-muted-foreground">
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {profileBand.map((option) => (
            <span key={option.value} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className={cn(
                  "inline-flex h-5 min-w-[1.75rem] items-center justify-center rounded border px-1 text-[11px] font-semibold",
                  option.tone
                )}
              >
                {option.code}
              </span>
              {option.label}
            </span>
          ))}
        </span>
        <span aria-hidden className="hidden h-4 w-px bg-border sm:block" />
        <span className="rounded-full bg-muted px-2.5 py-1 font-medium text-foreground">
          {learners.length} learner{learners.length === 1 ? "" : "s"} on this page
        </span>
        <span>
          Completed:{" "}
          <span className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
            {progress.completed}
          </span>
        </span>
        <span>
          Partial:{" "}
          <span className="font-semibold tabular-nums text-amber-600 dark:text-amber-400">
            {progress.partial}
          </span>
        </span>
        <span>
          Not assessed:{" "}
          <span className="font-semibold tabular-nums text-foreground">
            {progress.notAssessed}
          </span>
        </span>
      </div>
    </>
  );
});

function ScaleHead({ title, sub }: { title: string; sub: string }) {
  return (
    <TableHead className="min-w-[84px] text-center">
      <span className="block">{title}</span>
      <span className="block font-normal normal-case tracking-normal text-muted-foreground">
        {sub}
      </span>
    </TableHead>
  );
}

/**
 * A compact colour-coded band picker. The face is the short code so five scales
 * fit one row; the list carries the full DepEd descriptor.
 *
 * This was a transparent native `<select>` layered over the badge. That rendered
 * as the platform's own list — square, unthemed, ignoring the band tints entirely
 * — which is what made this grid look unlike the rest of the app. It is now a
 * popover listbox styled like the weekly-attendance picker.
 *
 * The native control's real advantage was keyboard entry, and a teacher fills
 * this grid a hundred cells at a time, so that is reimplemented rather than lost:
 * Up/Down move, Home/End jump, Enter/Space commit, Escape closes, and typing a
 * letter jumps to the next option starting with it. `role="listbox"` with
 * `aria-selected` on every option is what keeps a screen reader hearing a select.
 */
function BandSelect({
  options,
  value,
  disabled,
  label,
  onChange,
}: {
  options: BandOption[];
  value: string;
  disabled?: boolean;
  label: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);
  // "Not assessed" is a real entry in the list, not a placeholder, so clearing a
  // cell is reachable by the same keys as setting one.
  const entries: { value: string; code: string; label: string; tone: string }[] = [
    { value: "", code: "—", label: "Not assessed", tone: TONE_EMPTY },
    ...options,
  ];
  const selectedIndex = Math.max(
    0,
    entries.findIndex((e) => e.value === value)
  );
  const [active, setActive] = useState(selectedIndex);

  // Reopening lands on the current value rather than wherever the last visit
  // left the cursor.
  useEffect(() => {
    if (open) setActive(selectedIndex);
  }, [open, selectedIndex]);

  function commit(next: string) {
    onChange(next);
    setOpen(false);
  }

  function onKeyDown(e: ReactKeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => {
        const step = e.key === "ArrowDown" ? 1 : -1;
        return (i + step + entries.length) % entries.length;
      });
      return;
    }
    if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
      return;
    }
    if (e.key === "End") {
      e.preventDefault();
      setActive(entries.length - 1);
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      commit(entries[active]?.value ?? "");
      return;
    }
    if (e.key.length === 1 && /[a-z0-9]/i.test(e.key)) {
      // Typeahead over the code then the label, matching what a native select
      // does with the option text. The search starts one past the cursor and
      // wraps, so pressing the same letter twice steps through the matches.
      const key = e.key.toLowerCase();
      const from = active + 1;
      const hit = entries
        .map((_, i) => (from + i) % entries.length)
        .find((i) => {
          const entry = entries[i];
          return (
            entry.code.toLowerCase().startsWith(key) ||
            entry.label.toLowerCase().startsWith(key)
          );
        });
      if (hit !== undefined) setActive(hit);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={label}
          title={selected ? `${selected.code} — ${selected.label}` : "Not assessed"}
          className={cn(
            "flex h-8 w-full min-w-[3.75rem] items-center justify-center gap-1 rounded-md border px-1.5 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60",
            selected ? selected.tone : TONE_EMPTY
          )}
        >
          <span aria-hidden className="tabular-nums">
            {selected ? selected.code : "—"}
          </span>
          <ChevronDown aria-hidden className="size-3 shrink-0 opacity-60" />
        </button>
      </PopoverTrigger>
      {/* Radix moves focus onto the content when it opens, so the key handler
          sits here rather than on a list that would need focusing by hand. */}
      <PopoverContent
        align="start"
        className="w-64 p-1"
        onKeyDown={onKeyDown}
      >
        <ul
          role="listbox"
          aria-label={label}
          className="max-h-72 overflow-y-auto focus:outline-none"
        >
          {entries.map((entry, i) => (
            <li
              key={entry.value || "none"}
              role="option"
              aria-selected={entry.value === value}
              onClick={() => commit(entry.value)}
              onMouseEnter={() => setActive(i)}
              className={cn(
                "flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm",
                i === active && "bg-accent"
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "flex h-6 min-w-[2rem] shrink-0 items-center justify-center rounded-full border px-1 text-[11px] font-bold tabular-nums",
                  entry.tone
                )}
              >
                {entry.code}
              </span>
              <span className="min-w-0 flex-1">{entry.label}</span>
              {entry.value === value && (
                <Check aria-hidden className="size-4 shrink-0 opacity-70" />
              )}
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Remarks behind a popover rather than an always-open input. Five band columns
 * plus a free-text field does not fit a readable row width, and a remark is the
 * exception here, not the rule — so the trigger tints when one exists and the
 * textarea comes to the teacher who wants it.
 */
function RemarksCell({
  value,
  disabled,
  learnerName,
  onChange,
}: {
  value: string;
  disabled?: boolean;
  learnerName: string;
  onChange: (value: string) => void;
}) {
  const filled = value.trim().length > 0;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          disabled={disabled}
          title={filled ? value : `Add remarks for ${learnerName}`}
          aria-label={
            filled
              ? `Edit remarks for ${learnerName}`
              : `Add remarks for ${learnerName}`
          }
          className={cn(
            "mx-auto size-8",
            filled &&
              "border-violet-300 bg-violet-50 text-violet-700 hover:bg-violet-100 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-300"
          )}
        >
          <MessageSquare className="size-4" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-2">
        <p className="text-sm font-medium">Remarks — {learnerName}</p>
        <Textarea
          value={value}
          maxLength={1000}
          rows={4}
          disabled={disabled}
          placeholder="Optional notes on this month's assessment"
          onChange={(e) => onChange(e.target.value)}
          aria-label={`Remarks for ${learnerName}`}
        />
        <p className="text-xs text-muted-foreground">
          {value.trim().length}/1000 · saved with the assessment
        </p>
      </PopoverContent>
    </Popover>
  );
}
