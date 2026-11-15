import "server-only";
import { getDiscrepancySummary } from "@/lib/monitoring/discrepancies";
import { buildMonitoringCounts, type MonitoringCounts } from "@/lib/monitoring/counts";
import { getTeacherTaskSummary } from "@/lib/teacher-tasks/queries";

/**
 * The Monitoring counts for one school: both summaries come from the Data Cache
 * (60 seconds), so the dashboard and the pop-up cost no extra queries when the
 * head opens a Monitoring page next.
 *
 * `todayKey` must be `formatLocalDateKey(schoolToday())`.
 */
export async function getMonitoringCounts(schoolId: string, todayKey: string): Promise<MonitoringCounts> {
  const [tasks, discrepancies] = await Promise.all([
    getTeacherTaskSummary(schoolId, todayKey),
    getDiscrepancySummary(schoolId),
  ]);
  return buildMonitoringCounts(tasks, discrepancies);
}
