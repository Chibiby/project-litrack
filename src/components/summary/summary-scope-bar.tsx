"use client";

import { Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SearchableSelect, type SearchableOption } from "@/components/ui/searchable-select";
import { useListNavigate, useListPending } from "@/components/nav/list-navigation";
import { cn } from "@/lib/utils";
import { NO_DISTRICT_LABEL } from "@/lib/summary/shape/rollup";
import type { SummaryLevel } from "@/lib/summary/types";
import { summaryHref, type FlatSearchParams } from "./summary-href";

export type ScopeBarSchool = {
  id: string;
  name: string;
  schoolIdCode: string;
  district: string | null;
};

export type SummaryScopeBarProps = {
  basePath: string;
  searchParams: FlatSearchParams;
  level: SummaryLevel;
  district: string | null;
  schoolId: string | null;
  /** Already scoped by the server: only districts this admin may see. */
  districts: readonly string[];
  schools: readonly ScopeBarSchool[];
  /** "All my districts" for a district admin, "All districts" for the division. */
  allDistrictsLabel: string;
  /**
   * SUPER_ADMIN only: the division has too many schools (300+) to list at
   * "By school" without a district first — loading them all times out. When
   * true and no district is chosen yet, the "By school" toggle is disabled
   * rather than navigating straight to the scope that times out.
   */
  requireDistrictForSchool?: boolean;
};

const LEVELS: { id: SummaryLevel; label: string }[] = [
  { id: "overall", label: "Overall" },
  { id: "district", label: "By district" },
  { id: "school", label: "By school" },
];

/** Radix Select cannot hold an empty item value. */
const ALL = "__all__";

/**
 * Which schools the figures cover and how the rows are grouped. Every choice
 * is a URL change, so a view can be bookmarked or shared, and the page stays
 * a server render. Bare controls: the facet view's toolbar card owns the
 * chrome, so the period controls can share the same card.
 */
export function SummaryScopeBar({
  basePath,
  searchParams,
  level,
  district,
  schoolId,
  districts,
  schools,
  allDistrictsLabel,
  requireDistrictForSchool = false,
}: SummaryScopeBarProps) {
  const navigate = useListNavigate();
  const pending = useListPending();

  const schoolsInDistrict = district ? schools.filter((s) => s.district === district) : schools;
  const schoolOptions: SearchableOption[] = [
    { value: ALL, label: district ? `All schools in ${district}` : "All schools" },
    ...schoolsInDistrict.map((s) => ({
      value: s.id,
      label: s.name,
      hint: `${s.schoolIdCode} · ${s.district ?? NO_DISTRICT_LABEL}`,
    })),
  ];

  function go(patch: Record<string, string | null>) {
    navigate(summaryHref(basePath, searchParams, patch));
  }

  return (
    <div
      className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-end"
      aria-busy={pending || undefined}
    >
      <div className="min-w-0 lg:w-auto">
        <span id="summary-level-label" className="mb-1.5 block text-xs font-medium text-muted-foreground">
          Show figures
        </span>
        <div
          role="group"
          aria-labelledby="summary-level-label"
          className="grid grid-cols-3 gap-1 rounded-lg bg-muted/60 p-1"
        >
          {LEVELS.map((item) => {
            const active = item.id === level;
            const disabled = item.id === "school" && requireDistrictForSchool && !district;
            return (
              <Button
                key={item.id}
                type="button"
                variant="ghost"
                aria-pressed={active}
                disabled={disabled}
                title={disabled ? "Pick a district first to see its schools" : undefined}
                onClick={() => {
                  if (!active && !disabled) go({ level: item.id === "overall" ? null : item.id });
                }}
                className={cn(
                  "h-10 px-2 text-sm sm:px-3 lg:h-9",
                  active
                    ? "bg-card text-foreground shadow-sm hover:bg-card"
                    : "text-muted-foreground",
                  disabled && "opacity-50"
                )}
              >
                {item.label}
              </Button>
            );
          })}
        </div>
      </div>

      <div className="grid min-w-0 flex-1 grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="min-w-0">
          <Label htmlFor="summary-district" className="mb-1.5 block text-xs font-medium text-muted-foreground">
            District
          </Label>
          <Select
            value={district ?? ALL}
            onValueChange={(value) =>
              go({ district: value === ALL ? null : value, schoolId: null })
            }
          >
            <SelectTrigger id="summary-district">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{allDistrictsLabel}</SelectItem>
              {districts.map((d) => (
                <SelectItem key={d} value={d}>
                  {d}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="min-w-0">
          <Label htmlFor="summary-school" className="mb-1.5 block text-xs font-medium text-muted-foreground">
            School
          </Label>
          <SearchableSelect
            id="summary-school"
            options={schoolOptions}
            value={schoolId ?? ALL}
            onValueChange={(value) => go({ schoolId: value === ALL ? null : value })}
            placeholder="All schools"
            searchPlaceholder="Search schools by name or ID"
            emptyMessage="No school matches."
            leadingIcon={<Building2 className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />}
            triggerClassName="h-11 rounded-lg bg-card sm:h-10"
            chevron="down"
          />
        </div>
      </div>
    </div>
  );
}
