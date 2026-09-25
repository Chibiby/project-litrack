"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarRange, Save, Unlock } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { updateAdminTermWindows } from "@/lib/actions/admin-term-windows";
import { getTermWindows, validateTermWindows, type TermPeriodValue } from "@/lib/terms/windows";
import { parseLocalDateKey } from "@/lib/date-keys";
import { UnlockConsole } from "@/components/admin/unlock-console";
import type { ActiveUnlocks, UnlockTargetSchool } from "@/lib/unlock/admin-queries";
import { SubmissionLockingSettings, ReadingLevelUnlockSettings } from "@/components/admin/submission-locking-settings";
import { UNLOCK_SCOPES } from "@/lib/validators/support.schema";

type YearOption = { id: string; schoolId: string; schoolName: string; label: string; startKey: string; endKey: string; isActive: boolean; overrides: { term: TermPeriodValue; startKey: string; endKey: string; deadlineKey: string }[] };

type Props = { schools: UnlockTargetSchool[]; years: YearOption[]; selected: YearOption | null; allSelected: boolean; active: ActiveUnlocks; lockingEnabled: boolean; readingLevelUnlockedForAll: boolean };

type Draft = { term: TermPeriodValue; startKey: string; endKey: string; deadlineKey: string; isOverridden: boolean; label: string; rangeLabel: string };

const ALL_SCHOOLS = "__ALL_SCHOOLS__";

export function SubmissionsConsole({ schools, years, selected, allSelected, active, lockingEnabled, readingLevelUnlockedForAll }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [drafts, setDrafts] = useState<Draft[]>(() => selected ? getTermWindows(parseLocalDateKey(selected.startKey), selected.overrides) : []);
  const [error, setError] = useState<string | null>(null);
  const selectedSchoolId = allSelected ? ALL_SCHOOLS : selected?.schoolId ?? "";

  function chooseSchool(schoolId: string) {
    if (schoolId === ALL_SCHOOLS) {
      router.push("/admin/submissions?schoolId=all");
      return;
    }
    const first = years.find((year) => year.schoolId === schoolId);
    router.push(`/admin/submissions?schoolId=${schoolId}${first ? `&schoolYearId=${first.id}` : ""}`);
  }
  function chooseYear(yearId: string) {
    const year = years.find((item) => item.id === yearId);
    if (year) router.push(`/admin/submissions?schoolId=${year.schoolId}&schoolYearId=${year.id}`);
  }
  function updateDraft(term: TermPeriodValue, field: "startKey" | "endKey" | "deadlineKey", value: string) {
    setDrafts((current) => current.map((item) => item.term === term ? { ...item, [field]: value, isOverridden: true } : item));
  }
  function save() {
    if (!selected) return;
    const message = validateTermWindows(drafts, selected.startKey, selected.endKey);
    if (message) { setError(message); return; }
    setError(null);
    startTransition(async () => {
      const terms = drafts.map(({ term, startKey, endKey, deadlineKey }) => ({ term, startKey, endKey, deadlineKey }));
      const activeYears = years.filter((year) => year.isActive);
      const result = allSelected
        ? await updateAdminTermWindows({ schoolYearIds: (activeYears.length ? activeYears : years).map((year) => year.id), terms })
        : await updateAdminTermWindows({ schoolYearId: selected.id, terms });
      if (!result.ok) { setError(result.error); return; }
      toast.success("Term windows saved.");
      router.refresh();
    });
  }

  const hasChanges = useMemo(() => selected ? drafts.some((draft) => { const base = getTermWindows(parseLocalDateKey(selected.startKey)).find((item) => item.term === draft.term)!; return draft.startKey !== base.startKey || draft.endKey !== base.endKey || draft.deadlineKey !== base.deadlineKey; }) : false, [drafts, selected]);

  return <div className="min-w-0 space-y-6">
    <Card className="min-w-0 rounded-2xl">
      <CardHeader className="p-4 sm:p-6"><CardTitle className="flex items-center gap-2 text-lg"><CalendarRange className="h-5 w-5" aria-hidden />Submission windows</CardTitle><CardDescription>Super Admin controls for each school year. Changes apply to teachers immediately.</CardDescription></CardHeader>
      <CardContent className="space-y-5 p-4 pt-0 sm:p-6 sm:pt-0">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2"><Label htmlFor="submission-school">School</Label><select id="submission-school" className="flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm" value={selectedSchoolId} onChange={(event) => chooseSchool(event.target.value)}><option value={ALL_SCHOOLS}>All schools</option>{schools.map((school) => <option key={school.id} value={school.id}>{school.name}</option>)}</select></div>
          <div className="space-y-2"><Label htmlFor="submission-year">School year</Label><select id="submission-year" className="flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm disabled:opacity-60" disabled={allSelected} value={allSelected ? "all-years" : selected?.id ?? ""} onChange={(event) => chooseYear(event.target.value)}><option value={allSelected ? "all-years" : ""}>{allSelected ? "All active school years" : "Choose a school year"}</option>{!allSelected ? years.filter((year) => !selectedSchoolId || year.schoolId === selectedSchoolId).map((year) => <option key={year.id} value={year.id}>{year.label} · {year.schoolName}</option>) : null}</select></div>
        </div>
        {selected ? <>
          <div className="rounded-lg bg-muted/50 px-4 py-3 text-sm">{allSelected ? "Editing applies to every active school year." : <>School-year range: <strong>{selected.startKey}</strong> to <strong>{selected.endKey}</strong>.</>} Terms cannot overlap and deadlines cannot precede term ends.</div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">{drafts.map((term) => <Card key={term.term} className="min-w-0 border-border/80 shadow-none"><CardHeader className="pb-3"><CardTitle className="text-base">{term.label}</CardTitle>{term.isOverridden ? <Badge variant="secondary" className="w-fit">Overridden</Badge> : <Badge variant="outline" className="w-fit">Derived</Badge>}</CardHeader><CardContent className="space-y-3"><div className="space-y-1"><Label htmlFor={`${term.term}-start`}>Start date</Label><Input id={`${term.term}-start`} type="date" value={term.startKey} onChange={(event) => updateDraft(term.term, "startKey", event.target.value)} /></div><div className="space-y-1"><Label htmlFor={`${term.term}-end`}>End date</Label><Input id={`${term.term}-end`} type="date" value={term.endKey} onChange={(event) => updateDraft(term.term, "endKey", event.target.value)} /></div><div className="space-y-1"><Label htmlFor={`${term.term}-deadline`}>Revision deadline</Label><Input id={`${term.term}-deadline`} type="date" value={term.deadlineKey} onChange={(event) => updateDraft(term.term, "deadlineKey", event.target.value)} /></div><p className="text-xs text-muted-foreground">Effective window: {term.startKey} → {term.endKey}; edits close {term.deadlineKey}.</p></CardContent></Card>)}</div>
          {error ? <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}
          <Button onClick={save} disabled={pending || !hasChanges} loading={pending} loadingText="Saving"><Save className="h-4 w-4" />Save term windows</Button>
        </> : <p className="text-sm text-muted-foreground">Choose a school and school year to edit its three terms.</p>}
      </CardContent>
    </Card>

    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2"><SubmissionLockingSettings enabled={lockingEnabled} /><ReadingLevelUnlockSettings enabled={readingLevelUnlockedForAll} /></div>
    <section aria-labelledby="revision-access-heading" className="min-w-0 space-y-3"><div><h2 id="revision-access-heading" className="flex items-center gap-2 text-lg font-semibold"><Unlock className="h-5 w-5" aria-hidden />Revision access</h2><p className="mt-0.5 text-sm text-muted-foreground">Allow all teachers at the selected school, or one teacher, to revise locked attendance or monthly reading-level records.</p></div><UnlockConsole schools={schools} active={active} scopes={UNLOCK_SCOPES.filter((scope) => scope !== "TERM_GRADES")} allowSchoolAudience initialMode="school" /></section>
  </div>;
}