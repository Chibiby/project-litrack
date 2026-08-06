import {
  GRADE_LEVEL_LABELS,
  READING_PROFILE_LABELS,
  GENDER_LABELS,
} from "@/lib/constants/enum-labels";

type LearnerRow = {
  id: string;
  fullName: string;
  age: number;
  gender: string;
  englishReadingProfile: string;
  filipinoReadingProfile: string;
  isAralLearner: boolean;
  gradeLevel: { type: string };
  section: { name: string } | null;
};

type Props = {
  schoolName: string;
  generatedAt: Date;
  learners: LearnerRow[];
  aralCount: number;
  byGrade: Map<string, LearnerRow[]>;
  subtitle?: string;
};

function labelProfile(key: string): string {
  return READING_PROFILE_LABELS[key as keyof typeof READING_PROFILE_LABELS] ?? key;
}

export function PrintableLearnersReport({
  schoolName,
  generatedAt,
  learners,
  aralCount,
  byGrade,
  subtitle,
}: Props) {
  return (
    <div className="printable-report space-y-6 text-foreground">
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
          Generated {generatedAt.toLocaleString()} · {learners.length} learner
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
            {[...byGrade.entries()].map(([type, list]) => (
              <tr key={type} className="border-b border-border/60">
                <td className="py-1.5 pr-2">{GRADE_LEVEL_LABELS[type] ?? type}</td>
                <td className="py-1.5 pr-2">{list.length}</td>
                <td className="py-1.5">{list.filter((l) => l.isAralLearner).length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

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
                <td className="py-1.5 pr-2">{labelProfile(l.englishReadingProfile)}</td>
                <td className="py-1.5 pr-2">{labelProfile(l.filipinoReadingProfile)}</td>
                <td className="py-1.5">{l.isAralLearner ? "Yes" : "No"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {learners.length === 0 && (
          <p className="text-sm text-muted-foreground">No learners to report.</p>
        )}
      </section>
    </div>
  );
}
