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
        "rounded-full border border-aral-300 bg-aral-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-aral-700 dark:border-aral-800 dark:bg-aral-950 dark:text-aral-300",
        className
      )}
      title="Training data from a demo school."
    >
      Demo
    </span>
  );
}
