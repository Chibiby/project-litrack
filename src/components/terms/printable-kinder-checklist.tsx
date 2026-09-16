import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  KINDER_COMPETENCY_CATALOG,
  KINDER_COMPETENCY_RATING_LABELS,
  type KinderCompetencyKey,
  type KinderCompetencyRatingCode,
} from "@/lib/terms/kinder-competencies";
import { flattenKinderDomain } from "@/components/terms/kinder-checklist-panel";
import type { KinderChecklistCellState } from "@/components/terms/kinder-checklist-row";

function ratingLabel(rating: KinderCompetencyRatingCode | null): string {
  return rating ? `${KINDER_COMPETENCY_RATING_LABELS[rating]} (${rating})` : "—";
}

export interface PrintableKinderChecklistProps {
  schoolName: string;
  learnerName: string;
  advisoryLabel: string;
  schoolYearLabel: string;
  generatedAt: Date | string;
  /** Every catalog key present, from `mergeKinderChecklist` (spec section 9) — same map the on-screen panel reads. */
  states: ReadonlyMap<KinderCompetencyKey, KinderChecklistCellState>;
}

/**
 * The `.printable-report` view for one learner's checklist, following
 * `src/components/reports/printable-learners-report.tsx`'s shape (header block,
 * one section per group, `window.print()` over `@media print` in globals.css).
 *
 * Unlike that file, this one is not exempt from `tests/unit/shadcn-coverage.test.ts`
 * (only `printable-learners-report.tsx` is), so it uses the shadcn `Table`
 * primitives rather than a raw table element.
 */
export function PrintableKinderChecklist({
  schoolName,
  learnerName,
  advisoryLabel,
  schoolYearLabel,
  generatedAt,
  states,
}: PrintableKinderChecklistProps) {
  const generated = generatedAt instanceof Date ? generatedAt : new Date(generatedAt);

  return (
    <div className="printable-report space-y-6 text-foreground">
      <header className="border-b border-border pb-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          PROJECT LITRACK
        </p>
        <h1 className="text-2xl font-bold tracking-tight">{schoolName}</h1>
        <p className="text-sm text-muted-foreground">
          Kindergarten End-of-Term Competency Checklist
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {learnerName} · {advisoryLabel} · {schoolYearLabel}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Generated {generated.toLocaleString()}
        </p>
        <p className="mt-1 text-xs italic text-muted-foreground">
          Terms 1 and 2 are evaluated in Filipino; Term 3 is evaluated in English.
        </p>
      </header>

      {KINDER_COMPETENCY_CATALOG.map((domain) => (
        <section key={domain.roman}>
          <h2 className="mb-2 text-lg font-semibold">
            {domain.roman}. {domain.title}
          </h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">#</TableHead>
                <TableHead>Competency</TableHead>
                <TableHead className="w-16">T1</TableHead>
                <TableHead className="w-16">T2</TableHead>
                <TableHead className="w-16">T3</TableHead>
                <TableHead>Remarks</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {flattenKinderDomain(domain).map((line) => {
                if (line.kind === "section-header") {
                  return (
                    <TableRow key={line.key}>
                      <TableCell colSpan={6} className="font-semibold">
                        {line.letter}. {line.title}
                      </TableCell>
                    </TableRow>
                  );
                }
                if (line.kind === "sub-heading") {
                  return (
                    <TableRow key={line.key}>
                      <TableCell colSpan={6} className="text-xs font-semibold uppercase tracking-wide">
                        {line.text}
                      </TableCell>
                    </TableRow>
                  );
                }
                if (line.kind === "stem") {
                  return (
                    <TableRow key={line.key}>
                      <TableCell>{line.number}</TableCell>
                      <TableCell colSpan={5} className="font-medium">
                        {line.text}
                      </TableCell>
                    </TableRow>
                  );
                }
                const state = states.get(line.entry.key);
                return (
                  <TableRow key={line.key}>
                    <TableCell>{line.rowLabel}</TableCell>
                    <TableCell>{line.entry.text}</TableCell>
                    <TableCell>{ratingLabel(state?.t1Rating ?? null)}</TableCell>
                    <TableCell>{ratingLabel(state?.t2Rating ?? null)}</TableCell>
                    <TableCell>{ratingLabel(state?.t3Rating ?? null)}</TableCell>
                    <TableCell>{state?.remark || "—"}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </section>
      ))}
    </div>
  );
}
