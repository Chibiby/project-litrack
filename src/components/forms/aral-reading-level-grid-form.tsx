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
  READING_PROFILE_LABELS,
  WEEKLY_WORD_RECOGNITION_LEVEL_LABELS,
  WEEKLY_READING_COMPREHENSION_LEVEL_LABELS,
  readingProfileLabelsForGradeType,
  toOptions,
} from "@/lib/constants/enum-labels";
import { bulkRecordWeeklyReadingLevel } from "@/lib/actions/reading-level";

const WR_OPTIONS = toOptions(WEEKLY_WORD_RECOGNITION_LEVEL_LABELS);
const RC_OPTIONS = toOptions(WEEKLY_READING_COMPREHENSION_LEVEL_LABELS);

type Profile = keyof typeof READING_PROFILE_LABELS;
type WrLevel = keyof typeof WEEKLY_WORD_RECOGNITION_LEVEL_LABELS;
type RcLevel = keyof typeof WEEKLY_READING_COMPREHENSION_LEVEL_LABELS;

export type ReadingLevelGridLearner = {
  id: string;
  fullName: string;
  sectionName: string | null;
};

export type ReadingLevelGridExisting = {
  learnerId: string;
  englishProfile: string;
  filipinoProfile: string;
  wordRecognitionLevel: string | null;
  readingComprehensionLevel: string | null;
  notes: string | null;
};

export type AralReadingLevelGridFormHandle = {
  save: () => void;
};

type RowState = {
  englishProfile: Profile | "";
  filipinoProfile: Profile | "";
  wordRecognitionLevel: WrLevel | "";
  readingComprehensionLevel: RcLevel | "";
  notes: string;
};

type Props = {
  weekStartKey: string;
  /** Grade type for band-specific reading profile labels. */
  gradeType: string;
  learners: ReadingLevelGridLearner[];
  existing: ReadingLevelGridExisting[];
  showSection?: boolean;
  readOnly?: boolean;
  onSavePendingChange?: (pending: boolean) => void;
};

function isProfile(v: string): v is Profile {
  return v in READING_PROFILE_LABELS;
}

function isWrLevel(v: string): v is WrLevel {
  return v in WEEKLY_WORD_RECOGNITION_LEVEL_LABELS;
}

function isRcLevel(v: string): v is RcLevel {
  return v in WEEKLY_READING_COMPREHENSION_LEVEL_LABELS;
}

function toInitial(
  learners: ReadingLevelGridLearner[],
  existing: ReadingLevelGridExisting[]
): Record<string, RowState> {
  const byId = new Map(existing.map((e) => [e.learnerId, e]));
  const init: Record<string, RowState> = {};
  for (const l of learners) {
    const row = byId.get(l.id);
    init[l.id] = {
      englishProfile:
        row && isProfile(row.englishProfile) ? row.englishProfile : "",
      filipinoProfile:
        row && isProfile(row.filipinoProfile) ? row.filipinoProfile : "",
      wordRecognitionLevel:
        row?.wordRecognitionLevel && isWrLevel(row.wordRecognitionLevel)
          ? row.wordRecognitionLevel
          : "",
      readingComprehensionLevel:
        row?.readingComprehensionLevel &&
        isRcLevel(row.readingComprehensionLevel)
          ? row.readingComprehensionLevel
          : "",
      notes: row?.notes ?? "",
    };
  }
  return init;
}

function isRowComplete(row: RowState | undefined): boolean {
  return (
    !!row?.englishProfile &&
    !!row?.filipinoProfile &&
    !!row?.wordRecognitionLevel &&
    !!row?.readingComprehensionLevel
  );
}

function hasAnyValue(row: RowState | undefined): boolean {
  return (
    !!row?.englishProfile ||
    !!row?.filipinoProfile ||
    !!row?.wordRecognitionLevel ||
    !!row?.readingComprehensionLevel ||
    !!row?.notes.trim()
  );
}

export const AralReadingLevelGridForm = forwardRef<
  AralReadingLevelGridFormHandle,
  Props
>(function AralReadingLevelGridForm(
  {
    weekStartKey,
    gradeType,
    learners,
    existing,
    showSection,
    readOnly,
    onSavePendingChange,
  },
  ref
) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [rows, setRows] = useState(() => toInitial(learners, existing));
  const profileOptions = toOptions(readingProfileLabelsForGradeType(gradeType));

  useEffect(() => {
    onSavePendingChange?.(pending);
  }, [pending, onSavePendingChange]);

  function patch(learnerId: string, patch: Partial<RowState>) {
    setRows((prev) => ({
      ...prev,
      [learnerId]: { ...prev[learnerId], ...patch },
    }));
  }

  const handleSave = useCallback(() => {
    if (readOnly || pending) return;

    const entries = learners
      .map((l) => {
        const row = rows[l.id];
        if (!isRowComplete(row)) return null;
        return {
          learnerId: l.id,
          englishProfile: row.englishProfile as Profile,
          filipinoProfile: row.filipinoProfile as Profile,
          wordRecognitionLevel: row.wordRecognitionLevel as WrLevel,
          readingComprehensionLevel: row.readingComprehensionLevel as RcLevel,
          notes: row.notes.trim() || undefined,
        };
      })
      .filter((e): e is NonNullable<typeof e> => e !== null);

    if (entries.length === 0) {
      toast.error(
        "Set English, Filipino, Word recognition, and Reading comprehension for at least one learner"
      );
      return;
    }

    const incomplete = learners.filter((l) => {
      const row = rows[l.id];
      return hasAnyValue(row) && !isRowComplete(row);
    });
    if (incomplete.length > 0) {
      toast.error(
        `Complete English, Filipino, Word recognition, and Reading comprehension for: ${incomplete
          .slice(0, 3)
          .map((l) => l.fullName)
          .join(", ")}${incomplete.length > 3 ? "…" : ""}`
      );
      return;
    }

    startTransition(async () => {
      const toastId = toast.loading("Saving reading levels…");
      const res = await bulkRecordWeeklyReadingLevel({
        weekStart: weekStartKey,
        entries,
      });
      if (res.ok) {
        toast.success(
          `Saved reading levels for ${res.data?.upserted ?? entries.length} learner${
            (res.data?.upserted ?? entries.length) === 1 ? "" : "s"
          }`,
          { id: toastId }
        );
        router.refresh();
      } else {
        toast.error(res.error, { id: toastId });
      }
    });
  }, [readOnly, pending, learners, rows, weekStartKey, router]);

  useImperativeHandle(
    ref,
    () => ({
      save: handleSave,
    }),
    [handleSave]
  );

  if (learners.length === 0) {
    return (
      <p className="p-4 text-sm text-muted-foreground">
        No ARAL learners match this filter.
      </p>
    );
  }

  const emptyRow: RowState = {
    englishProfile: "",
    filipinoProfile: "",
    wordRecognitionLevel: "",
    readingComprehensionLevel: "",
    notes: "",
  };

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-[160px]">Learner</TableHead>
            {showSection && <TableHead>Section</TableHead>}
            <TableHead className="min-w-[200px]">English</TableHead>
            <TableHead className="min-w-[200px]">Filipino</TableHead>
            <TableHead className="min-w-[220px]">Word recognition</TableHead>
            <TableHead className="min-w-[220px]">
              Reading comprehension
            </TableHead>
            <TableHead className="min-w-[180px]">Remarks</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {learners.map((l) => {
            const row = rows[l.id] ?? emptyRow;
            return (
              <TableRow key={l.id}>
                <TableCell className="font-medium">{l.fullName}</TableCell>
                {showSection && (
                  <TableCell className="text-sm text-muted-foreground">
                    {l.sectionName ?? "—"}
                  </TableCell>
                )}
                <TableCell>
                  <select
                    className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
                    value={row.englishProfile}
                    disabled={readOnly || pending}
                    onChange={(e) =>
                      patch(l.id, {
                        englishProfile: e.target.value as Profile | "",
                      })
                    }
                    aria-label={`${l.fullName} English profile`}
                  >
                    <option value="">Select…</option>
                    {profileOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </TableCell>
                <TableCell>
                  <select
                    className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
                    value={row.filipinoProfile}
                    disabled={readOnly || pending}
                    onChange={(e) =>
                      patch(l.id, {
                        filipinoProfile: e.target.value as Profile | "",
                      })
                    }
                    aria-label={`${l.fullName} Filipino profile`}
                  >
                    <option value="">Select…</option>
                    {profileOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </TableCell>
                <TableCell>
                  <select
                    className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
                    value={row.wordRecognitionLevel}
                    disabled={readOnly || pending}
                    onChange={(e) =>
                      patch(l.id, {
                        wordRecognitionLevel: e.target.value as WrLevel | "",
                      })
                    }
                    aria-label={`${l.fullName} Word recognition level`}
                  >
                    <option value="">Select…</option>
                    {WR_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </TableCell>
                <TableCell>
                  <select
                    className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
                    value={row.readingComprehensionLevel}
                    disabled={readOnly || pending}
                    onChange={(e) =>
                      patch(l.id, {
                        readingComprehensionLevel: e.target
                          .value as RcLevel | "",
                      })
                    }
                    aria-label={`${l.fullName} Reading comprehension level`}
                  >
                    <option value="">Select…</option>
                    {RC_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </TableCell>
                <TableCell>
                  <Input
                    value={row.notes}
                    disabled={readOnly || pending}
                    onChange={(e) => patch(l.id, { notes: e.target.value })}
                    placeholder="Optional"
                    className="h-8"
                  />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
});
