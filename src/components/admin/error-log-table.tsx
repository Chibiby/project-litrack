import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
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

function when(event: ErrorLogRow): string {
  return event.createdAt.toISOString().replace("T", " ").slice(0, 19);
}

function schoolLabel(event: ErrorLogRow): string {
  return event.schoolId ? (event.schoolName ?? event.schoolId.slice(0, 8)) : "—";
}

/*
 * The detail lives inline rather than behind a dialog: an admin reading this
 * page is already trying to answer one question, and a stack is the answer.
 */
function EventDetails({ event }: { event: ErrorLogRow }) {
  return (
    <details className="mt-2">
      <summary className="flex min-h-10 cursor-pointer items-center text-xs font-normal text-muted-foreground lg:min-h-0">
        Details
      </summary>
      <div className="mt-2 min-w-0 space-y-2 text-xs font-normal">
        <p className="whitespace-pre-wrap break-words text-muted-foreground">{event.message}</p>
        {event.context ? (
          <pre className="max-w-full overflow-x-auto rounded-md bg-muted p-2 text-muted-foreground">
            {JSON.stringify(event.context, null, 2)}
          </pre>
        ) : null}
        {event.stack ? (
          <pre className="max-h-64 max-w-full overflow-auto rounded-md bg-muted p-2 text-muted-foreground">
            {event.stack}
          </pre>
        ) : null}
        {event.userId ? (
          <p className="break-all font-mono text-muted-foreground">user {event.userId}</p>
        ) : null}
      </div>
    </details>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  return (
    <Badge variant={severity === "system" ? "destructive" : "secondary"}>{severity}</Badge>
  );
}

export function ErrorLogTable({
  events,
  hasRefFilter,
}: {
  events: ErrorLogRow[];
  hasRefFilter: boolean;
}) {
  if (events.length === 0) {
    return (
      <div className="p-4 sm:p-5 lg:p-3">
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
      </div>
    );
  }

  return (
    <>
      <div className="hidden overflow-x-auto lg:block">
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
                  {when(event)}
                </TableCell>
                <TableCell className="max-w-[28rem] align-top font-medium">
                  {event.code}
                  <EventDetails event={event} />
                </TableCell>
                <TableCell className="align-top">
                  <SeverityBadge severity={event.severity} />
                </TableCell>
                <TableCell className="align-top text-xs text-muted-foreground">
                  {event.route ?? "—"}
                  {event.routeType ? (
                    <span className="block text-xs opacity-70">{event.routeType}</span>
                  ) : null}
                </TableCell>
                <TableCell className="align-top text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <span>{schoolLabel(event)}</span>
                    {event.isDemoSchool ? <DemoBadge /> : null}
                  </span>
                </TableCell>
                <TableCell className="align-top font-mono text-xs">{event.ref}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Below lg: one stacked row per event, the house phone/tablet list. */}
      <ul className="divide-y divide-border/60 lg:hidden" aria-label="Error events">
        {events.map((event) => (
          <li key={event.id} className="min-w-0 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-foreground">{event.code}</span>
              <SeverityBadge severity={event.severity} />
              <span className="ml-auto font-mono text-xs text-muted-foreground">{event.ref}</span>
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-muted-foreground">
              <span>{schoolLabel(event)}</span>
              {event.isDemoSchool ? <DemoBadge /> : null}
            </p>
            <p className="mt-0.5 break-all text-xs text-muted-foreground">
              {when(event)} · {event.route ?? "—"}
              {event.routeType ? ` (${event.routeType})` : ""}
            </p>
            <EventDetails event={event} />
          </li>
        ))}
      </ul>
    </>
  );
}
