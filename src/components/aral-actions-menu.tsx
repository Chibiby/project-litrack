"use client";

import Link from "next/link";
import { Edit3, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function AralActionsMenu({
  gradeId,
  learnerId,
  learnerName,
}: {
  gradeId: string;
  learnerId: string;
  learnerName: string;
}) {
  const updateHref = `/teacher/aral/${gradeId}/learners/${learnerId}/update`;
  const attendanceHref = `/teacher/aral/${gradeId}/learners/${learnerId}/attendance`;
  const readingHref = `/teacher/aral/${gradeId}/learners/${learnerId}/reading-level`;

  return (
    <>
      {/* Desktop: wrap row of actions */}
      <div className="hidden flex-wrap justify-end gap-2 sm:flex">
        <Button asChild size="sm">
          <Link href={updateHref}>
            <Edit3 className="h-4 w-4" aria-hidden="true" /> Update Data
          </Link>
        </Button>
        <Button asChild size="sm" variant="outline">
          <Link href={attendanceHref}>Attendance</Link>
        </Button>
        <Button asChild size="sm" variant="outline">
          <Link href={readingHref}>Reading Level</Link>
        </Button>
      </div>

      {/* Mobile: overflow menu */}
      <div className="sm:hidden">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              aria-label={`Actions for ${learnerName}`}
            >
              <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link href={updateHref}>Update Data</Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href={attendanceHref}>Attendance</Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href={readingHref}>Reading Level</Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </>
  );
}
