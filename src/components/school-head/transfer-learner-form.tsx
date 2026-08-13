"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ConfirmAction } from "@/components/confirm-action";
import { LearnerSearchSelect } from "@/components/learners/learner-search-select";
import { transferLearner } from "@/lib/actions/enrollment";
import type { LearnerSearchHit } from "@/lib/learners/search";
import { GRADE_FLOATING, SECTION_CLEAR } from "@/lib/validators/enrollment.schema";

type GradeOption = { id: string; label: string };
type SectionOption = { id: string; name: string; gradeLevelId: string };
/**
 * A teacher advises exactly one section, so grade membership is a single id (or
 * null for an ARAL-only teacher, who never appears as a transfer destination).
 */
type TeacherOption = {
  id: string;
  fullName: string;
  advisoryGradeId: string | null;
  advisorySectionName: string | null;
};

export function TransferLearnerForm({
  schoolId,
  grades,
  sections,
  teachers,
}: {
  schoolId: string;
  grades: GradeOption[];
  sections: SectionOption[];
  teachers: TeacherOption[];
}) {
  const [pending, setPending] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [learner, setLearner] = useState<LearnerSearchHit | null>(null);
  const [gradeId, setGradeId] = useState("");
  const [sectionId, setSectionId] = useState(SECTION_CLEAR);
  const [teacherId, setTeacherId] = useState("");

  // Floating = no grade and no section, so section and teacher do not apply.
  const toFloating = gradeId === GRADE_FLOATING;

  const filteredSections = useMemo(
    () => sections.filter((s) => s.gradeLevelId === gradeId),
    [sections, gradeId]
  );
  const filteredTeachers = useMemo(
    () => teachers.filter((t) => t.advisoryGradeId === gradeId),
    [teachers, gradeId]
  );

  const selectedGrade = grades.find((g) => g.id === gradeId);
  const selectedSection =
    sectionId && sectionId !== SECTION_CLEAR
      ? sections.find((s) => s.id === sectionId)
      : undefined;
  const selectedTeacher = teachers.find((t) => t.id === teacherId);

  const summary = !learner
    ? "Review the transfer details before continuing."
    : toFloating
      ? `Move ${learner.fullName} (${learner.gradeLabel}) to Floating — no grade, no section, no adviser. Their ARAL designation is kept.`
      : selectedGrade && selectedTeacher
        ? `Transfer ${learner.fullName} (${learner.gradeLabel}) to ${selectedGrade.label}${
            selectedSection ? `, section ${selectedSection.name}` : ", no section"
          }, under ${selectedTeacher.fullName}.`
        : "Review the transfer details before continuing.";

  return (
    <>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!learner) {
            toast.error("Select a learner");
            return;
          }
          if (!gradeId) {
            toast.error("Select a target grade");
            return;
          }
          if (!toFloating && !teacherId) {
            toast.error("Select a target teacher");
            return;
          }
          setConfirmOpen(true);
        }}
      >
        <LearnerSearchSelect
          schoolId={schoolId}
          value={learner}
          onChange={setLearner}
          disabled={pending}
          label="Learner"
        />
        <div className="space-y-2">
          <Label htmlFor="targetGrade">Target grade</Label>
          <select
            id="targetGrade"
            value={gradeId}
            onChange={(e) => {
              setGradeId(e.target.value);
              setSectionId(SECTION_CLEAR);
              setTeacherId("");
            }}
            required
            disabled={pending}
            className="flex h-10 w-full rounded-lg border border-input bg-card px-3 text-sm"
          >
            <option value="">Select grade</option>
            {grades.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
            <option value={GRADE_FLOATING}>Floating — no grade or section</option>
          </select>
          {toFloating ? (
            <p className="text-xs text-muted-foreground">
              Floating holds learners who are not yet placed in a grade or section.
              They keep their records and their ARAL teacher, and appear under the
              Floating filter in learner lists.
            </p>
          ) : null}
        </div>
        {!toFloating && (
          <>
            <div className="space-y-2">
              <Label htmlFor="targetSection">Section (optional)</Label>
              <select
                id="targetSection"
                value={sectionId}
                onChange={(e) => setSectionId(e.target.value)}
                disabled={pending || !gradeId}
                className="flex h-10 w-full rounded-lg border border-input bg-card px-3 text-sm"
              >
                <option value={SECTION_CLEAR}>No section</option>
                {filteredSections.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="targetTeacher">Target teacher (adviser)</Label>
              <select
                id="targetTeacher"
                value={teacherId}
                onChange={(e) => setTeacherId(e.target.value)}
                required
                disabled={pending || !gradeId}
                className="flex h-10 w-full rounded-lg border border-input bg-card px-3 text-sm"
              >
                <option value="">Select teacher</option>
                {filteredTeachers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.advisorySectionName
                      ? `${t.fullName} (${t.advisorySectionName})`
                      : t.fullName}
                  </option>
                ))}
              </select>
              {gradeId && filteredTeachers.length === 0 ? (
                <p className="text-xs text-amber-700">
                  No teacher advises a section in this grade yet. Assign an advisory
                  section on the Teachers page first.
                </p>
              ) : null}
            </div>
          </>
        )}
        <Button type="submit" disabled={pending}>
          {pending ? "Transferring…" : toFloating ? "Move to Floating" : "Transfer learner"}
        </Button>
      </form>

      <ConfirmAction
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={toFloating ? "Move to Floating?" : "Confirm transfer?"}
        description={summary}
        confirmLabel={toFloating ? "Move" : "Transfer"}
        variant="default"
        disabled={pending}
        onConfirm={async () => {
          if (!learner) return;
          setPending(true);
          try {
            const fd = new FormData();
            fd.set("learnerId", learner.id);
            fd.set("targetGradeLevelId", gradeId);
            // Floating carries no section and no teacher — the action rejects them.
            fd.set("targetSectionId", toFloating ? SECTION_CLEAR : sectionId || SECTION_CLEAR);
            fd.set("targetTeacherId", toFloating ? "" : teacherId);
            const res = await transferLearner(fd);
            if (!res.ok) {
              toast.error(res.error);
              throw new Error(res.error);
            }
            toast.success(toFloating ? "Learner moved to Floating" : "Learner transferred");
            setLearner(null);
            setGradeId("");
            setSectionId(SECTION_CLEAR);
            setTeacherId("");
          } finally {
            setPending(false);
          }
        }}
      />
    </>
  );
}
