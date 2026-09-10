"use client";

import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmAction } from "@/components/confirm-action";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import { CreateGradeLevelButton } from "@/components/school-head/create-grade-level-button";
import { GradeSectionsPanel } from "@/components/school-head/section-forms";
import {
  archiveGradeLevel,
  createGradeLevel,
  restoreGradeLevel,
} from "@/lib/actions/school-head";
import {
  runOptimistic,
  settleActionResult,
  tempOptimisticId,
} from "@/lib/ui/optimistic";
import { RotateCcw } from "lucide-react";

export type GradeLevelCard = {
  id: string;
  type: string;
  teacherCount: number;
  learnerCount: number;
  sections: { id: string; name: string }[];
  /** True while waiting for server revalidation after create. */
  pendingCreate?: boolean;
};

/** A grade that exists but is switched off. Its sections are archived with it. */
export type ArchivedGradeCard = {
  id: string;
  type: string;
  /** True while waiting for server revalidation after archive or restore. */
  pending?: boolean;
};

type OptimisticState = {
  active: GradeLevelCard[];
  archived: ArchivedGradeCard[];
  inactiveTypes: string[];
};

const TYPE_ORDER = [
  "KINDER", "G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8", "G9", "G10", "G11", "G12", "FLOATING",
] as const;

const byGradeOrder = <T extends { type: string }>(a: T, b: T) =>
  TYPE_ORDER.indexOf(a.type as (typeof TYPE_ORDER)[number]) -
  TYPE_ORDER.indexOf(b.type as (typeof TYPE_ORDER)[number]);

type Op =
  | { type: "activate"; gradeType: string; tempId: string }
  | { type: "archive"; gradeId: string }
  | { type: "restore"; gradeId: string }
  | { type: "noop" };

function gradeLevelsReducer(state: OptimisticState, op: Op): OptimisticState {
  if (op.type === "activate") {
    if (state.active.some((g) => g.type === op.gradeType)) return state;
    if (!state.inactiveTypes.includes(op.gradeType)) return state;
    return {
      ...state,
      active: [
        ...state.active,
        {
          id: op.tempId,
          type: op.gradeType,
          teacherCount: 0,
          learnerCount: 0,
          sections: [],
          pendingCreate: true,
        },
      ].sort(byGradeOrder),
      inactiveTypes: state.inactiveTypes.filter((t) => t !== op.gradeType),
    };
  }

  if (op.type === "archive") {
    const grade = state.active.find((g) => g.id === op.gradeId);
    if (!grade) return state;
    return {
      ...state,
      active: state.active.filter((g) => g.id !== op.gradeId),
      archived: [...state.archived, { id: grade.id, type: grade.type, pending: true }]
        .sort(byGradeOrder),
    };
  }

  if (op.type === "restore") {
    const grade = state.archived.find((g) => g.id === op.gradeId);
    if (!grade) return state;
    return {
      ...state,
      archived: state.archived.filter((g) => g.id !== op.gradeId),
      // Counts and sections are unknown until the server answers — the card
      // renders as pending rather than claiming zero of each.
      active: [
        ...state.active,
        {
          id: grade.id,
          type: grade.type,
          teacherCount: 0,
          learnerCount: 0,
          sections: [],
          pendingCreate: true,
        },
      ].sort(byGradeOrder),
    };
  }

  return state;
}

export function GradeLevelsClient({
  active,
  archived = [],
  inactiveTypes,
  readOnly = false,
}: {
  active: GradeLevelCard[];
  archived?: ArchivedGradeCard[];
  inactiveTypes: string[];
  readOnly?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [optimistic, dispatchOptimistic] = useOptimistic(
    { active, archived, inactiveTypes } satisfies OptimisticState,
    gradeLevelsReducer
  );

  const create = (gradeType: string, label: string) =>
    runOptimistic(startTransition, async () => {
      dispatchOptimistic({
        type: "activate",
        gradeType,
        tempId: tempOptimisticId("grade"),
      });
      const fd = new FormData();
      fd.set("type", gradeType);
      try {
        await createGradeLevel(fd);
        toast.success(`${label} created`);
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Could not create grade level"
        );
        throw err instanceof Error ? err : new Error("Could not create grade level");
      }
    });

  /**
   * The optimistic move happens before the server answers, so a refusal — a
   * grade that still holds learners — snaps the card back where it was and
   * shows the count. That is the intended shape: the server owns the rule, and
   * the interface does not try to predict it by hiding the button.
   */
  const archive = (gradeId: string, label: string) =>
    runOptimistic(startTransition, async () => {
      dispatchOptimistic({ type: "archive", gradeId });
      const fd = new FormData();
      fd.set("gradeLevelId", gradeId);
      await settleActionResult(await archiveGradeLevel(fd), `${label} deactivated`);
    });

  const restore = (gradeId: string, label: string) =>
    runOptimistic(startTransition, async () => {
      dispatchOptimistic({ type: "restore", gradeId });
      const fd = new FormData();
      fd.set("gradeLevelId", gradeId);
      await settleActionResult(await restoreGradeLevel(fd), `${label} restored`);
    });

  return (
    <div className="space-y-8">
      {optimistic.active.length > 0 ? (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground">Active grades</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {optimistic.active.map((grade) => {
              const sectionCount = grade.sections.length;
              const label = GRADE_LEVEL_LABELS[grade.type] ?? grade.type;
              return (
                <Card key={grade.type} className="border-primary/50">
                  <CardContent className="space-y-3 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{label}</span>
                      <Badge variant="secondary">
                        {grade.pendingCreate ? "Activating…" : "Active"}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {grade.teacherCount} teachers · {grade.learnerCount} learners ·{" "}
                      {sectionCount} {sectionCount === 1 ? "section" : "sections"}
                    </p>
                    {!grade.pendingCreate ? (
                      <GradeSectionsPanel
                        gradeLevelId={grade.id}
                        sections={grade.sections}
                        readOnly={readOnly}
                      />
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Sections will be available after sync.
                      </p>
                    )}
                    {!readOnly && !grade.pendingCreate ? (
                      <ConfirmAction
                        title={`Deactivate ${label}?`}
                        description={`${label} and its sections will be hidden from teachers. Restore brings them back together. A grade that still holds learners cannot be deactivated.`}
                        confirmLabel="Deactivate"
                        variant="destructive"
                        disabled={pending}
                        trigger={
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="text-destructive"
                            disabled={pending}
                          >
                            Deactivate
                          </Button>
                        }
                        onConfirm={() => archive(grade.id, label)}
                      />
                    ) : null}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      ) : null}

      {optimistic.archived.length > 0 ? (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground">
            Deactivated grades
          </h2>
          <p className="text-xs text-muted-foreground">
            Hidden from teachers. Restoring one brings back the sections that were
            deactivated with it.
          </p>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-5">
            {optimistic.archived.map((grade) => {
              const label = GRADE_LEVEL_LABELS[grade.type] ?? grade.type;
              return (
                <Card key={grade.type} className="border-dashed">
                  <CardContent className="space-y-3 p-4">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-muted-foreground">
                        {label}
                      </span>
                    </div>
                    {readOnly ? (
                      <p className="text-xs text-muted-foreground">Deactivated</p>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="w-full"
                        loading={pending && grade.pending}
                        loadingText="Restoring…"
                        disabled={pending}
                        onClick={() => {
                          void restore(grade.id, label).catch(() => {
                            /* toast already shown */
                          });
                        }}
                      >
                        <RotateCcw className="h-4 w-4" />
                        Restore
                      </Button>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      ) : null}

      {optimistic.inactiveTypes.length > 0 ? (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground">
            {readOnly ? "Not created" : "Create a grade"}
          </h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-5">
            {optimistic.inactiveTypes.map((type) => (
              <Card key={type}>
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">
                      {GRADE_LEVEL_LABELS[type] ?? type}
                    </span>
                  </div>
                  {readOnly ? (
                    <p className="text-xs text-muted-foreground">Not created</p>
                  ) : (
                    <CreateGradeLevelButton
                      type={type}
                      label={GRADE_LEVEL_LABELS[type] ?? type}
                      pending={pending}
                      onCreate={() => create(type, GRADE_LEVEL_LABELS[type] ?? type)}
                    />
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
