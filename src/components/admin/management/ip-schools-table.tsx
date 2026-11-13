"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  CellText,
} from "@/components/ui/table";
import { ResponsiveTable, StackedList, StackedRow } from "@/components/ui/responsive-table";
import type { IpSchoolRow } from "@/lib/ip/overview";

const FIRST = 10;
const n = (value: number) => value.toLocaleString();

/**
 * Schools with IP learners, most first. Shows the first ten; "Show all"
 * opens the rest in place (the full list is already loaded: one row per
 * school, a few hundred at most).
 */
export function IpSchoolsTable({ rows }: { rows: IpSchoolRow[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, FIRST);

  return (
    <>
      <ResponsiveTable
        table={
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">School</TableHead>
                <TableHead>District</TableHead>
                <TableHead numeric>IP</TableHead>
                <TableHead numeric>Enrolled</TableHead>
                <TableHead numeric className="pr-4">IP %</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((s) => (
                <TableRow key={s.schoolId}>
                  <TableCell className="max-w-72 pl-4 font-medium">
                    <CellText>{s.name}</CellText>
                  </TableCell>
                  <TableCell className="max-w-40 text-muted-foreground">
                    <CellText>{s.district}</CellText>
                  </TableCell>
                  <TableCell numeric>{n(s.ipLearners)}</TableCell>
                  <TableCell numeric>{n(s.enrolled)}</TableCell>
                  <TableCell numeric className="pr-4">{s.ipPercent}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        }
        stacked={
          <StackedList aria-label="Schools with IP learners">
            {shown.map((s) => (
              <StackedRow
                key={s.schoolId}
                title={s.name}
                value={
                  <>
                    {n(s.ipLearners)}
                    <span className="ml-1 text-xs font-normal text-muted-foreground">IP</span>
                  </>
                }
                meta={
                  <span className="tabular-nums">
                    {s.ipPercent} of {n(s.enrolled)} · {s.district}
                  </span>
                }
              />
            ))}
          </StackedList>
        }
      />
      {rows.length > FIRST ? (
        <div className="flex items-center justify-between gap-3 border-t border-border/60 px-4 py-3 text-sm text-muted-foreground">
          <span className="tabular-nums">
            {all ? `All ${n(rows.length)} schools` : `${FIRST} of ${n(rows.length)} schools`}
          </span>
          <Button type="button" variant="outline" size="sm" onClick={() => setAll((v) => !v)}>
            {all ? "Show fewer" : `Show all ${n(rows.length)}`}
          </Button>
        </div>
      ) : null}
    </>
  );
}
