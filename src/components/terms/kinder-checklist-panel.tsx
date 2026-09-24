"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  KINDER_COMPETENCY_CATALOG,
  type KinderCompetencyDomain,
  type KinderCompetencyEntry,
  type KinderCompetencyGroup,
  type KinderCompetencyKey,
  type KinderCompetencyRatingCode,
} from "@/lib/terms/kinder-competencies";
import {
  EMPTY_KINDER_CELL_STATE,
  KinderChecklistCard,
  KinderChecklistRow,
  type KinderChecklistCellState,
  type KinderChecklistRowLock,
  type KinderChecklistTermKey,
} from "@/components/terms/kinder-checklist-row";

/**
 * One line of a flattened domain, in display order — a domain's structure
 * (Domain IV's lettered sections, its sub-headings, item 13's stem) reduced to
 * a flat list so both the desktop table and the phone card list, and
 * `printable-kinder-checklist.tsx`, can render it without re-deriving the
 * grouping themselves.
 */
export type KinderChecklistFlatLine =
  | { kind: "section-header"; key: string; letter: string; title: string }
  | { kind: "sub-heading"; key: string; text: string }
  | { kind: "stem"; key: string; number: number; text: string }
  | { kind: "entry"; key: KinderCompetencyKey; rowLabel: string; entry: KinderCompetencyEntry };

/** Only Domain IV's item-13 sub-entries carry `subLetter`; every other entry's union member omits the field entirely. */
function entryRowLabel(entry: KinderCompetencyEntry): string {
  const subLetter = "subLetter" in entry ? entry.subLetter : undefined;
  return subLetter ? `${entry.number}${subLetter}` : String(entry.number);
}

function flattenGroups(
  groups: readonly KinderCompetencyGroup[],
  out: KinderChecklistFlatLine[]
): void {
  for (const group of groups) {
    if (group.subHeading) {
      out.push({ kind: "sub-heading", key: `sub-${group.subHeading}`, text: group.subHeading });
    }
    for (const line of group.lines) {
      if (line.kind === "entry") {
        out.push({
          kind: "entry",
          key: line.entry.key,
          rowLabel: entryRowLabel(line.entry),
          entry: line.entry,
        });
      } else {
        out.push({ kind: "stem", key: `stem-${line.number}`, number: line.number, text: line.text });
        for (const sub of line.subEntries) {
          out.push({
            kind: "entry",
            key: sub.key,
            rowLabel: entryRowLabel(sub),
            entry: sub,
          });
        }
      }
    }
  }
}

/** `KINDER_COMPETENCY_CATALOG`'s per-domain structure, flattened to a display-order list. */
export function flattenKinderDomain(domain: KinderCompetencyDomain): KinderChecklistFlatLine[] {
  const out: KinderChecklistFlatLine[] = [];
  if (domain.sections.length > 0) {
    for (const section of domain.sections) {
      out.push({
        kind: "section-header",
        key: `section-${section.letter}`,
        letter: section.letter,
        title: section.title,
      });
      flattenGroups(section.groups, out);
    }
  } else {
    flattenGroups(domain.groups, out);
  }
  return out;
}

/** How many rated rows a domain holds — the count shown in its Collapsible trigger. */
export function countKinderDomainEntries(domain: KinderCompetencyDomain): number {
  return flattenKinderDomain(domain).filter((line) => line.kind === "entry").length;
}

function DomainSection({
  domain,
  states,
  locked,
  readOnly,
  onRatingChange,
  onRemarkChange,
}: {
  domain: KinderCompetencyDomain;
  states: ReadonlyMap<KinderCompetencyKey, KinderChecklistCellState>;
  locked: KinderChecklistRowLock;
  readOnly: boolean;
  onRatingChange: (
    key: KinderCompetencyKey,
    term: KinderChecklistTermKey,
    value: KinderCompetencyRatingCode | null
  ) => void;
  onRemarkChange: (key: KinderCompetencyKey, value: string) => void;
}) {
  const [open, setOpen] = React.useState(true);
  const lines = React.useMemo(() => flattenKinderDomain(domain), [domain]);
  const count = React.useMemo(
    () => lines.filter((line) => line.kind === "entry").length,
    [lines]
  );

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="overflow-hidden rounded-2xl border border-border/80 bg-card"
    >
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="h-auto w-full justify-between gap-3 rounded-none px-4 py-3 text-left font-semibold hover:bg-muted/60"
        >
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate">
              {domain.roman}. {domain.title}
            </span>
            <Badge variant="secondary" className="shrink-0 font-normal">
              {count} {count === 1 ? "competency" : "competencies"}
            </Badge>
          </span>
          <ChevronDown
            aria-hidden
            className={cn("size-4 shrink-0 transition-transform", open && "rotate-180")}
          />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="border-t border-border/60">
          {/* xl and up: one table for the domain, to the mockup's # | Competency | T1 | T2 | T3 | Remarks columns. */}
          <div className="hidden overflow-x-auto xl:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">#</TableHead>
                  <TableHead>Competency</TableHead>
                  <TableHead className="w-32">T1</TableHead>
                  <TableHead className="w-32">T2</TableHead>
                  <TableHead className="w-32">T3</TableHead>
                  <TableHead className="min-w-[10rem]">Remarks (Optional)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((line) => {
                  if (line.kind === "section-header") {
                    return (
                      <TableRow key={line.key} className="hover:bg-transparent">
                        <TableCell
                          colSpan={6}
                          className="bg-muted/60 py-2 text-sm font-semibold text-foreground"
                        >
                          {line.letter}. {line.title}
                        </TableCell>
                      </TableRow>
                    );
                  }
                  if (line.kind === "sub-heading") {
                    return (
                      <TableRow key={line.key} className="hover:bg-transparent">
                        <TableCell
                          colSpan={6}
                          className="bg-muted/30 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                        >
                          {line.text}
                        </TableCell>
                      </TableRow>
                    );
                  }
                  if (line.kind === "stem") {
                    return (
                      <TableRow key={line.key} className="hover:bg-transparent">
                        <TableCell className="w-10 tabular-nums text-muted-foreground">
                          {line.number}
                        </TableCell>
                        <TableCell colSpan={5} className="text-sm font-medium text-foreground">
                          {line.text}
                        </TableCell>
                      </TableRow>
                    );
                  }
                  return (
                    <KinderChecklistRow
                      key={line.key}
                      rowNumber={line.rowLabel}
                      competencyKey={line.entry.key}
                      competencyText={line.entry.text}
                      state={states.get(line.entry.key) ?? EMPTY_KINDER_CELL_STATE}
                      locked={locked}
                      readOnly={readOnly}
                      onRatingChange={onRatingChange}
                      onRemarkChange={onRemarkChange}
                    />
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {/* Below xl: the same rows as a stacked card list. */}
          <div className="flex flex-col gap-2 p-3 xl:hidden">
            {lines.map((line) => {
              if (line.kind === "section-header") {
                return (
                  <p key={line.key} className="mt-1 text-sm font-semibold text-foreground first:mt-0">
                    {line.letter}. {line.title}
                  </p>
                );
              }
              if (line.kind === "sub-heading") {
                return (
                  <p
                    key={line.key}
                    className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                  >
                    {line.text}
                  </p>
                );
              }
              if (line.kind === "stem") {
                return (
                  <p key={line.key} className="text-sm font-medium text-foreground">
                    {line.number}. {line.text}
                  </p>
                );
              }
              return (
                <KinderChecklistCard
                  key={line.key}
                  rowNumber={line.rowLabel}
                  competencyKey={line.entry.key}
                  competencyText={line.entry.text}
                  state={states.get(line.entry.key) ?? EMPTY_KINDER_CELL_STATE}
                  locked={locked}
                  readOnly={readOnly}
                  onRatingChange={onRatingChange}
                  onRemarkChange={onRemarkChange}
                />
              );
            })}
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export interface KinderChecklistPanelProps {
  /** Every catalog key present, even one never saved (all-null) — the merged view from `mergeKinderChecklist` (spec section 9). */
  states: ReadonlyMap<KinderCompetencyKey, KinderChecklistCellState>;
  /** Which term columns are write-locked, shared by every row. */
  locked: KinderChecklistRowLock;
  /** The School Head view (spec section 10): every control disabled, no save. */
  readOnly?: boolean;
  onRatingChange?: (
    key: KinderCompetencyKey,
    term: KinderChecklistTermKey,
    value: KinderCompetencyRatingCode | null
  ) => void;
  onRemarkChange?: (key: KinderCompetencyKey, value: string) => void;
}

/** "all", or one domain's roman numeral — the chip row's selection. */
type DomainFilter = "all" | KinderCompetencyDomain["roman"];

/**
 * The mockup's four chips are short; the full DepEd domain titles are not. The
 * chip shows the short form and carries the full title as its tooltip.
 */
const DOMAIN_CHIP_LABELS: Record<KinderCompetencyDomain["roman"], string> = {
  I: "Motor",
  II: "Socio-emotional",
  III: "Cognitive",
  IV: "Language",
};

function DomainChip({
  label,
  title,
  active,
  onSelect,
}: {
  label: string;
  title?: string;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <Button
      type="button"
      role="tab"
      aria-selected={active}
      title={title}
      variant={active ? "default" : "outline"}
      size="sm"
      onClick={onSelect}
      className="h-10 rounded-full px-3 text-xs sm:h-10 sm:px-4 sm:text-sm lg:h-9"
    >
      {label}
    </Button>
  );
}

const NOOP_RATING_CHANGE: NonNullable<KinderChecklistPanelProps["onRatingChange"]> = () => {};
const NOOP_REMARK_CHANGE: NonNullable<KinderChecklistPanelProps["onRemarkChange"]> = () => {};

/**
 * The four collapsible domain sections, composed straight from
 * `KINDER_COMPETENCY_CATALOG` — Domain IV's lettered sub-sections and item
 * 13's stem/sub-items fall out of that shape, so no grouping logic lives here
 * beyond `flattenKinderDomain` above.
 */
export function KinderChecklistPanel({
  states,
  locked,
  readOnly = false,
  onRatingChange = NOOP_RATING_CHANGE,
  onRemarkChange = NOOP_REMARK_CHANGE,
}: KinderChecklistPanelProps) {
  const [activeDomain, setActiveDomain] = React.useState<DomainFilter>("all");
  const shown = React.useMemo(
    () =>
      activeDomain === "all"
        ? KINDER_COMPETENCY_CATALOG
        : KINDER_COMPETENCY_CATALOG.filter((domain) => domain.roman === activeDomain),
    [activeDomain]
  );

  return (
    <div className="flex flex-col gap-3">
      <div
        className="flex flex-wrap gap-2 print:hidden"
        role="tablist"
        aria-label="Competency domains"
      >
        <DomainChip
          label="All domains"
          active={activeDomain === "all"}
          onSelect={() => setActiveDomain("all")}
        />
        {KINDER_COMPETENCY_CATALOG.map((domain) => (
          <DomainChip
            key={domain.roman}
            label={`${domain.roman}. ${DOMAIN_CHIP_LABELS[domain.roman]}`}
            title={domain.title}
            active={activeDomain === domain.roman}
            onSelect={() => setActiveDomain(domain.roman)}
          />
        ))}
      </div>

      {shown.map((domain) => (
        <DomainSection
          key={domain.roman}
          domain={domain}
          states={states}
          locked={locked}
          readOnly={readOnly}
          onRatingChange={onRatingChange}
          onRemarkChange={onRemarkChange}
        />
      ))}
    </div>
  );
}
