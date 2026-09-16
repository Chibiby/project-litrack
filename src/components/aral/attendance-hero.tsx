import { CalendarCheck } from "lucide-react";
import { AralPageHero } from "@/components/aral/aral-page-hero";

/**
 * The v2 Weekly Attendance banner. Thin wrapper over the shared `AralPageHero`
 * so every ARAL page renders the same learner banner and text geometry.
 */
export function AttendanceHero({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <AralPageHero
      eyebrow="Weekly Attendance"
      eyebrowIcon={CalendarCheck}
      title={title}
      subtitle={subtitle}
    />
  );
}
