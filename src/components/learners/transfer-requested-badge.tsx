import { ArrowRightLeft } from "lucide-react";
import { cn } from "@/lib/utils";

/** "Transfer requested → Rosal" on a roster row with a waiting request. */
export function TransferRequestedBadge({
  toSectionName,
  className,
}: {
  toSectionName: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-900/30 dark:text-amber-200",
        className
      )}
    >
      <ArrowRightLeft className="size-3.5" aria-hidden />
      Transfer requested → {toSectionName}
    </span>
  );
}
