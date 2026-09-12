"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ShieldCheck, Unlock as UnlockIcon } from "lucide-react";
import type { UnlockScope } from "@prisma/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfirmAction } from "@/components/confirm-action";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/dashboard/empty-state";
import { issueUnlock, revokeUnlock } from "@/lib/actions/unlock-admin";
import type { ActiveSchoolUnlock, ActiveTeacherUnlock, UnlockTargetSchool } from "@/lib/unlock/admin-queries";
import { UNLOCK_SCOPES, MAX_UNLOCK_DAYS, DEFAULT_UNLOCK_DAYS } from "@/lib/validators/support.schema";
import { UNLOCK_SCOPE_LABELS, TERM_PERIOD_LABELS } from "@/lib/constants/enum-labels";
import { TERM_PERIODS, type TermPeriodValue } from "@/lib/terms/windows";
import { formatLocalDateKey, schoolToday } from "@/lib/date-keys";
import { getMonday } from "@/lib/utils";
import {
  WEEK_PICKER_HISTORY,
  formatLongDate,
  formatWeekOption,
  formatWeekRange,
  weekPickerKeys,
} from "@/lib/week-range";
import {
  MONTH_PICKER_HISTORY,
  currentMonthKey,
  formatMonthLabel,
  monthPickerKeys,
} from "@/lib/month-range";

/**
 * The Super Admin's unlock console: reopen a closed window for one teacher or
 * a whole school, see what is open right now, and revoke it early.
 *
 * `issueUnlock`/`revokeUnlock` (`src/lib/actions/unlock-admin.ts`) already own
 * every tenant and validation rule; this component's only job is to collect a
 * payload that matches their schema exactly — one of `userId`/`schoolId`,
 * never both — and to show whatever they answer, success or failure.
 */

type Mode = "teacher" | "school";

type UnlockRow = {
  kind: "teacher" | "school";
  id: string;
  who: string;
  schoolName: string;
  scope: UnlockScope;
  targetKey: string;
  expiresAt: Date;
  createdAt: Date;
  grantedByName: string | null;
};

type Props = {
  schools: UnlockTargetSchool[];
  active: { teacher: ActiveTeacherUnlock[]; school: ActiveSchoolUnlock[] };
  scopes?: UnlockScope[];
  allowSchoolAudience?: boolean;
};

/** How a target key reads to a person, switched on the scope that named it. */
function periodLabel(scope: UnlockScope, targetKey: string): string {
  if (scope === "ARAL_WEEKLY_ATTENDANCE") return formatWeekRange(targetKey);
  if (scope === "TERM_GRADES") {
    return TERM_PERIOD_LABELS[targetKey as TermPeriodValue] ?? targetKey;
  }
  return formatMonthLabel(targetKey);
}

function combineRows(active: Props["active"]): UnlockRow[] {
  const teacherRows: UnlockRow[] = active.teacher.map((g) => ({
    kind: "teacher",
    id: g.id,
    who: g.teacherName,
    schoolName: g.schoolName,
    scope: g.scope,
    targetKey: g.targetKey,
    expiresAt: g.expiresAt,
    createdAt: g.createdAt,
    grantedByName: g.grantedByName,
  }));
  const schoolRows: UnlockRow[] = active.school.map((g) => ({
    kind: "school",
    id: g.id,
    who: "All teachers",
    schoolName: g.schoolName,
    scope: g.scope,
    targetKey: g.targetKey,
    expiresAt: g.expiresAt,
    createdAt: g.createdAt,
    grantedByName: g.grantedByName,
  }));
  return [...teacherRows, ...schoolRows].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
  );
}

function targetOptionsFor(scope: UnlockScope): { value: string; label: string }[] {
  if (scope === "ARAL_WEEKLY_ATTENDANCE") {
    const anchor = formatLocalDateKey(getMonday(schoolToday()));
    return weekPickerKeys(anchor, WEEK_PICKER_HISTORY).map((key) => ({
      value: key,
      label: formatWeekOption(key),
    }));
  }
  if (scope === "TERM_GRADES") {
    return TERM_PERIODS.map((term) => ({ value: term, label: TERM_PERIOD_LABELS[term] }));
  }
  return monthPickerKeys(currentMonthKey(), MONTH_PICKER_HISTORY).map((key) => ({
    value: key,
    label: formatMonthLabel(key),
  }));
}

export function UnlockConsole({ schools, active, scopes = UNLOCK_SCOPES as unknown as UnlockScope[], allowSchoolAudience = true }: Props) {
  const router = useRouter();
  const rows = useMemo(() => combineRows(active), [active]);

  const [mode, setMode] = useState<Mode>("teacher");
  const [schoolId, setSchoolId] = useState(schools[0]?.id ?? "");
  const [userId, setUserId] = useState(schools[0]?.teachers[0]?.id ?? "");
  const [scope, setScope] = useState<UnlockScope>("ARAL_WEEKLY_ATTENDANCE");
  const targetOptions = useMemo(() => targetOptionsFor(scope), [scope]);
  const [targetKey, setTargetKey] = useState(targetOptions[0]?.value ?? "");
  const [daysInput, setDaysInput] = useState(String(DEFAULT_UNLOCK_DAYS));
  const [error, setError] = useState<{ message: string; ref?: string } | null>(null);
  const [issuePending, setIssuePending] = useState(false);
  const [reason, setReason] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const allowedScopes = scopes.length ? scopes : (UNLOCK_SCOPES as unknown as UnlockScope[]);

  const selectedSchool = schools.find((s) => s.id === schoolId);
  const selectedTeacher = selectedSchool?.teachers.find((t) => t.id === userId);

  const daysNum = Number(daysInput);
  const daysValid = Number.isInteger(daysNum) && daysNum >= 1 && daysNum <= MAX_UNLOCK_DAYS;
  const expiresAt = daysValid ? new Date(Date.now() + daysNum * 86_400_000) : null;

  const canIssue =
    daysValid &&
    !!targetKey &&
    !!schoolId &&
    (mode === "teacher" ? !!userId : true) && reason.trim().length >= 3;

  function changeScope(next: UnlockScope) {
    setScope(next);
    setTargetKey(targetOptionsFor(next)[0]?.value ?? "");
  }

  function changeSchool(nextId: string) {
    setSchoolId(nextId);
    const next = schools.find((s) => s.id === nextId);
    setUserId(next?.teachers[0]?.id ?? "");
  }

  const summary = (() => {
    if (!selectedSchool || !targetKey || !daysValid) return "";
    const who =
      mode === "school"
        ? `all teachers at ${selectedSchool.name}`
        : `${selectedTeacher?.name ?? "the selected teacher"} at ${selectedSchool.name}`;
    const dayWord = daysNum === 1 ? "day" : "days";
    return `Allow revision of ${UNLOCK_SCOPE_LABELS[scope]} for ${periodLabel(scope, targetKey)} for ${who} for ${daysNum} ${dayWord}.`;
  })();

  async function handleIssue() {
    setError(null);
    setIssuePending(true);
    const payload =
      mode === "teacher"
        ? { mode: "teacher" as const, userId, scope, targetKey, days: daysNum }
        : { mode: "school" as const, schoolId, scope, targetKey, days: daysNum };
    try {
      const res = await issueUnlock({ ...payload, reason: reason.trim() });
      if (!res.ok) {
        // Closes the confirm dialog rather than leaving it open: Radix marks
        // the rest of the page `aria-hidden` while it is open, which would
        // bury this banner from anyone — assistive tech or not — until the
        // dialog closed anyway. The failure is never swallowed; it just
        // surfaces on the page instead of inside the dialog it was raised in.
        setError({ message: res.error, ref: res.ref });
        return;
      }
      toast.success(
        res.data.recipients === 1
          ? "Revision access allowed for 1 teacher."
          : `Revision access allowed for ${res.data.recipients} teachers.`
      );
      router.refresh();
      setConfirmOpen(false);
      setReason("");
    } catch (err) {
      // The dialog stays open on this path (unlike the `ok: false` branch
      // above, which closes it): there is no banner to bury, since the error
      // banner lives in the card behind the dialog, not inside it. A toast is
      // the only surface that reaches the user while the dialog is still up.
      toast.error("Something went wrong reopening access. Please try again.");
      throw err;
    } finally {
      setIssuePending(false);
    }
  }

  async function handleRevoke(row: UnlockRow) {
    setError(null);
    try {
      const res = await revokeUnlock({ kind: row.kind, grantId: row.id });
      if (!res.ok) {
        setError({ message: res.error, ref: res.ref });
        return;
      }
      toast.success("Revision access revoked.");
      router.refresh();
    } catch (err) {
      toast.error("Something went wrong revoking this unlock. Please try again.");
      throw err;
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <UnlockIcon className="h-4 w-4" aria-hidden />
          Allow a revision
        </CardTitle>
        <CardDescription>
          Grant one teacher or a whole school temporary access to a locked attendance week or reading-level month.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {error ? (
          <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error.message}
            {error.ref ? ` (Reference: ${error.ref})` : null}
          </p>
        ) : null}

        <div className="space-y-2">
          <Label>Who gets access</Label>
          <RadioGroup
            value={mode}
            onValueChange={(value) => setMode(value as Mode)}
            className="flex items-center gap-6"
          >
            <div className="flex items-center gap-2">
              <RadioGroupItem value="teacher" id="unlock-mode-teacher" />
              <Label htmlFor="unlock-mode-teacher" className="font-normal">
                One teacher
              </Label>
            </div>
            {allowSchoolAudience ? (
              <div className="flex items-center gap-2">
                <RadioGroupItem value="school" id="unlock-mode-school" />
                <Label htmlFor="unlock-mode-school" className="font-normal">
                  Whole school
                </Label>
              </div>
            ) : null}
          </RadioGroup>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="unlock-school">School</Label>
            <Select value={schoolId} onValueChange={changeSchool}>
              <SelectTrigger id="unlock-school">
                <SelectValue placeholder="Choose a school" />
              </SelectTrigger>
              <SelectContent>
                {schools.map((school) => (
                  <SelectItem key={school.id} value={school.id}>
                    {school.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {mode === "teacher" ? (
            <div className="space-y-1.5">
              <Label htmlFor="unlock-teacher">Teacher</Label>
              <Select value={userId} onValueChange={setUserId}>
                <SelectTrigger id="unlock-teacher">
                  <SelectValue placeholder="Choose a teacher" />
                </SelectTrigger>
                <SelectContent>
                  {(selectedSchool?.teachers ?? []).map((teacher) => (
                    <SelectItem key={teacher.id} value={teacher.id}>
                      {teacher.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="unlock-scope">What to reopen</Label>
            <Select value={scope} onValueChange={(v) => changeScope(v as UnlockScope)}>
              <SelectTrigger id="unlock-scope">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {allowedScopes.map((value) => (
                  <SelectItem key={value} value={value}>
                    {UNLOCK_SCOPE_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="unlock-target">Which period</Label>
            <Select value={targetKey} onValueChange={setTargetKey}>
              <SelectTrigger id="unlock-target">
                <SelectValue placeholder="Choose a period" />
              </SelectTrigger>
              <SelectContent>
                {targetOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="unlock-days">Days</Label>
          <div className="flex items-center gap-3">
            <Input
              id="unlock-days"
              type="number"
              min={1}
              max={MAX_UNLOCK_DAYS}
              value={daysInput}
              onChange={(event) => setDaysInput(event.target.value)}
              aria-invalid={!daysValid}
              className="max-w-[7rem]"
            />
            <p className="text-sm text-muted-foreground">
              {expiresAt
                ? // Through `schoolToday` so the day is Manila's on both the
                  // server (UTC) and the browser — `formatLongDate` alone reads
                  // local calendar fields, which differ between the two for
                  // eight hours a day and would mismatch on hydration.
                  `Expires ${formatLongDate(schoolToday(expiresAt))}`
                : `Choose 1–${MAX_UNLOCK_DAYS} days.`}
            </p>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="unlock-reason">Reason for revision access</Label>
          <Textarea
            id="unlock-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Explain why this revision window is needed"
            maxLength={500}
          />
          <p className="text-xs text-muted-foreground">Required for the audit trail.</p>
        </div>

        <Button disabled={!canIssue || issuePending} onClick={() => setConfirmOpen(true)}>
          <ShieldCheck className="h-4 w-4" aria-hidden />
          Allow revision
        </Button>

        <Dialog open={confirmOpen} onOpenChange={(open) => !issuePending && setConfirmOpen(open)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Allow this revision?</DialogTitle>
              <DialogDescription>Review the temporary access before it is issued.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3 rounded-lg bg-muted/50 p-4 text-sm">
              <p>{summary}</p>
              <p><strong>Expires:</strong> {expiresAt ? expiresAt.toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" }) : "—"}</p>
              <p><strong>Reason:</strong> {reason.trim() || "—"}</p>
              <p className="text-xs text-muted-foreground">This action is recorded in the audit log.</p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={issuePending}>Cancel</Button>
              <Button onClick={handleIssue} loading={issuePending} loadingText="Allowing">Confirm revision access</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <div className="space-y-3">
          <h4 className="text-sm font-semibold">Active revision grants</h4>
          {rows.length === 0 ? (
            <EmptyState
              title="No unlocks are open right now"
              description="Every window is following its normal deadline."
              icon={UnlockIcon}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Who</TableHead>
                  <TableHead>School</TableHead>
                  <TableHead>Scope</TableHead>
                  <TableHead>Window</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Granted by</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={`${row.kind}-${row.id}`}>
                    <TableCell>{row.who}</TableCell>
                    <TableCell>{row.schoolName}</TableCell>
                    <TableCell>{UNLOCK_SCOPE_LABELS[row.scope]}</TableCell>
                    <TableCell>{periodLabel(row.scope, row.targetKey)}</TableCell>
                    <TableCell>{formatLongDate(schoolToday(row.expiresAt))}</TableCell>
                    <TableCell>{row.grantedByName ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      <ConfirmAction
              title="Revoke this revision grant?"
                        description={`${row.who} at ${row.schoolName} will lose access to ${UNLOCK_SCOPE_LABELS[row.scope]} for ${periodLabel(row.scope, row.targetKey)} immediately.`}
                        confirmLabel="Confirm revoke"
                        variant="destructive"
                        trigger={
                          <Button variant="outline" size="sm">
                            Revoke
                          </Button>
                        }
                        onConfirm={() => handleRevoke(row)}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
