"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  GENDER_LABELS,
  READING_PROFILE_LABELS,
} from "@/lib/constants/enum-labels";
import { AralToggleButton } from "@/components/aral-toggle-button";
import { LearnerArchiveButton } from "@/components/learners/learner-archive-button";
import { LearnerListToolbar } from "@/components/learners/learner-list-toolbar";
import { LearnerPagination } from "@/components/learners/learner-pagination";
import { EmptyState } from "@/components/dashboard";
import {
  LEARNER_PAGE_SIZE,
  totalPages as calcTotalPages,
  type LearnerListFilter,
  type LearnerListSort,
} from "@/lib/learners/pagination";
import { Eye, Pencil } from "lucide-react";

/** Debounce pause before applying typed search (ms). */
export const SEARCH_DEBOUNCE_MS = 500;

export type LearnerListRow = {
  id: string;
  fullName: string;
  age: number;
  gender: keyof typeof GENDER_LABELS;
  isAralLearner: boolean;
  archivedAt: string | null;
  englishReadingProfile: keyof typeof READING_PROFILE_LABELS;
  filipinoReadingProfile: keyof typeof READING_PROFILE_LABELS;
  section: { id: string; name: string } | null;
};

type Props = {
  gradeId: string;
  filter: LearnerListFilter;
  sort: LearnerListSort;
  schoolId?: string;
  isSuperAdmin: boolean;
  learners: LearnerListRow[];
};

export function LearnerListClient({
  gradeId,
  filter,
  sort,
  schoolId,
  isSuperAdmin,
  learners,
}: Props) {
  const [inputValue, setInputValue] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [page, setPage] = useState(1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearDebounce = () => {
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  };

  useEffect(() => () => clearDebounce(), []);

  const applySearch = (raw: string) => {
    clearDebounce();
    const next = raw.trim();
    setAppliedQuery(next);
    setPage(1);
  };

  const handleSearchChange = (value: string) => {
    setInputValue(value);
    clearDebounce();
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      applySearch(value);
    }, SEARCH_DEBOUNCE_MS);
  };

  const handleSearchSubmit = () => {
    applySearch(inputValue);
  };

  const filtered = useMemo(() => {
    if (!appliedQuery) return learners;
    const q = appliedQuery.toLowerCase();
    return learners.filter((l) => l.fullName.toLowerCase().includes(q));
  }, [learners, appliedQuery]);

  const pages = calcTotalPages(filtered.length, LEARNER_PAGE_SIZE);

  useEffect(() => {
    setPage((p) => (p > pages ? pages : p));
  }, [pages]);

  const pageRows = useMemo(() => {
    const start = (page - 1) * LEARNER_PAGE_SIZE;
    return filtered.slice(start, start + LEARNER_PAGE_SIZE);
  }, [filtered, page]);

  const showSection = learners.some((l) => l.section);

  return (
    <Card>
      <LearnerListToolbar
        gradeId={gradeId}
        filter={filter}
        sort={sort}
        schoolId={schoolId}
        searchValue={inputValue}
        onSearchChange={handleSearchChange}
        onSearchSubmit={handleSearchSubmit}
      />
      <CardContent className="p-0">
        {learners.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title={
                filter === "archived" ? "No archived learners" : "No learners yet"
              }
              description={
                filter === "archived"
                  ? "Archived learners will appear here."
                  : "Add a learner using the form on the right."
              }
            />
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="No matching learners"
              description="Try a different name search."
            />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Age</TableHead>
                <TableHead>Gender</TableHead>
                {showSection && <TableHead>Section</TableHead>}
                <TableHead>English</TableHead>
                <TableHead>Filipino</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageRows.map((l) => (
                <TableRow
                  key={l.id}
                  className={l.archivedAt ? "opacity-70" : undefined}
                >
                  <TableCell className="font-medium">
                    <span className="flex flex-wrap items-center gap-1.5">
                      {l.fullName}
                      {l.isAralLearner && <Badge variant="violet">ARAL</Badge>}
                      {l.archivedAt && (
                        <Badge variant="outline">Archived</Badge>
                      )}
                    </span>
                  </TableCell>
                  <TableCell>{l.age}</TableCell>
                  <TableCell>{GENDER_LABELS[l.gender]}</TableCell>
                  {showSection && (
                    <TableCell className="text-sm text-muted-foreground">
                      {l.section?.name ?? "—"}
                    </TableCell>
                  )}
                  <TableCell className="text-xs">
                    {READING_PROFILE_LABELS[l.englishReadingProfile]}
                  </TableCell>
                  <TableCell className="text-xs">
                    {READING_PROFILE_LABELS[l.filipinoReadingProfile]}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex flex-wrap items-center justify-end gap-1">
                      <Button asChild size="sm" variant="ghost">
                        <Link
                          href={`/teacher/grade/${gradeId}/learners/${l.id}`}
                        >
                          <Eye className="h-4 w-4" />
                          View
                        </Link>
                      </Button>
                      {!l.archivedAt && (
                        <>
                          <Button asChild size="sm" variant="ghost">
                            <Link
                              href={`/teacher/grade/${gradeId}/learners/${l.id}/edit`}
                            >
                              <Pencil className="h-4 w-4" />
                              Edit
                            </Link>
                          </Button>
                          {!isSuperAdmin && (
                            <AralToggleButton
                              learnerId={l.id}
                              isAral={l.isAralLearner}
                            />
                          )}
                        </>
                      )}
                      {!isSuperAdmin && (
                        <LearnerArchiveButton
                          learnerId={l.id}
                          archived={Boolean(l.archivedAt)}
                        />
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <LearnerPagination
          mode="client"
          page={page}
          totalPages={pages}
          onPageChange={setPage}
        />
      </CardContent>
    </Card>
  );
}
