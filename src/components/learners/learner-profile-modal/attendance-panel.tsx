import { CalendarCheck } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/dashboard";
import { ATTENDANCE_STATUS_LABELS } from "@/lib/constants/enum-labels";
import {
  PROFILE_ATTENDANCE_TAKE,
  type LearnerProfileData,
} from "@/lib/learners/profile";
import { formatDateKey, labelOf } from "./parts";

/**
 * Attendance tab — the learner detail page's attendance history, grouped by
 * week. Same columns, same copy, same caps, so the two surfaces never disagree.
 */
export function AttendancePanel({ learner }: { learner: LearnerProfileData }) {
  const byWeek = new Map<string, LearnerProfileData["attendances"]>();
  for (const a of learner.attendances) {
    const rows = byWeek.get(a.weekStart) ?? [];
    rows.push(a);
    byWeek.set(a.weekStart, rows);
  }

  if (byWeek.size === 0) {
    return (
      <EmptyState
        icon={CalendarCheck}
        title="No attendance records yet"
        description={
          learner.isAralLearner
            ? "Mark attendance from the ARAL attendance page for this learner."
            : "Attendance history appears after ARAL attendance is recorded."
        }
      />
    );
  }

  return (
    <div className="space-y-5">
      {Array.from(byWeek.entries()).map(([week, rows]) => (
        <div key={week}>
          <p className="mb-2 text-sm font-medium text-muted-foreground">
            Week of {formatDateKey(week)}
          </p>
          <div className="overflow-hidden rounded-xl border border-border/80">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>{formatDateKey(a.date)}</TableCell>
                    <TableCell>
                      {labelOf(ATTENDANCE_STATUS_LABELS, a.status)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {a.notes ?? ""}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      ))}
      {learner.attendances.length >= PROFILE_ATTENDANCE_TAKE ? (
        <p className="text-xs text-muted-foreground">
          Showing the {PROFILE_ATTENDANCE_TAKE} most recent records. Open the
          full profile for the complete history.
        </p>
      ) : null}
    </div>
  );
}
