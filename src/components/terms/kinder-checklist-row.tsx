"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { TableCell, TableRow } from "@/components/ui/table";
import { Surface } from "@/components/ui/surface";
import {
  KINDER_COMPETENCY_RATING_LABELS,
  KINDER_COMPETENCY_RATING_SHORT_LABELS,
  type KinderCompetencyKey,
  type KinderCompetencyRatingCode,
} from "@/lib/terms/kinder-competencies";

/**
 * One competency's saved (or unsaved) state. Mirrors `KinderChecklistCellState`
 * from `src/lib/terms/kinder-checklist-view.ts` (spec section 9) — that module
 * had not landed when this file was written, so the shape is declared locally.
 * Keep the two in sync; import the real type once it ships instead of this one.
 */
export type KinderChecklistCellState = {
  t1Rating: KinderCompetencyRatingCode | null;
  t2Rating: KinderCompetencyRatingCode | null;
  t3Rating: KinderCompetencyRatingCode | null;
  remark: string | null;
};

/** A row with every field unset — the fallback for a competency never saved. */
export const EMPTY_KINDER_CELL_STATE: KinderChecklistCellState = {
  t1Rating: null,
  t2Rating: null,
  t3Rating: null,
  remark: null,
};

export type KinderChecklistTermKey = "t1" | "t2" | "t3";

/**
 * Which term columns are currently write-locked. One value shared by every
 * row on the page — a term's window is locked for the whole sheet, not per
 * competency — computed once by the page from the same window resolution
 * that gates the save action (spec section 6/12), so render and save agree.
 */
export type KinderChecklistRowLock = { t1: boolean; t2: boolean; t3: boolean };

const RATING_NONE = "none" as const;

const TERM_LABELS: Record<KinderChecklistTermKey, string> = {
  t1: "T1",
  t2: "T2",
  t3: "T3",
};

const RATING_CODES = Object.keys(
  KINDER_COMPETENCY_RATING_LABELS
) as KinderCompetencyRatingCode[];

function ratingSelectValue(rating: KinderCompetencyRatingCode | null): string {
  return rating ?? RATING_NONE;
}

function parseRatingSelectValue(value: string): KinderCompetencyRatingCode | null {
  return value === RATING_NONE ? null : (value as KinderCompetencyRatingCode);
}

function pickRating(
  state: KinderChecklistCellState,
  term: KinderChecklistTermKey
): KinderCompetencyRatingCode | null {
  if (term === "t1") return state.t1Rating;
  if (term === "t2") return state.t2Rating;
  return state.t3Rating;
}

function TermRatingSelect({
  value,
  disabled,
  onChange,
  ariaLabel,
}: {
  value: KinderCompetencyRatingCode | null;
  disabled: boolean;
  onChange: (value: KinderCompetencyRatingCode | null) => void;
  ariaLabel: string;
}) {
  return (
    <Select
      value={ratingSelectValue(value)}
      onValueChange={(v) => onChange(parseRatingSelectValue(v))}
      disabled={disabled}
    >
      <SelectTrigger aria-label={ariaLabel} className="h-9 w-full min-w-[4.5rem] text-sm">
        <SelectValue>
          {value ? KINDER_COMPETENCY_RATING_SHORT_LABELS[value] : "Not specified"}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={RATING_NONE}>Not specified</SelectItem>
        {RATING_CODES.map((code) => (
          <SelectItem key={code} value={code}>
            {KINDER_COMPETENCY_RATING_LABELS[code]} ({KINDER_COMPETENCY_RATING_SHORT_LABELS[code]})
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export interface KinderChecklistRowProps {
  /** Display number in the `#` column — e.g. `13` for the item-13 stem's sub-items, shown as `13a`/`13b`/`13c`. */
  rowNumber: number | string;
  /** The catalog entry's stable key, so a shared `onChange` handler knows which row changed. */
  competencyKey: KinderCompetencyKey;
  competencyText: string;
  state: KinderChecklistCellState;
  locked: KinderChecklistRowLock;
  readOnly?: boolean;
  onRatingChange: (
    key: KinderCompetencyKey,
    term: KinderChecklistTermKey,
    value: KinderCompetencyRatingCode | null
  ) => void;
  onRemarkChange: (key: KinderCompetencyKey, value: string) => void;
}

const TERM_ORDER: readonly KinderChecklistTermKey[] = ["t1", "t2", "t3"];

/** Desktop: one `<TableRow>` inside the domain's `<Table>`. */
export function KinderChecklistRow({
  rowNumber,
  competencyKey,
  competencyText,
  state,
  locked,
  readOnly = false,
  onRatingChange,
  onRemarkChange,
}: KinderChecklistRowProps) {
  return (
    <TableRow>
      <TableCell className="w-10 tabular-nums text-muted-foreground">{rowNumber}</TableCell>
      <TableCell className="min-w-[16rem] text-sm">{competencyText}</TableCell>
      {TERM_ORDER.map((term) => (
        <TableCell key={term} className="w-32">
          <TermRatingSelect
            value={pickRating(state, term)}
            disabled={readOnly || locked[term]}
            onChange={(value) => onRatingChange(competencyKey, term, value)}
            ariaLabel={`${TERM_LABELS[term]} rating for ${competencyText}`}
          />
        </TableCell>
      ))}
      <TableCell className="min-w-[10rem]">
        <Input
          value={state.remark ?? ""}
          onChange={(e) => onRemarkChange(competencyKey, e.target.value)}
          disabled={readOnly}
          placeholder="Remarks (optional)"
          aria-label={`Remarks for ${competencyText}`}
          maxLength={500}
          className="h-9 text-sm"
        />
      </TableCell>
    </TableRow>
  );
}

/** Phone/tablet: one card, the same fields stacked instead of columned. */
export function KinderChecklistCard({
  rowNumber,
  competencyKey,
  competencyText,
  state,
  locked,
  readOnly = false,
  onRatingChange,
  onRemarkChange,
}: KinderChecklistRowProps) {
  return (
    <Surface className="flex flex-col gap-3 rounded-xl p-3">
      <p className="text-sm font-medium text-foreground">
        <span className="mr-1.5 text-muted-foreground">{rowNumber}.</span>
        {competencyText}
      </p>
      <div className="grid grid-cols-3 gap-2">
        {TERM_ORDER.map((term) => (
          <div key={term} className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">{TERM_LABELS[term]}</span>
            <TermRatingSelect
              value={pickRating(state, term)}
              disabled={readOnly || locked[term]}
              onChange={(value) => onRatingChange(competencyKey, term, value)}
              ariaLabel={`${TERM_LABELS[term]} rating for ${competencyText}`}
            />
          </div>
        ))}
      </div>
      <Input
        value={state.remark ?? ""}
        onChange={(e) => onRemarkChange(competencyKey, e.target.value)}
        disabled={readOnly}
        placeholder="Remarks (optional)"
        aria-label={`Remarks for ${competencyText}`}
        maxLength={500}
        className="h-9 text-sm"
      />
    </Surface>
  );
}
