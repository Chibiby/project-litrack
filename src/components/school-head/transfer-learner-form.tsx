"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ConfirmAction } from "@/components/confirm-action";
import { transferLearner } from "@/lib/actions/enrollment";
import { SECTION_CLEAR } from "@/lib/validators/enrollment.schema";

type LearnerOption = {
  id: string;
  fullName: string;
  gradeLevelId: string;
  gradeLabel: string;
};

type GradeOption = { id: string; label: string };
type SectionOption = { id: string; name: string; gradeLevelId: string };
type TeacherOption = { id: string; fullName: string; gradeIds: string[] };

export function TransferLearnerForm({
  learners,
  grades,
  sections,
  teachers,
}: {
  learners: LearnerOption[];
  grades: GradeOption[];
  sections: SectionOption[];
  teachers: TeacherOption[];
}) {
  const [pending, setPending] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [learnerId, setLearnerId] = useState("");
  const [gradeId, setGradeId] = useState("");
  const [sectionId, setSectionId] = useState(SECTION_CLEAR);
  const [teacherId, setTeacherId] = useState("");

  const filteredSections = useMemo(
    () => sections.filter((s) => s.gradeLevelId === gradeId),
    [sections, gradeId]
  );
  const filteredTeachers = useMemo(
    () => teachers.filter((t) => t.gradeIds.includes(gradeId)),
    [teachers, gradeId]
  );

  const selectedLearner = learners.find((l) => l.id === learnerId);
  const selectedGrade = grades.find((g) => g.id === gradeId);
  const selectedSection =
    sectionId && sectionId !== SECTION_CLEAR
      ? sections.find((s) => s.id === sectionId)
      : undefined;
  const selectedTeacher = teachers.find((t) => t.id === teacherId);

  const summary =
    selectedLearner && selectedGrade && selectedTeacher
      ? `Transfer ${selectedLearner.fullName} (${selectedLearner.gradeLabel}) to ${selectedGrade.label}${
          selectedSection
            ? `, section ${selectedSection.name}`
            : ", no section"
        }, under ${selectedTeacher.fullName}.`
      : "Review the transfer details before continuing.";

  return (
    <>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!learnerId || !gradeId || !teacherId) {
            toast.error("Select learner, grade, and teacher");
            return;
          }
          setConfirmOpen(true);
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="learnerId">Learner</Label>
          <select
            id="learnerId"
            value={learnerId}
            onChange={(e) => setLearnerId(e.target.value)}
            required
            disabled={pending}
            className="flex h-10 w-full rounded-lg border border-input bg-card px-3 text-sm"
          >
            <option value="">Select learner</option>
            {learners.map((l) => (
              <option key={l.id} value={l.id}>
                {l.fullName} ({l.gradeLabel})
              </option>
            ))}
          </select>
        </div>
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
          </select>
        </div>
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
          <Label htmlFor="targetTeacher">Target teacher</Label>
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
                {t.fullName}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? "Transferring…" : "Transfer learner"}
        </Button>
      </form>

      <ConfirmAction
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Confirm transfer?"
        description={summary}
        confirmLabel="Transfer"
        variant="default"
        disabled={pending}
        onConfirm={async () => {
          setPending(true);
          try {
            const fd = new FormData();
            fd.set("learnerId", learnerId);
            fd.set("targetGradeLevelId", gradeId);
            fd.set("targetSectionId", sectionId || SECTION_CLEAR);
            fd.set("targetTeacherId", teacherId);
            const res = await transferLearner(fd);
            if (!res.ok) {
              toast.error(res.error);
              throw new Error(res.error);
            }
            toast.success("Learner transferred");
            setLearnerId("");
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
