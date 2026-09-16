import { ClipboardList } from "lucide-react";
import { AralPageHero } from "@/components/aral/aral-page-hero";

/**
 * The v2 ARAL Profiling banner. Thin wrapper over the shared `AralPageHero`,
 * same shape as `AttendanceHero`, so every ARAL page renders the same
 * learner banner and text geometry.
 */
export function ProfilingHero({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <AralPageHero
      eyebrow="ARAL Profiling"
      eyebrowIcon={ClipboardList}
      title={title}
      subtitle={subtitle}
      description="Sections C to E cover reading behavior, outside factors and suggested interventions. Absences are not asked here, because Weekly Attendance already records them."
    />
  );
}
