"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  GraduationCap,
  Trash2,
  Users,
} from "lucide-react";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";
import { removeSchoolLearners, removeSchoolTeachers } from "@/lib/actions/admin-school";
import { CONFIRM_PHRASES } from "@/lib/constants/confirm-phrases";
import { removeAllTeachers, resetOperationalData } from "@/lib/actions/database";
import type { LearnerRow, SchoolDetail, TeacherRow } from "@/lib/admin/school-detail";

/**
 * The Super Admin view of one school.
 *
 * Selection lives here rather than in each table so the two rosters can share
 * one shape without sharing state: ticking a teacher must never carry over into
 * the learner submission, so each table owns its own `Set` and clears it after
 * a successful removal.
 */

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-PH", {
    timeZone: "Asia/Manila",
    dateStyle: "medium",
  });
}

/** A labelled fact on the profile card. Renders an em dash rather than nothing. */
function Fact({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words text-sm font-medium">{value?.trim() || "—"}</dd>
    </div>
  );
}

function CountTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border/70 bg-muted/40 px-3 py-2">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-xl font-semibold tabular-nums">{value.toLocaleString()}</p>
    </div>
  );
}

/**
 * The typed-phrase gate the whole-school clear sits behind.
 *
 * Same bar as the Danger zone on `/admin/database`, because it is the same
 * operation: type the phrase exactly, and the phrase is re-checked server-side.
 */
function ClearEverything({ schoolId, schoolName }: { schoolId: string; schoolName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [pending, startTransition] = useTransition();
  const matches = typed.trim() === CONFIRM_PHRASES.resetOperational;

  const run = () => {
    startTransition(async () => {
      const data = new FormData();
      data.set("confirm", CONFIRM_PHRASES.resetOperational);
      data.set("schoolId", schoolId);

      const cleared = await resetOperationalData(data);
      if (!cleared.ok) {
        toast.error(cleared.error);
        return;
      }

      const teachers = new FormData();
      teachers.set("confirm", CONFIRM_PHRASES.removeTeachers);
      teachers.set("schoolId", schoolId);
      const removed = await removeAllTeachers(teachers);
      if (!removed.ok) {
        // The records are already gone; say so rather than implying nothing ran.
        toast.error(`Records cleared, but the teacher accounts were not: ${removed.error}`);
      } else {
        toast.success(`${schoolName} cleared`);
      }

      setTyped("");
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="flex items-center gap-2 font-medium">
            <Trash2 className="h-4 w-4" aria-hidden />
            Clear everything for this school
          </p>
          <p className="text-sm text-muted-foreground">
            Deletes every learner and record belonging to {schoolName}, then removes its teacher
            accounts. The school, its school years, grade levels and sections stay. No other school
            is touched.
          </p>
        </div>
        {!open ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => setOpen(true)}
          >
            Clear school
          </Button>
        ) : null}
      </div>

      {open ? (
        <div className="mt-3 space-y-2 border-t border-destructive/20 pt-3">
          <label className="block text-sm font-medium" htmlFor="clear-school-confirm">
            Type{" "}
            <code className="rounded bg-muted px-1 font-mono">
              {CONFIRM_PHRASES.resetOperational}
            </code>{" "}
            to confirm
          </label>
          <div className="flex flex-wrap gap-2">
            <Input
              id="clear-school-confirm"
              value={typed}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setTyped(e.target.value)}
              className="w-full sm:w-56"
              aria-label={`Type ${CONFIRM_PHRASES.resetOperational} to confirm`}
            />
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={!matches}
              loading={pending}
              loadingText="Clearing…"
              onClick={run}
            >
              Clear school
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => {
                setTyped("");
                setOpen(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Shared header cell for a roster's select-all box. */
function SelectAll({
  ids,
  selected,
  onChange,
  label,
}: {
  ids: string[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  label: string;
}) {
  const all = ids.length > 0 && ids.every((id) => selected.has(id));
  return (
    <Checkbox
      checked={all}
      disabled={ids.length === 0}
      aria-label={label}
      onCheckedChange={(v) => onChange(v === true ? new Set(ids) : new Set())}
    />
  );
}

export function SchoolDetailView({ detail }: { detail: SchoolDetail }) {
  const router = useRouter();
  const { school, counts, teachers, learners, learnerPage, learnerPages } = detail;

  const [pickedTeachers, setPickedTeachers] = useState<Set<string>>(new Set());
  const [pickedLearners, setPickedLearners] = useState<Set<string>>(new Set());
  const [removingTeachers, startTeacherRemoval] = useTransition();
  const [removingLearners, startLearnerRemoval] = useTransition();

  const toggle = (set: Set<string>, id: string): Set<string> => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };

  const removeTeachers = (ids: string[]) => {
    startTeacherRemoval(async () => {
      const fd = new FormData();
      fd.set("schoolId", school.id);
      for (const id of ids) fd.append("teacherIds", id);

      const res = await removeSchoolTeachers(fd);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      const { removed = 0, failed = 0 } = res.data ?? {};
      toast.success(
        `${removed} teacher account${removed === 1 ? "" : "s"} removed${failed ? `, ${failed} failed` : ""}`
      );
      setPickedTeachers(new Set());
      router.refresh();
    });
  };

  const removeLearners = (ids: string[]) => {
    startLearnerRemoval(async () => {
      const fd = new FormData();
      fd.set("schoolId", school.id);
      for (const id of ids) fd.append("learnerIds", id);

      const res = await removeSchoolLearners(fd);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      const removed = res.data?.removed ?? 0;
      toast.success(`${removed} learner${removed === 1 ? "" : "s"} removed`);
      setPickedLearners(new Set());
      router.refresh();
    });
  };

  const learnerHref = (page: number) => `/admin/schools/${school.id}?learners=${page}`;

  return (
    <div className="space-y-6">
      {/* Profile */}
      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold">{school.name}</h2>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <Badge variant={school.isActive ? "default" : "secondary"}>
                  {school.isActive ? "Active" : "Inactive"}
                </Badge>
                {school.isDemo ? (
                  <Badge className="border-violet-300 bg-violet-50 text-violet-700 hover:bg-violet-50 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-300">
                    Demo
                  </Badge>
                ) : null}
                <span className="text-xs text-muted-foreground">
                  Added {formatDate(school.createdAt)}
                </span>
              </div>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link href={`${SCHOOL_HEAD_ROUTES.dashboard}?schoolId=${school.id}`} prefetch>
                <ExternalLink className="mr-2 h-4 w-4" aria-hidden />
                Open as School Head
              </Link>
            </Button>
          </div>

          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
            <Fact label="School ID" value={school.schoolIdCode} />
            <Fact label="Region" value={school.region} />
            <Fact label="Division" value={school.division} />
            <Fact label="District" value={school.district} />
            <Fact label="Address" value={school.address} />
          </dl>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <CountTile label="Teachers" value={counts.teachers} />
            <CountTile label="Learners" value={counts.learners} />
            <CountTile label="Sections" value={counts.sections} />
            <CountTile label="Grade levels" value={counts.gradeLevels} />
            <CountTile label="School years" value={counts.schoolYears} />
          </div>
        </CardContent>
      </Card>

      {/* Teachers */}
      <Card>
        <CardContent className="space-y-3 pt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <Users className="h-5 w-5" aria-hidden />
              Teachers
              <Badge variant="secondary">{counts.teachers}</Badge>
            </h2>
            {pickedTeachers.size > 0 ? (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                loading={removingTeachers}
                loadingText="Removing…"
                onClick={() => removeTeachers([...pickedTeachers])}
              >
                <Trash2 className="mr-2 h-4 w-4" aria-hidden />
                Remove {pickedTeachers.size} selected
              </Button>
            ) : null}
          </div>

          {teachers.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No teacher accounts in this school.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <SelectAll
                        ids={teachers.map((t) => t.id)}
                        selected={pickedTeachers}
                        onChange={setPickedTeachers}
                        label="Select every teacher"
                      />
                    </TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Advisory</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {teachers.map((teacher: TeacherRow) => (
                    <TableRow key={teacher.id}>
                      <TableCell>
                        <Checkbox
                          checked={pickedTeachers.has(teacher.id)}
                          aria-label={`Select ${teacher.fullName}`}
                          onCheckedChange={() =>
                            setPickedTeachers((s) => toggle(s, teacher.id))
                          }
                        />
                      </TableCell>
                      <TableCell className="font-medium">{teacher.fullName}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {teacher.email}
                      </TableCell>
                      <TableCell>
                        {teacher.approvalStatus === "PENDING" ? (
                          <Badge variant="outline">Pending</Badge>
                        ) : teacher.isActive ? (
                          <Badge className="bg-primary/10 text-primary hover:bg-primary/10">
                            Active
                          </Badge>
                        ) : (
                          <Badge variant="secondary">Inactive</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {teacher.advisorySection ?? "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          disabled={removingTeachers}
                          aria-label={`Remove ${teacher.fullName}`}
                          onClick={() => removeTeachers([teacher.id])}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Learners */}
      <Card>
        <CardContent className="space-y-3 pt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <GraduationCap className="h-5 w-5" aria-hidden />
              Learners
              <Badge variant="secondary">{counts.learners}</Badge>
            </h2>
            {pickedLearners.size > 0 ? (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                loading={removingLearners}
                loadingText="Removing…"
                onClick={() => removeLearners([...pickedLearners])}
              >
                <Trash2 className="mr-2 h-4 w-4" aria-hidden />
                Remove {pickedLearners.size} selected
              </Button>
            ) : null}
          </div>

          {learners.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No learners in this school.
            </p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <SelectAll
                          ids={learners.map((l) => l.id)}
                          selected={pickedLearners}
                          onChange={setPickedLearners}
                          label="Select every learner on this page"
                        />
                      </TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Grade</TableHead>
                      <TableHead>Section</TableHead>
                      <TableHead>ARAL</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {learners.map((learner: LearnerRow) => (
                      <TableRow key={learner.id}>
                        <TableCell>
                          <Checkbox
                            checked={pickedLearners.has(learner.id)}
                            aria-label={`Select ${learner.fullName}`}
                            onCheckedChange={() =>
                              setPickedLearners((s) => toggle(s, learner.id))
                            }
                          />
                        </TableCell>
                        <TableCell className="font-medium">{learner.fullName}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {learner.gradeLevel}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {learner.section ?? "—"}
                        </TableCell>
                        <TableCell>
                          {learner.isAralLearner ? (
                            <Badge className="bg-violet-100 text-violet-700 hover:bg-violet-100 dark:bg-violet-950 dark:text-violet-300">
                              ARAL
                            </Badge>
                          ) : (
                            <span className="text-sm text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            disabled={removingLearners}
                            aria-label={`Remove ${learner.fullName}`}
                            onClick={() => removeLearners([learner.id])}
                          >
                            <Trash2 className="h-4 w-4" aria-hidden />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {learnerPages > 1 ? (
                <div className="flex items-center justify-between gap-3 pt-1">
                  <span className="text-sm text-muted-foreground">
                    Page {learnerPage} of {learnerPages}
                  </span>
                  <div className="flex gap-2">
                    <Button asChild={learnerPage > 1} variant="outline" size="sm" disabled={learnerPage <= 1}>
                      {learnerPage > 1 ? (
                        <Link href={learnerHref(learnerPage - 1)}>
                          <ChevronLeft className="mr-1 h-4 w-4" aria-hidden />
                          Previous
                        </Link>
                      ) : (
                        <span>
                          <ChevronLeft className="mr-1 h-4 w-4" aria-hidden />
                          Previous
                        </span>
                      )}
                    </Button>
                    <Button
                      asChild={learnerPage < learnerPages}
                      variant="outline"
                      size="sm"
                      disabled={learnerPage >= learnerPages}
                    >
                      {learnerPage < learnerPages ? (
                        <Link href={learnerHref(learnerPage + 1)}>
                          Next
                          <ChevronRight className="ml-1 h-4 w-4" aria-hidden />
                        </Link>
                      ) : (
                        <span>
                          Next
                          <ChevronRight className="ml-1 h-4 w-4" aria-hidden />
                        </span>
                      )}
                    </Button>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>

      {/* Danger zone, scoped to this school */}
      <Card className="border-destructive/40">
        <CardContent className="space-y-3 pt-6">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold text-destructive">
              <AlertTriangle className="h-5 w-5" aria-hidden />
              Danger zone
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Removing rows above is reversible by support — the records are hidden, not deleted.
              This is not: it empties the tables. A safety point is saved first if backup storage
              is connected, and “Undo last operation” on the Database page restores it.
            </p>
          </div>
          <ClearEverything schoolId={school.id} schoolName={school.name} />
        </CardContent>
      </Card>
    </div>
  );
}
