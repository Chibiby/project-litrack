"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export type DryRunPreviewRow = [label: string, value: string];

/**
 * Narrows a server action's `data` (typed `unknown` on the legacy
 * `ActionResult<T = unknown>` shape some actions still use) to its dry-run
 * shape, without widening the action modules' own types.
 */
export function isDryRunPreview<T>(data: unknown): data is { dryRun: true; preview: T } {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { dryRun?: unknown }).dryRun === true &&
    "preview" in data
  );
}

/**
 * What a Test Lab dry-run save would have written, shown instead of the real
 * redirect/toast. Password previews pass no `rows` — the typed password is
 * never rendered — and rely on `description` alone.
 */
export function DryRunPreviewDialog({
  open,
  onOpenChange,
  title = "Test Lab preview",
  description,
  rows,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: string;
  rows?: DryRunPreviewRow[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        {rows && rows.length > 0 ? (
          <dl className="space-y-3">
            {rows.map(([label, value]) => (
              <div key={label} className="grid grid-cols-[minmax(0,40%)_1fr] gap-2 text-sm">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="min-w-0 break-words font-medium">{value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
