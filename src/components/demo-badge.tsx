import { cn } from "@/lib/utils";

/**
 * The same "Demo" pill used on the schools table, reused wherever Super Admin
 * views mix real and demo-school rows (support tickets, chat threads, error
 * events) so Test Lab traffic stays recognizable at a glance.
 */
export function DemoBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "rounded-full border border-violet-300 bg-violet-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-300",
        className
      )}
      title="Training data from a demo school."
    >
      Demo
    </span>
  );
}
