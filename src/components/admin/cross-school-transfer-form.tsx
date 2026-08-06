"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { transferLearnerCrossSchool } from "@/lib/actions/enrollment";

type SchoolOption = { id: string; name: string };
type LearnerOption = {
  id: string;
  fullName: string;
  gradeLabel: string;
};
type GradeOption = { id: string; label: string };
type SectionOption = { id: string; name: string; gradeLevelId: string };
type TeacherOption = { id: string; fullName: string; gradeIds: string[] };

export function CrossSchoolTransferForm({
  schools,
  fromSchoolId,
  toSchoolId,
  learners,
  grades,
  sections,
  teachers,
}: {
  schools: SchoolOption[];
  fromSchoolId: string;
  toSchoolId: string;
  learners: LearnerOption[];
  grades: GradeOption[];
  sections: SectionOption[];
  teachers: TeacherOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [learnerQuery, setLearnerQuery] = useState("");
  const [learnerId, setLearnerId] = useState("");
  const [gradeId, setGradeId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [teacherId, setTeacherId] = useState("");

  const filteredLearners = useMemo(() => {
    const q = learnerQuery.trim().toLowerCase();
    if (!q) return learners;
    return learners.filter(
      (l) =>
        l.fullName.toLowerCase().includes(q) ||
        l.gradeLabel.toLowerCase().includes(q)
    );
  }, [learners, learnerQuery]);

  const filteredSections = useMemo(
    () => sections.filter((s) => s.gradeLevelId === gradeId),
    [sections, gradeId]
  );
  const filteredTeachers = useMemo(
    () => teachers.filter((t) => t.gradeIds.includes(gradeId)),
    [teachers, gradeId]
  );

  function updateSchools(nextFrom: string, nextTo: string) {
    const params = new URLSearchParams();
    if (nextFrom) params.set("from", nextFrom);
    if (nextTo) params.set("to", nextTo);
    const qs = params.toString();
    router.push(qs ? `/admin/transfers?${qs}` : "/admin/transfers");
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!fromSchoolId || !toSchoolId) {
          toast.error("Select source and target schools");
          return;
        }
        if (fromSchoolId === toSchoolId) {
          toast.error("Source and target schools must differ");
          return;
        }
        const fd = new FormData();
        fd.set("learnerId", learnerId);
        fd.set("targetSchoolId", toSchoolId);
        fd.set("targetGradeLevelId", gradeId);
        if (sectionId) fd.set("targetSectionId", sectionId);
        fd.set("targetTeacherId", teacherId);
        startTransition(async () => {
          const res = await transferLearnerCrossSchool(fd);
          if (!res.ok) {
            toast.error(res.error);
            return;
          }
          toast.success("Learner transferred to target school");
          setLearnerId("");
          setGradeId("");
          setSectionId("");
          setTeacherId("");
          setLearnerQuery("");
          router.refresh();
        });
      }}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="fromSchool">Source school</Label>
          <select
            id="fromSchool"
            value={fromSchoolId}
            onChange={(e) => {
              setLearnerId("");
              setLearnerQuery("");
              updateSchools(e.target.value, toSchoolId);
            }}
            required
            disabled={pending}
            className="flex h-10 w-full rounded-lg border border-input bg-card px-3 text-sm"
          >
            <option value="">Select school</option>
            {schools.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="toSchool">Target school</Label>
          <select
            id="toSchool"
            value={toSchoolId}
            onChange={(e) => {
              setGradeId("");
              setSectionId("");
              setTeacherId("");
              updateSchools(fromSchoolId, e.target.value);
            }}
            required
            disabled={pending}
            className="flex h-10 w-full rounded-lg border border-input bg-card px-3 text-sm"
          >
            <option value="">Select school</option>
            {schools
              .filter((s) => s.id !== fromSchoolId)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </select>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="learnerSearch">Search learner (source school)</Label>
        <Input
          id="learnerSearch"
          value={learnerQuery}
          onChange={(e) => setLearnerQuery(e.target.value)}
          placeholder="Filter by name or grade"
          disabled={pending || !fromSchoolId}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="learnerId">Learner</Label>
        <select
          id="learnerId"
          value={learnerId}
          onChange={(e) => setLearnerId(e.target.value)}
          required
          disabled={pending || !fromSchoolId}
          className="flex h-10 w-full rounded-lg border border-input bg-card px-3 text-sm"
        >
          <option value="">
            {!fromSchoolId
              ? "Select source school first"
              : filteredLearners.length === 0
                ? "No learners found"
                : "Select learner"}
          </option>
          {filteredLearners.map((l) => (
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
          disabled={pending || !toSchoolId}
          className="flex h-10 w-full rounded-lg border border-input bg-card px-3 text-sm"
        >
          <option value="">
            {!toSchoolId ? "Select target school first" : "Select grade"}
          </option>
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
        {pending ? "Transferring…" : "Transfer across schools"}
      </Button>
    </form>
  );
}
