"use client";

import { useId, useMemo, useRef, useState } from "react";
import { CheckCheck, Download, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FacetSelect } from "@/components/ui/facet-select";
import { SearchInput } from "@/components/ui/search-input";
import { Switch } from "@/components/ui/switch";
import { SelectItem } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/dashboard/empty-state";
import { triggerDownload } from "@/components/reports/trigger-download";
import { TaskStatusCell } from "@/components/school-head/teacher-tasks/task-status-cell";
import { ARAL_TASK_KINDS } from "@/lib/monitoring/counts";
import { exportTeacherTasks } from "@/lib/actions/teacher-tasks";
import {
  TEACHER_TASK_KINDS,
  TEACHER_TASK_LABELS,
  isTeacherTaskKind,
  type TeacherTaskKind,
  type TeacherTaskSummary,
} from "@/lib/teacher-tasks/types";
import { callAction } from "@/lib/ui/call-action";
import { toastFailure } from "@/lib/ui/toast-failure";
import { cn } from "@/lib/utils";

type KindFilter = TeacherTaskKind | "ALL";

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

export function TeacherTasksBoard({
  summary,
  readOnly,
  schoolId,
  scope = "ALL",
}: {
  summary: TeacherTaskSummary;
  /** Super Admin school view: the export names the school explicitly. */
  readOnly: boolean;
  schoolId: string;
  /** ARAL: ARAL teachers and their ARAL tasks only. */
  scope?: "ALL" | "ARAL";
}) {
  const kinds: readonly TeacherTaskKind[] = scope === "ARAL" ? ARAL_TASK_KINDS : TEACHER_TASK_KINDS;
  const who = scope === "ARAL" ? "ARAL teacher" : "teacher";
  const whoMany = scope === "ARAL" ? "ARAL teachers" : "teachers";
  const uid = useId();
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<KindFilter>("ALL");
  const [pendingOnly, setPendingOnly] = useState(summary.teachersWithPending > 0);
  const [exporting, setExporting] = useState(false);
  const inFlight = useRef(false);

  const total = summary.rows.length;
  // A task filter always means "teachers behind on that task".
  const effectivePendingOnly = pendingOnly || kind !== "ALL";

  const scopeRows = useMemo(
    () =>
      summary.rows.filter((row) => {
        if (!effectivePendingOnly) return true;
        return kind === "ALL" ? row.pendingKinds.length > 0 : row.pendingKinds.includes(kind);
      }),
    [summary.rows, effectivePendingOnly, kind]
  );
  const needle = q.trim().toLowerCase();
  const visibleRows = useMemo(
    () => (needle ? scopeRows.filter((row) => row.name.toLowerCase().includes(needle)) : scopeRows),
    [scopeRows, needle]
  );

  const filtersActive = needle !== "" || kind !== "ALL";

  function clearFilters() {
    setQ("");
    setKind("ALL");
  }

  function chooseKind(next: KindFilter) {
    setKind(next);
    setQ("");
  }

  async function runExport() {
    if (inFlight.current) return;
    inFlight.current = true;
    setExporting(true);
    try {
      const res = await callAction(() =>
        exportTeacherTasks({
          schoolId: readOnly ? schoolId : undefined,
          onlyPending: effectivePendingOnly,
          kind,
          scope,
        })
      );
      if (!res.ok) {
        toastFailure(res);
        return;
      }
      triggerDownload(res.data.base64, res.data.filename);
      toast.success(`Downloaded ${res.data.filename}`);
    } finally {
      inFlight.current = false;
      setExporting(false);
    }
  }

  const exportScope = `${scopeRows.length} ${plural(scopeRows.length, who, whoMany)}${
    kind !== "ALL" ? `, not done with ${TEACHER_TASK_LABELS[kind]}` : effectivePendingOnly ? ", with pending tasks" : ", all"
  }. Search is not applied.`;

  const periodLine = kinds.map(
    (k) => `${TEACHER_TASK_LABELS[k]}: ${summary.periods[k]}`
  ).join(" · ");

  const switchId = `${uid}-pending-only`;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Periods checked.</span> {periodLine}
      </p>

      <ul
        className={cn(
          "grid grid-cols-2 gap-3 sm:grid-cols-3",
          kinds.length > 3 ? "xl:grid-cols-6" : "xl:grid-cols-4"
        )}
        aria-label="Pending by task"
      >
        <li className="col-span-2 sm:col-span-1">
          <Button
            type="button"
            variant="outline"
            aria-pressed={kind === "ALL"}
            onClick={() => chooseKind("ALL")}
            className={cn(
              "h-auto w-full flex-col items-start gap-0.5 whitespace-normal rounded-xl px-4 py-3 text-left lg:h-auto",
              kind === "ALL" && "border-primary ring-1 ring-primary"
            )}
          >
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Users aria-hidden /> Any task
            </span>
            <span className="text-2xl font-semibold tabular-nums text-foreground">
              {summary.teachersWithPending}
              <span className="text-sm font-normal text-muted-foreground"> of {total}</span>
            </span>
            <span className="text-xs text-muted-foreground">
              {plural(summary.teachersWithPending, `${who} has`, `${whoMany} have`)} pending tasks
            </span>
          </Button>
        </li>
        {kinds.map((k) => (
          <li key={k}>
            <Button
              type="button"
              variant="outline"
              aria-pressed={kind === k}
              onClick={() => chooseKind(kind === k ? "ALL" : k)}
              className={cn(
                "h-auto w-full flex-col items-start gap-0.5 whitespace-normal rounded-xl px-4 py-3 text-left lg:h-auto",
                kind === k && "border-primary ring-1 ring-primary"
              )}
            >
              <span className="text-xs text-muted-foreground">{TEACHER_TASK_LABELS[k]}</span>
              <span className="text-2xl font-semibold tabular-nums text-foreground">
                {summary.pendingByKind[k]}
              </span>
              <span className="text-xs text-muted-foreground">not done</span>
            </Button>
          </li>
        ))}
      </ul>

      <Card>
        <CardContent className="p-0">
          <div className="flex flex-col gap-3 border-b px-4 py-3 lg:flex-row lg:flex-wrap lg:items-end">
            <SearchInput
              id={`${uid}-search`}
              className="w-full lg:w-72 lg:flex-none"
              label="Search teachers by name"
              placeholder="Search by teacher name"
              value={q}
              onValueChange={setQ}
              onClear={() => setQ("")}
            />
            <div className="lg:w-52">
              <FacetSelect
                id={`${uid}-kind`}
                label="Task"
                value={kind}
                onValueChange={(v) => chooseKind(v === "ALL" || isTeacherTaskKind(v) ? v : "ALL")}
              >
                <SelectItem value="ALL">All tasks</SelectItem>
                {kinds.map((k) => (
                  <SelectItem key={k} value={k}>
                    {TEACHER_TASK_LABELS[k]}
                  </SelectItem>
                ))}
              </FacetSelect>
            </div>
            <div className="flex min-h-11 items-center gap-2">
              <Switch
                id={switchId}
                checked={effectivePendingOnly}
                disabled={kind !== "ALL"}
                onCheckedChange={setPendingOnly}
              />
              <label htmlFor={switchId} className="text-sm">
                Pending only
              </label>
            </div>
            {filtersActive ? (
              <Button type="button" size="sm" variant="ghost" onClick={clearFilters}>
                Clear filters
              </Button>
            ) : null}
            <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-1.5"
                loading={exporting}
                loadingText="Preparing…"
                disabled={total === 0}
                onClick={() => void runExport()}
              >
                <Download aria-hidden />
                Export to Excel
              </Button>
            </div>
          </div>
          <p className="border-b px-4 py-2 text-xs text-muted-foreground">
            Export covers {exportScope}
          </p>

          {total === 0 ? (
            <EmptyState
              icon={Users}
              title={`No ${whoMany} to track yet`}
              description={
                scope === "ARAL"
                  ? "Teachers appear here once they are the ARAL teacher of at least one ARAL learner."
                  : "Approved, active teachers appear here once they join this school."
              }
              className="m-4"
            />
          ) : visibleRows.length === 0 ? (
            filtersActive ? (
              <EmptyState
                icon={Users}
                title="No teachers match"
                description={
                  needle
                    ? `No teacher in this view has a name containing "${q.trim()}".`
                    : `No teacher is behind on ${kind === "ALL" ? "any task" : TEACHER_TASK_LABELS[kind]}.`
                }
                className="m-4"
              />
            ) : (
              <EmptyState
                icon={CheckCheck}
                title={`All ${whoMany} are up to date`}
                description="Nobody has a pending task for the periods above."
                className="m-4"
              />
            )
          ) : (
            <>
              <div className="hidden xl:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Teacher</TableHead>
                      <TableHead>Advisory</TableHead>
                      {kinds.map((k) => (
                        <TableHead key={k}>{TEACHER_TASK_LABELS[k]}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleRows.map((row) => (
                      <TableRow key={row.teacherId} className="align-top">
                        <TableCell className="font-medium">{row.name}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {row.advisorySections.length > 0
                            ? row.advisorySections.map((s) => s.label).join(", ")
                            : "No advisory"}
                        </TableCell>
                        {kinds.map((k) => (
                          <TableCell key={k} className="min-w-36 max-w-56">
                            <TaskStatusCell status={row.tasks[k]} />
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <ul className="divide-y divide-border/60 xl:hidden" aria-label="Teachers and their tasks">
                {visibleRows.map((row) => (
                  <li key={row.teacherId} className="flex flex-col gap-3 px-3 py-3 sm:px-4">
                    <div className="min-w-0">
                      <p className="font-medium text-foreground">{row.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {row.advisorySections.length > 0
                          ? row.advisorySections.map((s) => s.label).join(", ")
                          : "No advisory"}
                      </p>
                    </div>
                    <dl className="grid gap-3 sm:grid-cols-2">
                      {kinds.map((k) => (
                        <div key={k} className="min-w-0">
                          <dt className="mb-1 text-xs font-medium text-foreground">
                            {TEACHER_TASK_LABELS[k]}
                          </dt>
                          <dd>
                            <TaskStatusCell status={row.tasks[k]} />
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </li>
                ))}
              </ul>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
