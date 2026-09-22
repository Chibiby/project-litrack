import {
  Select,
  SelectContent,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

/**
 * Facet control: a small caption stacked over the current value, matching the
 * mockup. `line-clamp-none` undoes SelectTrigger's single-line clamp.
 *
 * Shared by every data table's filter/sort row. Moved verbatim out of
 * `learner-list-toolbar.tsx`, where it was first built for the learner
 * roster, so other tables (and `SortSelect`) can use the same control without
 * importing a component module.
 */
export function FacetSelect({
  id,
  label,
  value,
  onValueChange,
  className,
  children,
}: {
  id: string;
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger
        id={id}
        aria-label={label}
        className={cn(
          "h-auto w-full gap-2 rounded-xl py-1.5 [&>span]:line-clamp-none",
          className
        )}
      >
        {/* Block children, not flex: the clamp reset above sets display:block
            on this span, so its two lines must stack on their own. */}
        <span className="min-w-0 text-left">
          <span className="block text-[11px] font-normal leading-tight text-muted-foreground">
            {label}
          </span>
          <span className="block truncate text-sm font-medium leading-tight text-foreground">
            <SelectValue />
          </span>
        </span>
      </SelectTrigger>
      <SelectContent>{children}</SelectContent>
    </Select>
  );
}
