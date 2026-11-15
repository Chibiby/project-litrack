import { CheckCircle2, CircleAlert, MinusCircle, type LucideIcon } from "lucide-react";
import { TASK_STATE_LABELS, type TaskState, type TaskStatus } from "@/lib/teacher-tasks/types";
import { cn } from "@/lib/utils";

const STATE_STYLE: Record<TaskState, { icon: LucideIcon; className: string }> = {
  DONE: {
    icon: CheckCircle2,
    className:
      "border-success-200 bg-success-50 text-success-800 dark:border-success-900 dark:bg-success-950/40 dark:text-success-200",
  },
  PENDING: {
    icon: CircleAlert,
    className:
      "border-warning-300 bg-warning-50 text-warning-900 dark:border-warning-800 dark:bg-warning-950/40 dark:text-warning-200",
  },
  NOT_APPLICABLE: {
    icon: MinusCircle,
    className: "border-border bg-muted/50 text-muted-foreground",
  },
};

/** Icon and word together, so the state never rests on colour alone. */
export function TaskStateBadge({ state }: { state: TaskState }) {
  const { icon: Icon, className } = STATE_STYLE[state];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold",
        className
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {TASK_STATE_LABELS[state]}
    </span>
  );
}

/** One task's badge with the sentence that explains it underneath. */
export function TaskStatusCell({ status }: { status: TaskStatus }) {
  return (
    <div className="flex min-w-0 flex-col items-start gap-1">
      <TaskStateBadge state={status.state} />
      <p className="text-xs leading-snug text-muted-foreground">{status.detail}</p>
    </div>
  );
}
