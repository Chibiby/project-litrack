import { BookOpen } from "lucide-react";
import { readingProfileOptionsForGrade } from "@/lib/reading/policy";
import { rampTone } from "@/lib/reading/level-tone";
import { cn } from "@/lib/utils";

/**
 * The rubric values this grade actually offers, each swatched in the same
 * colour the grid paints it (`rampTone`, `src/lib/reading/level-tone.ts`) —
 * one source of truth so the legend can never drift from the grid.
 *
 * Label plus swatch only: readable without colour because the label carries
 * the meaning, and no description is invented for any value.
 */
export function ReadingLevelLegend({ gradeType }: { gradeType: string }) {
  const options = readingProfileOptionsForGrade(gradeType);

  return (
    <section
      aria-label="Reading Level Guide"
      className="mt-4 rounded-xl border border-border bg-card p-4"
    >
      <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
        <BookOpen className="size-4 shrink-0" aria-hidden />
        Reading Level Guide
      </p>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm text-muted-foreground">
        {options.map((option, index) => (
          <li key={option.value} className="flex items-center gap-2">
            <span
              aria-hidden
              className={cn(
                "inline-block size-3 shrink-0 rounded-full border",
                rampTone(index, options.length)
              )}
            />
            <span>{option.label}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
