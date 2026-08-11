"use client";

import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import { CreateGradeLevelButton } from "@/components/school-head/create-grade-level-button";
import { GradeSectionsPanel } from "@/components/school-head/section-forms";
import { createGradeLevel } from "@/lib/actions/school-head";
import { runOptimistic, tempOptimisticId } from "@/lib/ui/optimistic";

export type GradeLevelCard = {
  id: string;
  type: string;
  teacherCount: number;
  learnerCount: number;
  sections: { id: string; name: string }[];
  /** True while waiting for server revalidation after create. */
  pendingCreate?: boolean;
};

type OptimisticState = {
  active: GradeLevelCard[];
  inactiveTypes: string[];
};

const TYPE_ORDER = [
  "KINDER", "G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8", "G9", "G10", "G11", "G12", "FLOATING",
] as const;

type Op =
  | { type: "activate"; gradeType: string; tempId: string }
  | { type: "noop" };

function gradeLevelsReducer(state: OptimisticState, op: Op): OptimisticState {
  if (op.type !== "activate") return state;
  if (state.active.some((g) => g.type === op.gradeType)) return state;
  if (!state.inactiveTypes.includes(op.gradeType)) return state;
  const nextActive = [
    ...state.active,
    {
      id: op.tempId,
      type: op.gradeType,
      teacherCount: 0,
      learnerCount: 0,
      sections: [],
      pendingCreate: true,
    },
  ].sort(
    (a, b) =>
      TYPE_ORDER.indexOf(a.type as (typeof TYPE_ORDER)[number]) -
      TYPE_ORDER.indexOf(b.type as (typeof TYPE_ORDER)[number])
  );
  return {
    active: nextActive,
    inactiveTypes: state.inactiveTypes.filter((t) => t !== op.gradeType),
  };
}

export function GradeLevelsClient({
  active,
  inactiveTypes,
  readOnly = false,
}: {
  active: GradeLevelCard[];
  inactiveTypes: string[];
  readOnly?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [optimistic, dispatchOptimistic] = useOptimistic(
    { active, inactiveTypes } satisfies OptimisticState,
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

  return (
    <div className="space-y-8">
      {optimistic.active.length > 0 ? (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground">Active grades</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {optimistic.active.map((grade) => {
              const sectionCount = grade.sections.length;
              return (
                <Card key={grade.type} className="border-primary/50">
                  <CardContent className="space-y-3 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">
                        {GRADE_LEVEL_LABELS[grade.type] ?? grade.type}
                      </span>
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
