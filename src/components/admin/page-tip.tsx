"use client";

import { useState, type ReactNode } from "react";
import { Lightbulb, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * A page hint that is expanded for each fresh page entry, then stays out of
 * the way after dismissal. There is deliberately no storage: navigating away
 * and opening the page again gives the next visitor a fresh explanation.
 */
export function PageTip({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(true);
  const [popoverOpen, setPopoverOpen] = useState(false);

  if (!expanded) {
    return (
      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className={cn("border-amber-300 text-amber-700 hover:bg-amber-50", className)}
            aria-label={`Show tip: ${title}`}
            title={title}
          >
            <Lightbulb aria-hidden />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[min(22rem,calc(100vw-2rem))]">
          <TipContent title={title} onDismiss={() => setPopoverOpen(false)} />
          <div className="mt-2 text-sm text-muted-foreground">{children}</div>
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-100",
        className
      )}
    >
      <Lightbulb className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{title}</p>
        <div className="mt-1 text-amber-900/90 dark:text-amber-100/90">{children}</div>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="-mr-2 -mt-2 shrink-0 text-amber-800 hover:bg-amber-100 hover:text-amber-950 dark:text-amber-100 dark:hover:bg-amber-900/60"
        aria-label="Hide tip"
        title="Hide tip"
        onClick={() => setExpanded(false)}
      >
        <X aria-hidden />
      </Button>
    </div>
  );
}

function TipContent({ title, onDismiss }: { title: string; onDismiss: () => void }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <p className="font-semibold">{title}</p>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="-mr-2 -mt-2 h-8 w-8 shrink-0"
        aria-label="Hide tip"
        title="Hide tip"
        onClick={onDismiss}
      >
        <X aria-hidden />
      </Button>
    </div>
  );
}
