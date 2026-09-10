"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
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
  Database,
  Download,
  RotateCcw,
  Save,
  Trash2,
  Undo2,
  Upload,
} from "lucide-react";
import {
  CONFIRM_PHRASES,
  createBackupNow,
  removeAllTeachers,
  removeBackup,
  resetAllSchoolAccounts,
  resetOperationalData,
  restoreFromBackup,
  restoreFromUpload,
  undoLastOperation,
} from "@/lib/actions/database";

export type BackupRow = {
  kind: "daily" | "weekly" | "safety";
  pathname: string;
  stamp: string;
  size: number;
  uploadedAt: string;
};

/** One row of the Danger zone's school picker, with the numbers it relabels. */
export type SchoolOption = {
  id: string;
  name: string;
  schoolHeads: number;
  teachers: number;
};

export type ConsoleData = {
  storeReady: boolean;
  storeMessage: string;
  backups: BackupRow[];
  safety: BackupRow | null;
  counts: Record<string, number>;
  totalRows: number;
  accounts: { schoolHeads: number; teachers: number };
  schools: SchoolOption[];
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * A destructive button that will not fire until its exact phrase is typed.
 *
 * A dialog with an OK button is muscle memory; typing REMOVE TEACHERS is not.
 * Every action behind this component rewrites or empties data across every
 * school at once, so the friction is the feature — and the same phrase is
 * re-checked server-side, because a disabled button is not a guard.
 *
 * With no backup store connected (`noBackup`) the action is still allowed, but
 * behind a second tick saying so out loud: there will be no safety point and
 * no undo. The tick is per-run — it resets the moment the panel closes.
 */
function DangerAction({
  phrase,
  label,
  title,
  description,
  icon,
  noBackup,
  onRun,
}: {
  phrase: string;
  label: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  noBackup?: boolean;
  onRun: (confirm: string, ackNoBackup: boolean) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [acked, setAcked] = useState(false);
  const [pending, startTransition] = useTransition();
  const matches = typed.trim() === phrase;
  const ready = matches && (!noBackup || acked);

  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="flex items-center gap-2 font-medium">
            {icon}
            {title}
          </p>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        {!open ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => setOpen(true)}
          >
            {label}
          </Button>
        ) : null}
      </div>

      {open ? (
        <div className="mt-3 space-y-2 border-t border-destructive/20 pt-3">
          {noBackup ? (
            <label className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">
              <Checkbox
                checked={acked}
                onCheckedChange={(v) => setAcked(v === true)}
                className="border-destructive data-[state=checked]:bg-destructive"
                aria-label="Acknowledge that there is no backup and this cannot be undone"
              />
              <span>No backup is stored. This cannot be undone — I understand.</span>
            </label>
          ) : null}
          <label className="block text-sm font-medium" htmlFor={`confirm-${phrase}`}>
            Type <code className="rounded bg-muted px-1 font-mono">{phrase}</code> to confirm
          </label>
          <div className="flex flex-wrap gap-2">
            <Input
              id={`confirm-${phrase}`}
              value={typed}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setTyped(e.target.value)}
              className="w-full sm:w-56"
              aria-label={`Type ${phrase} to confirm`}
            />
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={!ready}
              loading={pending}
              loadingText="Running…"
              onClick={() => {
                startTransition(async () => {
                  await onRun(typed.trim(), acked);
                  setTyped("");
                  setAcked(false);
                  setOpen(false);
                });
              }}
            >
              {label}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => {
                setTyped("");
                setAcked(false);
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

export function DatabaseConsole({ data }: { data: ConsoleData }) {
  const [backingUp, startBackup] = useTransition();
  const [undoing, startUndo] = useTransition();
  const [restoring, startRestore] = useTransition();
  const [uploadConfirm, setUploadConfirm] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  /** "" is every school — the Danger zone's original and still-default reach. */
  const [targetSchoolId, setTargetSchoolId] = useState("");
  const targetSchool = data.schools.find((s) => s.id === targetSchoolId) ?? null;

  /**
   * The numbers the two account buttons name. A picked school reports its own;
   * with none picked they stay the whole-system totals the page loaded with.
   */
  const scopedAccounts = targetSchool
    ? { schoolHeads: targetSchool.schoolHeads, teachers: targetSchool.teachers }
    : data.accounts;

  const schoolOptions = [
    { value: "", label: "All schools" },
    ...data.schools.map((s) => ({
      value: s.id,
      label: s.name,
      hint: `${s.schoolHeads} head${s.schoolHeads === 1 ? "" : "s"}, ${s.teachers} teacher${s.teachers === 1 ? "" : "s"}`,
    })),
  ];

  /** Backing up, restoring and undoing all need the store; the Danger zone does not. */
  const disabled = !data.storeReady;

  /** Server actions here return a result; success messages differ, failures never redirect. */
  const settle = async (
    run: () => Promise<{ ok: true; data?: unknown } | { ok: false; error: string }>,
    success: (payload: unknown) => string
  ) => {
    const res = await run();
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(success(res.data));
  };

  return (
    <div className="space-y-6">
      {!data.storeReady ? (
        <Card className="border-amber-300 bg-amber-50 dark:border-amber-500/40 dark:bg-amber-950/40">
          <CardContent className="flex gap-3 pt-6 text-sm text-amber-950 dark:text-amber-100">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
            <div>
              <p className="font-semibold">Backup storage is not connected</p>
              <p className="mt-1">{data.storeMessage}</p>
              <p className="mt-1">
                Until then backing up, restoring and undoing cannot run. The Danger zone below
                still can, but nothing it does will be reversible — each action asks you to say so
                before it runs.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Undo — first, because it is what someone who just made a mistake is looking for. */}
      <Card>
        <CardContent className="space-y-3 pt-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-lg font-semibold">
                <Undo2 className="h-5 w-5" aria-hidden />
                Undo last operation
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {data.safety
                  ? `A safety point was saved before the last destructive action, on ${formatWhen(data.safety.uploadedAt)}. Undoing puts the database back exactly as it was then.`
                  : "Nothing to undo. A safety point is saved automatically before every reset and restore."}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={disabled || !data.safety}
              loading={undoing}
              loadingText="Undoing…"
              onClick={() => {
                startUndo(async () => {
                  await settle(undoLastOperation, () => "Database restored to the safety point");
                });
              }}
            >
              <Undo2 className="mr-2 h-4 w-4" aria-hidden />
              Undo
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Current contents */}
      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <Database className="h-5 w-5" aria-hidden />
              Current contents
            </h2>
            <div className="flex items-center gap-2">
              <Badge variant="secondary">{data.totalRows.toLocaleString()} rows</Badge>
              <Button
                type="button"
                size="sm"
                disabled={disabled}
                loading={backingUp}
                loadingText="Backing up…"
                onClick={() => {
                  startBackup(async () => {
                    await settle(createBackupNow, (payload) => {
                      const d = payload as { size?: number } | undefined;
                      return `Backup saved${d?.size ? ` (${formatBytes(d.size)})` : ""}`;
                    });
                  });
                }}
              >
                <Save className="mr-2 h-4 w-4" aria-hidden />
                Back up now
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3 lg:grid-cols-4">
            {Object.entries(data.counts)
              .filter(([, n]) => n > 0)
              .map(([model, n]) => (
                <div key={model} className="flex justify-between gap-2 border-b border-border/40 py-1">
                  <span className="truncate text-muted-foreground">{model}</span>
                  <span className="font-medium tabular-nums">{n.toLocaleString()}</span>
                </div>
              ))}
          </div>
        </CardContent>
      </Card>

      {/* Stored backups */}
      <Card>
        <CardContent className="space-y-4 pt-6">
          <div>
            <h2 className="text-lg font-semibold">Backups</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Kept automatically: the 3 most recent daily backups and 1 weekly. A new backup
              replaces the oldest of its kind. Daily runs 00:00 and weekly Sunday 00:30, Manila
              time.
            </p>
          </div>

          <div className="overflow-x-auto rounded-lg border border-border/80">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead>Kind</TableHead>
                  <TableHead>Taken</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.backups.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                      No backups yet. Use “Back up now”, or wait for tonight&rsquo;s scheduled run.
                    </TableCell>
                  </TableRow>
                ) : (
                  data.backups.map((b) => (
                    <TableRow key={b.pathname}>
                      <TableCell>
                        <Badge variant={b.kind === "safety" ? "outline" : "secondary"}>
                          {b.kind === "safety" ? "undo point" : b.kind}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">{formatWhen(b.uploadedAt)}</TableCell>
                      <TableCell className="text-sm tabular-nums">{formatBytes(b.size)}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap justify-end gap-1">
                          <Button asChild variant="ghost" size="sm">
                            <a
                              href={`/api/admin/backups/download?path=${encodeURIComponent(b.pathname)}`}
                              aria-label={`Download the ${b.kind} backup from ${formatWhen(b.uploadedAt)}`}
                            >
                              <Download className="mr-1.5 h-4 w-4" aria-hidden />
                              Download
                            </a>
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={disabled || restoring}
                            onClick={() => {
                              const typed = window.prompt(
                                `Restore the ${b.kind} backup from ${formatWhen(b.uploadedAt)}?\n\nThis replaces ALL current data in every school. A safety point is saved first so you can undo it.\n\nType ${CONFIRM_PHRASES.restore} to confirm.`
                              );
                              if (typed?.trim() !== CONFIRM_PHRASES.restore) return;
                              startRestore(async () => {
                                const fd = new FormData();
                                fd.set("pathname", b.pathname);
                                fd.set("confirm", CONFIRM_PHRASES.restore);
                                await settle(
                                  () => restoreFromBackup(fd),
                                  () => "Database restored"
                                );
                              });
                            }}
                          >
                            <RotateCcw className="mr-1.5 h-4 w-4" aria-hidden />
                            Restore
                          </Button>
                          {b.kind !== "safety" ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive"
                              disabled={disabled}
                              aria-label={`Delete the ${b.kind} backup from ${formatWhen(b.uploadedAt)}`}
                              onClick={() => {
                                if (!window.confirm("Delete this backup permanently?")) return;
                                startRestore(async () => {
                                  const fd = new FormData();
                                  fd.set("pathname", b.pathname);
                                  await settle(
                                    () => removeBackup(fd),
                                    () => "Backup deleted"
                                  );
                                });
                              }}
                            >
                              <Trash2 className="h-4 w-4" aria-hidden />
                            </Button>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Restore from file */}
      <Card>
        <CardContent className="space-y-3 pt-6">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <Upload className="h-5 w-5" aria-hidden />
              Restore from a file
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Upload a backup you downloaded earlier (<code>.json.gz</code> or <code>.json</code>).
              This replaces all current data. A safety point is saved first.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <input
              ref={fileRef}
              type="file"
              accept=".gz,.json,application/gzip,application/json"
              aria-label="Backup file to restore"
              className="block w-full max-w-sm rounded-lg border border-border bg-background p-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm"
            />
            <Input
              value={uploadConfirm}
              onChange={(e) => setUploadConfirm(e.target.value)}
              placeholder={CONFIRM_PHRASES.restore}
              autoComplete="off"
              spellCheck={false}
              className="w-40"
              aria-label={`Type ${CONFIRM_PHRASES.restore} to confirm the upload restore`}
            />
            <Button
              type="button"
              variant="destructive"
              disabled={uploadConfirm.trim() !== CONFIRM_PHRASES.restore}
              loading={restoring}
              loadingText="Restoring…"
              onClick={() => {
                const file = fileRef.current?.files?.[0];
                if (!file) {
                  toast.error("Choose a backup file first.");
                  return;
                }
                startRestore(async () => {
                  const fd = new FormData();
                  fd.set("file", file);
                  fd.set("confirm", CONFIRM_PHRASES.restore);
                  await settle(
                    () => restoreFromUpload(fd),
                    () => "Database restored from file"
                  );
                  setUploadConfirm("");
                  if (fileRef.current) fileRef.current.value = "";
                });
              }}
            >
              Restore from file
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Danger zone */}
      <Card className="border-destructive/40">
        <CardContent className="space-y-3 pt-6">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold text-destructive">
              <AlertTriangle className="h-5 w-5" aria-hidden />
              Danger zone
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {targetSchool
                ? `Scoped to ${targetSchool.name}. Every other school is left alone.`
                : "Each of these affects every school at once."}{" "}
              {data.storeReady
                ? "All three save a safety point first, so “Undo last operation” above can put things back — and that safety point covers the whole database, not just the school picked here."
                : "With no backup storage connected there is no safety point to save, so nothing here can be undone — each action asks you to confirm that before it runs."}
            </p>
          </div>

          <div className="space-y-1.5 rounded-lg border border-border/70 bg-muted/40 p-3">
            <label className="text-sm font-medium" htmlFor="danger-scope">
              Applies to
            </label>
            <SearchableSelect
              id="danger-scope"
              options={schoolOptions}
              value={targetSchoolId}
              onValueChange={setTargetSchoolId}
              placeholder="All schools"
              searchPlaceholder="Search schools…"
              emptyMessage="No school matches that."
            />
            <p className="text-xs text-muted-foreground">
              {targetSchool
                ? "Only this school's records and accounts are touched."
                : `Every school at once — all ${data.schools.length.toLocaleString()} of them.`}
            </p>
          </div>

          <DangerAction
            key={`clear-${targetSchoolId}`}
            phrase={CONFIRM_PHRASES.resetOperational}
            label="Clear data"
            title={
              targetSchool
                ? `Clear ${targetSchool.name}'s operational data`
                : "Clear operational data"
            }
            description={`Deletes every learner, enrolment, attendance record, reading level, term grade, report, ticket and notification${targetSchool ? " belonging to this school" : ""}. Keeps schools, school years, grade levels, sections and all accounts.`}
            icon={<Trash2 className="h-4 w-4" aria-hidden />}
            noBackup={!data.storeReady}
            onRun={async (confirm, ackNoBackup) => {
              const fd = new FormData();
              fd.set("confirm", confirm);
              if (targetSchoolId) fd.set("schoolId", targetSchoolId);
              if (ackNoBackup) fd.set("ackNoBackup", CONFIRM_PHRASES.noBackupAck);
              await settle(
                () => resetOperationalData(fd),
                (payload) => {
                  const d = payload as { removed?: Record<string, number> } | undefined;
                  const n = Object.values(d?.removed ?? {}).reduce((a, b) => a + b, 0);
                  return `Cleared ${n.toLocaleString()} rows`;
                }
              );
            }}
          />

          <DangerAction
            key={`accounts-${targetSchoolId}`}
            phrase={CONFIRM_PHRASES.resetSchoolAccounts}
            label="Reset accounts"
            title={
              targetSchool
                ? `Reset ${targetSchool.name}'s ${scopedAccounts.schoolHeads} school account${scopedAccounts.schoolHeads === 1 ? "" : "s"} to default`
                : `Reset all ${scopedAccounts.schoolHeads} school accounts to default`
            }
            description="Sets every School Head's password back to their own School ID. Any password they chose themselves stops working immediately."
            icon={<RotateCcw className="h-4 w-4" aria-hidden />}
            noBackup={!data.storeReady}
            onRun={async (confirm, ackNoBackup) => {
              const fd = new FormData();
              fd.set("confirm", confirm);
              if (targetSchoolId) fd.set("schoolId", targetSchoolId);
              if (ackNoBackup) fd.set("ackNoBackup", CONFIRM_PHRASES.noBackupAck);
              await settle(
                () => resetAllSchoolAccounts(fd),
                (payload) => {
                  const d = payload as { processed?: number; failed?: number } | undefined;
                  return `${d?.processed ?? 0} accounts reset${d?.failed ? `, ${d.failed} failed` : ""}`;
                }
              );
            }}
          />

          <DangerAction
            key={`teachers-${targetSchoolId}`}
            phrase={CONFIRM_PHRASES.removeTeachers}
            label="Remove teachers"
            title={
              targetSchool
                ? `Remove ${targetSchool.name}'s ${scopedAccounts.teachers} teacher account${scopedAccounts.teachers === 1 ? "" : "s"}`
                : `Remove all ${scopedAccounts.teachers} teacher accounts`
            }
            description="Deletes every teacher's login and hides them from the app. The records they entered stay attached to their name so history still reads, and their email is freed so they can register again."
            icon={<Trash2 className="h-4 w-4" aria-hidden />}
            noBackup={!data.storeReady}
            onRun={async (confirm, ackNoBackup) => {
              const fd = new FormData();
              fd.set("confirm", confirm);
              if (targetSchoolId) fd.set("schoolId", targetSchoolId);
              if (ackNoBackup) fd.set("ackNoBackup", CONFIRM_PHRASES.noBackupAck);
              await settle(
                () => removeAllTeachers(fd),
                (payload) => {
                  const d = payload as { processed?: number; failed?: number } | undefined;
                  return `${d?.processed ?? 0} teacher accounts removed${d?.failed ? `, ${d.failed} failed` : ""}`;
                }
              );
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
