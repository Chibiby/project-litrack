"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { getAccountProfile, type AccountProfile } from "@/lib/actions/accounts";
import {
  ADVISORY_MODE_LABELS,
  EMPLOYMENT_TYPE_LABELS,
  USER_ROLE_LABELS,
} from "@/lib/constants/enum-labels";
import type { AccountRow } from "@/lib/admin/accounts";

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatSubmission(iso: string | null): string {
  return iso ? formatDateTime(iso) : "Never";
}

function approvalLabel(status: AccountProfile["approvalStatus"]): string | null {
  if (status === "PENDING") return "Pending";
  if (status === "REJECTED") return "Declined";
  if (status === "APPROVED") return "Approved";
  return null;
}

/**
 * Four sections per spec section 8: identity and account state; advisory
 * sections and their learners; ARAL involvement; recent activity. `advisory`
 * and `aral` render only when the profile carries them (TEACHER only) — no
 * empty shells for a School Head or Super Admin.
 *
 * Fetched on open, never with the list: shipping every row's profile so one
 * might be opened would undo the 2-call bound on the page itself.
 */
export function AccountProfileDialog({
  row,
  open,
  onOpenChange,
}: {
  row: AccountRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    setProfile(null);
    setLoading(true);
    getAccountProfile(row.id)
      .then((res) => {
        if (cancelled) return;
        setLoading(false);
        if (!res.ok) {
          setError(res.error);
          return;
        }
        setProfile(res.data);
      })
      .catch(() => {
        if (cancelled) return;
        setLoading(false);
        setError("Couldn't load this profile. Try again.");
      });
    return () => {
      cancelled = true;
    };
  }, [open, row.id]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{row.fullName}</DialogTitle>
          <DialogDescription>{USER_ROLE_LABELS[row.role]}</DialogDescription>
        </DialogHeader>

        {loading && !profile ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
          </div>
        ) : error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : profile ? (
          <div className="space-y-5 text-sm">
            <section className="space-y-2">
              <h3 className="font-semibold text-foreground">Identity and account state</h3>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-muted-foreground">
                <dt>Status</dt>
                <dd>{profile.isActive ? "Active" : "Inactive"}</dd>
                {approvalLabel(profile.approvalStatus) ? (
                  <>
                    <dt>Approval</dt>
                    <dd>{approvalLabel(profile.approvalStatus)}</dd>
                  </>
                ) : null}
                <dt>Must change password</dt>
                <dd>{profile.mustChangePassword ? "Yes" : "No"}</dd>
                <dt>Profile completed</dt>
                <dd>{profile.profileCompleted ? "Yes" : "No"}</dd>
                <dt>School</dt>
                <dd>
                  {profile.school
                    ? `${profile.school.name} (${profile.school.schoolIdCode})`
                    : "—"}
                </dd>
                <dt>Sign-in</dt>
                <dd className="flex flex-wrap items-center gap-1.5">
                  <span className="break-all">{profile.signIn.value}</span>
                  {profile.signIn.kind === "email" && profile.signIn.synthetic ? (
                    <Badge variant="outline">No mailbox</Badge>
                  ) : null}
                </dd>
                <dt>Created</dt>
                <dd>{formatDateTime(profile.createdAt)}</dd>
                <dt>Last sign-in</dt>
                <dd>
                  {profile.lastSignInAt ? formatDateTime(profile.lastSignInAt) : "No recorded sign-in"}
                </dd>
                <dt>Last failed sign-in</dt>
                <dd>{formatDateTime(profile.lastSignInDeniedAt)}</dd>
                <dt>Last release seen</dt>
                <dd>{profile.lastSeenReleaseVersion ?? "Never"}</dd>
              </dl>
            </section>

            <Separator />
            <section className="space-y-2">
              <h3 className="font-semibold text-foreground">Submissions</h3>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-muted-foreground">
                <dt>Last attendance save</dt>
                <dd>{formatSubmission(profile.submissions.lastAttendanceWeekSaveAt)}</dd>
                <dt>Last reading level entry</dt>
                <dd>{formatSubmission(profile.submissions.lastReadingLevelRecordAt)}</dd>
                <dt>Last term grades save</dt>
                <dd>{formatSubmission(profile.submissions.lastTermGradesSaveAt)}</dd>
              </dl>
            </section>

            {profile.advisory ? (
              <>
                <Separator />
                <section className="space-y-2">
                  <h3 className="flex items-center gap-2 font-semibold text-foreground">
                    Advisory sections
                    <Badge variant="secondary">{profile.advisory.learnerCount} learners</Badge>
                  </h3>
                  {profile.advisory.sections.length === 0 ? (
                    <p className="text-muted-foreground">No advisory section.</p>
                  ) : (
                    <ul className="space-y-1 text-muted-foreground">
                      {profile.advisory.sections.map((section) => (
                        <li key={section.id} className="flex items-center justify-between gap-3">
                          <span>
                            {section.name} · {section.gradeLabel}
                          </span>
                          <span className="shrink-0">{section.learnerCount} learners</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </>
            ) : null}

            {profile.aral ? (
              <>
                <Separator />
                <section className="space-y-2">
                  <h3 className="flex items-center gap-2 font-semibold text-foreground">
                    ARAL involvement
                    {profile.aral.isAralVolunteer ? (
                      <Badge variant="violet">ARAL volunteer</Badge>
                    ) : null}
                  </h3>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-muted-foreground">
                    <dt>Designation</dt>
                    <dd>{profile.aral.designation ?? "—"}</dd>
                    <dt>Employment type</dt>
                    <dd>
                      {profile.aral.employmentType
                        ? EMPLOYMENT_TYPE_LABELS[profile.aral.employmentType]
                        : "—"}
                    </dd>
                    <dt>Advisory mode</dt>
                    <dd>
                      {profile.aral.advisoryMode
                        ? ADVISORY_MODE_LABELS[profile.aral.advisoryMode]
                        : "—"}
                    </dd>
                    <dt>ARAL learners</dt>
                    <dd>{profile.aral.learnerCount}</dd>
                  </dl>
                </section>
              </>
            ) : null}

            <Separator />
            <section className="space-y-2">
              <h3 className="font-semibold text-foreground">Recent activity</h3>
              {profile.recentActivity.length === 0 ? (
                <p className="text-muted-foreground">No recorded activity.</p>
              ) : (
                <ul className="max-h-48 space-y-1 overflow-y-auto text-muted-foreground">
                  {profile.recentActivity.map((entry) => (
                    <li key={entry.id} className="flex items-center justify-between gap-3">
                      <span>
                        {entry.action} · {entry.resource}
                      </span>
                      <span className="shrink-0">{formatDateTime(entry.timestamp)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
