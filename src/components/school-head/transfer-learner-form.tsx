"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { transferLearner } from "@/lib/actions/enrollment";

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
  const [pending, startTransition] = useTransition();
  const [learnerId, setLearnerId] = useState("");
  const [gradeId, setGradeId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [teacherId, setTeacherId] = useState("");

  const filteredSections = useMemo(
    () => sections.filter((s) => s.gradeLevelId === gradeId),
    [sections, gradeId]
  );
  const filteredTeachers = useMemo(
    () => teachers.filter((t) => t.gradeIds.includes(gradeId)),
    [teachers, gradeId]
  );

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData();
        fd.set("learnerId", learnerId);
        fd.set("targetGradeLevelId", gradeId);
        if (sectionId) fd.set("targetSectionId", sectionId);
        fd.set("targetTeacherId", teacherId);
        startTransition(async () => {
          const res = await transferLearner(fd);
          if (!res.ok) toast.error(res.error);
          else {
            toast.success("Learner transferred");
            setLearnerId("");
            setGradeId("");
            setSectionId("");
            setTeacherId("");
          }
        });
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
            setSectionId("");
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
        <Label htmlFor="targetSection">Target section (optional)</Label>
        <select
          id="targetSection"
          value={sectionId}
          onChange={(e) => setSectionId(e.target.value)}
          disabled={pending || !gradeId}
          className="flex h-10 w-full rounded-lg border border-input bg-card px-3 text-sm"
        >
          <option value="">No section</option>
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
  );
}
