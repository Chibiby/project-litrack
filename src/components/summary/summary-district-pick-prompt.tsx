"use client";

import { Building2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useListNavigate } from "@/components/nav/list-navigation";
import { summaryHref, type FlatSearchParams } from "./summary-href";

export type SummaryDistrictPickPromptProps = {
  basePath: string;
  searchParams: FlatSearchParams;
  districts: readonly string[];
};

/**
 * Shown instead of the "By school" results at division scope until a district
 * is chosen: listing every school in the division (300+) at once is what made
 * `/admin/summary/<facet>?level=school` never finish loading, so the page must
 * not call `facet.load` for that scope at all (see `SummaryFacetView`).
 */
export function SummaryDistrictPickPrompt({
  basePath,
  searchParams,
  districts,
}: SummaryDistrictPickPromptProps) {
  const navigate = useListNavigate();

  return (
    <div className="flex min-w-0 flex-col items-center justify-center rounded-xl border border-dashed border-border/80 bg-muted/30 px-6 py-12 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Building2 className="h-6 w-6" aria-hidden />
      </div>
      <h3 className="text-base font-semibold text-foreground">Pick a district to see its schools</h3>
      <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">
        The division has too many schools to list school-by-school at once. Choose a
        district to load its figures.
      </p>
      <div className="mt-5 w-full max-w-xs">
        <Select
          onValueChange={(value) => navigate(summaryHref(basePath, searchParams, { district: value }))}
        >
          <SelectTrigger aria-label="District" id="summary-district-prompt">
            <SelectValue placeholder="Choose a district" />
          </SelectTrigger>
          <SelectContent>
            {districts.map((d) => (
              <SelectItem key={d} value={d}>
                {d}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
