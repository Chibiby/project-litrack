"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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

export type ConsoleData = {
  storeReady: boolean;
  storeMessage: string;
  backups: BackupRow[];
  safety: BackupRow | null;
  counts: Record<string, number>;
  totalRows: number;
  accounts: { schoolHeads: number; teachers: number };
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
 */
function DangerAction({
  phrase,
  label,
  title,
  description,
  icon,
  disabled,
  onRun,
}: {
  phrase: string;
  label: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  disabled?: boolean;
  onRun: (confirm: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [pending, startTransition] = useTransition();
  const matches = typed.trim() === phrase;

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
            disabled={disabled}
            className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => setOpen(true)}
          >
            {label}
          </Button>
        ) : null}
      </div>

      {open ? (
        <div className="mt-3 space-y-2 border-t border-destructive/20 pt-3">
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
              disabled={!matches}
              loading={pending}
              loadingText="Running…"
              onClick={() => {
                startTransition(async () => {
                  await onRun(typed.trim());
                  setTyped("");
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
                Until then nothing on this page will run — every destructive action needs somewhere
                to put the backup that makes it reversible.
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
              Each of these affects every school at once. All three save a safety point first, so
              “Undo last operation” above can put things back.
            </p>
          </div>

          <DangerAction
            phrase={CONFIRM_PHRASES.resetOperational}
            label="Clear data"
            title="Clear operational data"
            description="Deletes every learner, enrolment, attendance record, reading level, term grade, report, ticket and notification. Keeps schools, school years, grade levels, sections and all accounts."
            icon={<Trash2 className="h-4 w-4" aria-hidden />}
            disabled={disabled}
            onRun={async (confirm) => {
              const fd = new FormData();
              fd.set("confirm", confirm);
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
            phrase={CONFIRM_PHRASES.resetSchoolAccounts}
            label="Reset accounts"
            title={`Reset all ${data.accounts.schoolHeads} school accounts to default`}
            description="Sets every School Head's password back to their own School ID. Any password they chose themselves stops working immediately."
            icon={<RotateCcw className="h-4 w-4" aria-hidden />}
            disabled={disabled}
            onRun={async (confirm) => {
              const fd = new FormData();
              fd.set("confirm", confirm);
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
            phrase={CONFIRM_PHRASES.removeTeachers}
            label="Remove teachers"
            title={`Remove all ${data.accounts.teachers} teacher accounts`}
            description="Deletes every teacher's login and hides them from the app. The records they entered stay attached to their name so history still reads, and their email is freed so they can register again."
            icon={<Trash2 className="h-4 w-4" aria-hidden />}
            disabled={disabled}
            onRun={async (confirm) => {
              const fd = new FormData();
              fd.set("confirm", confirm);
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
