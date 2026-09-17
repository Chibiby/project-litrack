import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Surface } from "@/components/ui/surface";
import { EmptyState } from "@/components/dashboard/empty-state";
import { DemoBadge } from "@/components/demo-badge";
import { TriangleAlert } from "lucide-react";
import { errorRetentionDays } from "@/lib/errors/retention";

export type ErrorLogRow = {
  id: string;
  createdAt: Date;
  code: string;
  severity: string;
  message: string;
  context: unknown;
  stack: string | null;
  route: string | null;
  routeType: string | null;
  schoolId: string | null;
  schoolName: string | null;
  /** Whether the event's school is the Test Lab demo tenant. False when no school is linked. */
  isDemoSchool: boolean;
  userId: string | null;
  ref: string;
};

export function ErrorLogTable({
  events,
  hasRefFilter,
}: {
  events: ErrorLogRow[];
  hasRefFilter: boolean;
}) {
  if (events.length === 0) {
    return (
      <EmptyState
        title={hasRefFilter ? "No event with that reference" : "No errors recorded"}
        description={
          hasRefFilter
            ? "Nothing matches that reference. Check it, or widen the period — records are kept for " +
              `${errorRetentionDays()} days.`
            : "Server-side failures and refused requests will appear here."
        }
        icon={TriangleAlert}
      />
    );
  }

  return (
    <Surface className="overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>When</TableHead>
            <TableHead>Code</TableHead>
            <TableHead>Severity</TableHead>
            <TableHead>Where</TableHead>
            <TableHead>School</TableHead>
            <TableHead>Reference</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {events.map((event) => (
            <TableRow key={event.id}>
              <TableCell className="whitespace-nowrap align-top text-xs text-muted-foreground">
                {event.createdAt.toISOString().replace("T", " ").slice(0, 19)}
              </TableCell>
              <TableCell className="align-top font-medium">
                {event.code}
                {/* The detail lives inline rather than behind a dialog: an admin
                    reading this page is already trying to answer one question,
                    and a stack is the answer. */}
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs font-normal text-muted-foreground">
                    Details
                  </summary>
                  <div className="mt-2 space-y-2 text-xs font-normal">
                    <p className="whitespace-pre-wrap text-muted-foreground">{event.message}</p>
                    {event.context ? (
                      <pre className="overflow-x-auto rounded-md bg-muted p-2 text-muted-foreground">
                        {JSON.stringify(event.context, null, 2)}
                      </pre>
                    ) : null}
                    {event.stack ? (
                      <pre className="max-h-64 overflow-auto rounded-md bg-muted p-2 text-muted-foreground">
                        {event.stack}
                      </pre>
                    ) : null}
                    {event.userId ? (
                      <p className="font-mono text-muted-foreground">user {event.userId}</p>
                    ) : null}
                  </div>
                </details>
              </TableCell>
              <TableCell className="align-top">
                <Badge variant={event.severity === "system" ? "destructive" : "secondary"}>
                  {event.severity}
                </Badge>
              </TableCell>
              <TableCell className="align-top text-xs text-muted-foreground">
                {event.route ?? "—"}
                {event.routeType ? (
                  <span className="block text-[11px] opacity-70">{event.routeType}</span>
                ) : null}
              </TableCell>
              <TableCell className="align-top text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span>{event.schoolId ? (event.schoolName ?? event.schoolId.slice(0, 8)) : "—"}</span>
                  {event.isDemoSchool ? <DemoBadge /> : null}
                </span>
              </TableCell>
              <TableCell className="align-top font-mono text-xs">{event.ref}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Surface>
  );
}
