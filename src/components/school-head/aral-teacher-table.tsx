"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { LearnerPagination } from "@/components/learners/learner-pagination";
import { setLearnerAralTeacher } from "@/lib/actions/learner";

export type AralTeacherOption = {
  id: string;
  fullName: string;
  /** Advisory section label, or null for an ARAL-only teacher. */
  advisoryLabel: string | null;
};

export type AralLearnerRow = {
  id: string;
  fullName: string;
  gradeLabel: string;
  sectionName: string | null;
  /** Advisory teacher (roster owner) — distinct from the ARAL teacher. */
  adviserName: string | null;
  aralTeacherId: string | null;
};

export type AralListPagination = {
  page: number;
  totalPages: number;
  totalCount: number;
  q: string;
  basePath: string;
  searchParams: Record<string, string | undefined>;
};

/**
 * ARAL teacher designation — the second, independent axis.
 *
 * Advisory (grade + section) and ARAL are separate assignments: any active
 * teacher may be designated here, whether or not they advise a section, and a
 * learner's ARAL teacher need not be their adviser. This is also the only place
 * a School Head can hand ARAL learners over before removing a teacher, so the
 * teacher dropdown is deliberately the whole active roster, not just advisers.
 */
export function AralTeacherTable({
  rows,
  teachers,
  list,
  readOnly = false,
}: {
  rows: AralLearnerRow[];
  teachers: AralTeacherOption[];
  list: AralListPagination;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [searchValue, setSearchValue] = useState(list.q);
  /** Row-local overrides so a select reflects the change before the refresh lands. */
  const [overrides, setOverrides] = useState<Record<string, string | null>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    setSearchValue(list.q);
  }, [list.q]);

  // Server data is the source of truth once it arrives; drop stale overrides.
  useEffect(() => {
    setOverrides({});
  }, [rows]);

  const teacherLabel = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of teachers) {
      map.set(
        t.id,
        t.advisoryLabel ? `${t.fullName} (${t.advisoryLabel})` : `${t.fullName} (ARAL-only)`
      );
    }
    return map;
  }, [teachers]);

  const pushListQuery = (next: { page?: number; q?: string }) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(list.searchParams)) {
      if (v !== undefined && v !== "" && k !== "page" && k !== "q") params.set(k, v);
    }
    const q = next.q !== undefined ? next.q : list.q;
    const page = next.page !== undefined ? next.page : list.page;
    if (q) params.set("q", q);
    if (page > 1) params.set("page", String(page));
    const qs = params.toString();
    router.push(qs ? `${list.basePath}?${qs}` : list.basePath);
  };

  const onChangeTeacher = (row: AralLearnerRow, nextId: string | null) => {
    const previous = overrides[row.id] ?? row.aralTeacherId;
    if (previous === nextId) return;

    setOverrides((prev) => ({ ...prev, [row.id]: nextId }));
    setSavingId(row.id);

    const fd = new FormData();
    fd.set("learnerId", row.id);
    // Empty string clears the designation — the action maps "" to null.
    fd.set("aralTeacherId", nextId ?? "");

    startTransition(async () => {
      const res = await setLearnerAralTeacher(fd);
      setSavingId(null);
      if (!res.ok) {
        // Roll the select back so it never shows an assignment that did not stick.
        setOverrides((prev) => ({ ...prev, [row.id]: previous }));
        toast.error(res.error);
        return;
      }
      toast.success(
        nextId
          ? `${row.fullName} assigned to ${teacherLabel.get(nextId) ?? "teacher"}`
          : `ARAL teacher cleared for ${row.fullName}`
      );
      router.refresh();
    });
  };

  const colSpan = 5;

  return (
    <Card>
      <CardContent className="p-0">
        <div className="border-b px-4 py-3 text-sm font-medium">
          ARAL learners ({list.totalCount})
        </div>

        <div className="flex flex-wrap items-end gap-2 border-b px-4 py-3">
          <div className="min-w-[12rem] flex-1 space-y-1">
            <Label htmlFor="aral-search" className="text-xs text-muted-foreground">
              Search ARAL learners
            </Label>
            <Input
              id="aral-search"
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  pushListQuery({ page: 1, q: searchValue.trim() });
                }
              }}
              placeholder="Learner name…"
              className="max-w-sm"
            />
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => pushListQuery({ page: 1, q: searchValue.trim() })}
          >
            Search
          </Button>
          {list.q ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setSearchValue("");
                pushListQuery({ page: 1, q: "" });
              }}
            >
              Clear
            </Button>
          ) : null}
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Learner</TableHead>
              <TableHead>Grade</TableHead>
              <TableHead>Section</TableHead>
              <TableHead>Adviser</TableHead>
              <TableHead className="min-w-[16rem]">ARAL teacher</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={colSpan}
                  className="py-6 text-center text-muted-foreground"
                >
                  {list.q
                    ? "No ARAL learners match your search."
                    : "No ARAL learners yet. Teachers enrol learners into ARAL from their grade view."}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => {
                const value = row.id in overrides ? overrides[row.id] : row.aralTeacherId;
                const selectId = `aral-teacher-${row.id}`;
                return (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.fullName}</TableCell>
                    <TableCell className="text-sm">{row.gradeLabel}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {row.sectionName ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {row.adviserName ?? "—"}
                    </TableCell>
                    <TableCell>
                      {readOnly ? (
                        value ? (
                          <Badge
                            variant="outline"
                            className="border-violet-300 text-violet-800"
                          >
                            {teacherLabel.get(value) ?? "Assigned"}
                          </Badge>
                        ) : (
                          <Badge variant="outline">Not designated</Badge>
                        )
                      ) : (
                        <>
                          <Label htmlFor={selectId} className="sr-only">
                            ARAL teacher for {row.fullName}
                          </Label>
                          <select
                            id={selectId}
                            className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
                            value={value ?? ""}
                            disabled={pending || teachers.length === 0}
                            onChange={(e) =>
                              onChangeTeacher(
                                row,
                                e.target.value === "" ? null : e.target.value
                              )
                            }
                          >
                            <option value="">Not designated</option>
                            {teachers.map((t) => (
                              <option key={t.id} value={t.id}>
                                {teacherLabel.get(t.id)}
                              </option>
                            ))}
                          </select>
                          {savingId === row.id ? (
                            <p className="mt-1 text-xs text-muted-foreground">Saving…</p>
                          ) : null}
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>

        <LearnerPagination
          basePath={list.basePath}
          page={list.page}
          totalPages={list.totalPages}
          searchParams={{ ...list.searchParams, q: list.q || undefined }}
        />
      </CardContent>
    </Card>
  );
}
