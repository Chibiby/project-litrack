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
  REPORT_FOOTER_LOGO_SOURCES,
  SYSTEM_GENERATED_NOTE,
  type ReportFooter,
  type ReportHeaderField,
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

  return (
    <div className="printable-report space-y-6 text-foreground">
      {header && header.length > 0 && (
        <dl className="space-y-0.5 border-b border-border pb-3 text-xs">
          {header.map((field) => (
            <div key={field.label} className="flex gap-1">
              <dt className="font-bold">{field.label}:</dt>
              <dd>{field.value}</dd>
            </div>
          ))}
        </dl>
      )}

      <header className="border-b border-border pb-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          PROJECT LITRACK
        </p>
        <h1 className="text-2xl font-bold tracking-tight">{schoolName}</h1>
        <p className="text-sm text-muted-foreground">
          Learner & ARAL summary report
          {subtitle ? ` · ${subtitle}` : ""}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Generated {generated.toLocaleString()} · {learners.length} learner
          {learners.length === 1 ? "" : "s"} · {aralCount} ARAL
        </p>
      </header>

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
        <footer className="space-y-1 border-t border-border pt-3 text-xs">
          <p className="font-bold">Prepared by: {footer.preparedBy}</p>
          <p className="font-bold">Noted by: {footer.notedBy}</p>
          <p className="italic text-muted-foreground">{SYSTEM_GENERATED_NOTE}</p>
          <div className="mt-1 flex items-center gap-1.5">
            {REPORT_FOOTER_LOGO_SOURCES.map((logo) => (
              // eslint-disable-next-line @next/next/no-img-element -- small static print logos, next/image's overhead buys nothing here
              <img key={logo.src} src={logo.src} alt={logo.alt} className="h-8 w-auto" />
            ))}
          </div>
        </footer>
      )}
    </div>
  );
}
