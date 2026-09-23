import {
  GRADE_LEVEL_LABELS,
  GENDER_LABELS,
  labelReadingProfile,
} from "@/lib/constants/enum-labels";
import type {
  PrintableReportData,
  PrintableReportLearner,
  PrintableReportSectionRow,
} from "@/lib/actions/export-learners";
import {
  EMPTY_REPORT_FRAME,
  formatReportDate,
  REPORT_BOTTOM_LOGO_SOURCES,
  REPORT_TOP_LOGO_SOURCE,
  SIGNATURE_CAPTION,
  templateHeaderLines,
  type ReportFooter,
  type ReportHeaderField,
  type TemplateHeaderLine,
} from "@/lib/reports/report-frame";

type LearnerRow = PrintableReportLearner;
type SectionSummaryRow = PrintableReportSectionRow;

type Props = {
  schoolName: string;
  generatedAt: Date | string;
  learners: LearnerRow[];
  aralCount: number;
  /** Prefer serializable `{ type, learners }[]`; Map still accepted for legacy callers. */
  byGrade:
    | Map<string, LearnerRow[]>
    | PrintableReportData["byGrade"];
  byGradeSection?:
    | Map<string, SectionSummaryRow[]>
    | PrintableReportData["byGradeSection"];
  subtitle?: string;
  /** The shared DepEd-style header/footer block. Absent for older callers — the report still renders without it. */
  header?: ReportHeaderField[];
  footer?: ReportFooter;
};

function gradeEntries(
  byGrade: Props["byGrade"]
): { type: string; learners: LearnerRow[] }[] {
  if (byGrade instanceof Map) {
    return [...byGrade.entries()].map(([type, learners]) => ({ type, learners }));
  }
  return byGrade;
}

function sectionEntries(
  byGradeSection: NonNullable<Props["byGradeSection"]>
): { gradeType: string; section: string; count: number; aral: number }[] {
  if (byGradeSection instanceof Map) {
    return [...byGradeSection.entries()].flatMap(([type, rows]) =>
      rows.map((r) => ({ gradeType: type, ...r }))
    );
  }
  return byGradeSection.flatMap((g) =>
    g.rows.map((r) => ({ gradeType: g.type, ...r }))
  );
}

function fieldValue(header: ReportHeaderField[] | undefined, label: string): string {
  return header?.find((f) => f.label === label)?.value ?? "";
}

/**
 * Tailwind classes for one centred header line, derived from the same
 * bold/size signal `templateHeaderLines` gives the Excel/PDF renderers —
 * never its ARGB `color` (that's for spreadsheet cells; this view sticks to
 * design tokens, per house rule). Only "DEPARTMENT OF EDUCATION" is both
 * bold and size 16+; the school name is bold at a smaller size; everything
 * else (Republic of the Philippines, Region, Division, District, Address)
 * prints plain.
 */
function headerLineClassName(line: TemplateHeaderLine): string {
  if (line.bold && line.size >= 16) {
    return "text-lg font-bold uppercase tracking-wide";
  }
  if (line.bold) {
    return "text-sm font-bold";
  }
  return "text-sm";
}

function SignatureColumn({ label, name }: { label: string; name: string }) {
  return (
    <div className="flex flex-col items-center gap-10 text-center">
      <p className="self-start text-xs font-bold">{label}</p>
      <div className="w-full">
        <p className="min-h-[1.25rem] text-sm font-medium">{name || " "}</p>
        <div className="mt-1 border-t border-foreground" />
        <p className="mt-1 text-[10px] text-muted-foreground">{SIGNATURE_CAPTION}</p>
      </div>
    </div>
  );
}

export function PrintableLearnersReport({
  schoolName,
  generatedAt,
  learners,
  aralCount,
  byGrade,
  byGradeSection,
  subtitle,
  header,
  footer,
}: Props) {
  const grades = gradeEntries(byGrade);
  const sectionRows =
    byGradeSection && (byGradeSection instanceof Map ? byGradeSection.size > 0 : byGradeSection.length > 0)
      ? sectionEntries(byGradeSection)
      : [];
  const generated =
    generatedAt instanceof Date ? generatedAt : new Date(generatedAt);

  const headerLines = templateHeaderLines({
    ...EMPTY_REPORT_FRAME,
    schoolName,
    region: fieldValue(header, "Region"),
    division: fieldValue(header, "Division"),
    district: fieldValue(header, "District"),
    // No "School Address" field is resolved anywhere yet — omitted rather
    // than a placeholder, same rule `templateHeaderLines` already follows
    // for every other blank field.
    address: fieldValue(header, "School Address") || fieldValue(header, "Address"),
  });

  const reportTitle = subtitle
    ? `Learner & ARAL Summary Report — ${subtitle}`
    : "Learner & ARAL Summary Report";

  return (
    <div className="printable-report mx-auto max-w-3xl space-y-6 text-foreground">
      {/*
        A4 page size and keeping the signature block off a page break are
        specific to this print template, so they live here rather than in
        `globals.css`'s shared `@media print` block (that block covers every
        printable view, not just this one's page geometry).
      */}
      <style>{`
        @media print {
          @page {
            size: A4;
            margin: 16mm;
          }
          .printable-report footer {
            page-break-inside: avoid;
          }
        }
      `}</style>

      <header className="flex flex-col items-center gap-1 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element -- small static print seal, next/image's overhead buys nothing in a print-only view */}
        <img
          src={REPORT_TOP_LOGO_SOURCE.src}
          alt={REPORT_TOP_LOGO_SOURCE.alt}
          className="mb-1 h-20 w-20 object-contain"
        />
        {headerLines.map((line) => (
          <p key={line.text} className={headerLineClassName(line)}>
            {line.text}
          </p>
        ))}
      </header>

      <hr className="border-border" />

      <div className="space-y-1 text-center">
        <h1 className="text-base font-bold uppercase tracking-wide">{reportTitle}</h1>
        <p className="text-xs text-muted-foreground">
          {learners.length} learner{learners.length === 1 ? "" : "s"} · {aralCount} ARAL
        </p>
      </div>

      <section>
        <h2 className="mb-2 text-lg font-semibold">Summary by grade</h2>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="py-1.5 pr-2 font-medium">Grade</th>
              <th className="py-1.5 pr-2 font-medium">Learners</th>
              <th className="py-1.5 font-medium">ARAL</th>
            </tr>
          </thead>
          <tbody>
            {grades.map(({ type, learners: list }) => (
              <tr key={type} className="border-b border-border/60">
                <td className="py-1.5 pr-2">{GRADE_LEVEL_LABELS[type] ?? type}</td>
                <td className="py-1.5 pr-2">{list.length}</td>
                <td className="py-1.5">{list.filter((l) => l.isAralLearner).length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {sectionRows.length > 0 && (
        <section>
          <h2 className="mb-2 text-lg font-semibold">Summary by section</h2>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="py-1.5 pr-2 font-medium">Grade</th>
                <th className="py-1.5 pr-2 font-medium">Section</th>
                <th className="py-1.5 pr-2 font-medium">Learners</th>
                <th className="py-1.5 font-medium">ARAL</th>
              </tr>
            </thead>
            <tbody>
              {sectionRows.map((r) => (
                <tr
                  key={`${r.gradeType}-${r.section}`}
                  className="border-b border-border/60"
                >
                  <td className="py-1.5 pr-2">
                    {GRADE_LEVEL_LABELS[r.gradeType] ?? r.gradeType}
                  </td>
                  <td className="py-1.5 pr-2">{r.section}</td>
                  <td className="py-1.5 pr-2">{r.count}</td>
                  <td className="py-1.5">{r.aral}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-lg font-semibold">Learners</h2>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="py-1.5 pr-2 font-medium">Name</th>
              <th className="py-1.5 pr-2 font-medium">Age</th>
              <th className="py-1.5 pr-2 font-medium">Gender</th>
              <th className="py-1.5 pr-2 font-medium">Grade</th>
              <th className="py-1.5 pr-2 font-medium">English</th>
              <th className="py-1.5 pr-2 font-medium">Filipino</th>
              <th className="py-1.5 font-medium">ARAL</th>
            </tr>
          </thead>
          <tbody>
            {learners.map((l) => (
              <tr key={l.id} className="border-b border-border/60">
                <td className="py-1.5 pr-2">{l.fullName}</td>
                <td className="py-1.5 pr-2">{l.age}</td>
                <td className="py-1.5 pr-2">
                  {GENDER_LABELS[l.gender as keyof typeof GENDER_LABELS] ?? l.gender}
                </td>
                <td className="py-1.5 pr-2">
                  {GRADE_LEVEL_LABELS[l.gradeLevel.type] ?? l.gradeLevel.type}
                  {l.section ? ` · ${l.section.name}` : ""}
                </td>
                <td className="py-1.5 pr-2">
                  {l.englishReadingProfile
                    ? labelReadingProfile(l.englishReadingProfile, l.gradeLevel.type)
                    : "—"}
                </td>
                <td className="py-1.5 pr-2">
                  {labelReadingProfile(
                    l.filipinoReadingProfile,
                    l.gradeLevel.type
                  )}
                </td>
                <td className="py-1.5">{l.isAralLearner ? "Yes" : "No"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {learners.length === 0 && (
          <p className="text-sm text-muted-foreground">No learners to report.</p>
        )}
      </section>

      {footer && (
        <footer className="space-y-8 pt-6">
          <div className="grid grid-cols-3 gap-6">
            <SignatureColumn label="Prepared by:" name={footer.preparedBy} />
            <SignatureColumn label="Checked by:" name="" />
            <SignatureColumn label="Noted by:" name={footer.notedBy} />
          </div>

          <div className="flex flex-wrap items-end justify-between gap-3 border-t border-border pt-3">
            <div className="flex items-center gap-2">
              {REPORT_BOTTOM_LOGO_SOURCES.map((logo) => (
                // eslint-disable-next-line @next/next/no-img-element -- small static print logos, next/image's overhead buys nothing here
                <img key={logo.src} src={logo.src} alt={logo.alt} className="h-12 w-auto" />
              ))}
            </div>
            <div className="text-right text-[11px] text-muted-foreground">
              <p>LITRACK | {reportTitle}</p>
              <p>
                Generated by {footer.preparedBy || "—"} on {formatReportDate(generated)}
              </p>
            </div>
          </div>
        </footer>
      )}
    </div>
  );
}
