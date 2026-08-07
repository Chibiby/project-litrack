import Link from "next/link";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import { ArrowUpRight } from "lucide-react";

export type MetricCardTone = "default" | "primary" | "amber" | "violet";

export interface MetricCardProps {
  title: string;
  value: string | number;
  icon?: LucideIcon;
  hint?: string;
  tone?: MetricCardTone;
  href?: string;
  className?: string;
}

const toneStyles: Record<
  MetricCardTone,
  { card: string; title: string; value: string; hint: string; chip: string }
> = {
  default: {
    card: "bg-card text-card-foreground border-border/80 shadow-card",
    title: "text-muted-foreground",
    value: "text-foreground",
    hint: "text-muted-foreground",
    chip: "bg-primary/10 text-primary",
  },
  primary: {
    card: "bg-primary text-primary-foreground border-primary shadow-card",
    title: "text-primary-foreground/80",
    value: "text-primary-foreground",
    hint: "text-primary-foreground/70",
    chip: "bg-white/20 text-primary-foreground",
  },
  amber: {
    card: "bg-secondary text-secondary-foreground border-secondary shadow-card",
    title: "text-secondary-foreground/80",
    value: "text-secondary-foreground",
    hint: "text-secondary-foreground/70",
    chip: "bg-black/10 text-secondary-foreground",
  },
  violet: {
    card: "bg-violet-50 text-violet-700 border-violet-200 shadow-card",
    title: "text-violet-600/80",
    value: "text-violet-700",
    hint: "text-violet-600/70",
    chip: "bg-violet-100 text-violet-600",
  },
};

export function MetricCard({
  title,
  value,
  icon: Icon,
  hint,
  tone = "default",
  href,
  className,
}: MetricCardProps) {
  const styles = toneStyles[tone];
  const ChipIcon = Icon ?? ArrowUpRight;

  const content = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className={cn("text-sm font-medium", styles.title)}>{title}</p>
        <span
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
            styles.chip
          )}
        >
          <ChipIcon className="h-4 w-4" aria-hidden />
        </span>
      </div>
      <p className={cn("mt-3 text-3xl font-bold tracking-tight", styles.value)}>{value}</p>
      {hint ? <p className={cn("mt-1.5 text-xs", styles.hint)}>{hint}</p> : null}
    </>
  );

  const classes = cn(
    "relative block rounded-xl border p-5 transition-shadow",
    styles.card,
    href && "hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    className
  );

  if (href) {
    return (
      <Link href={href} prefetch={true} className={classes}>
        {content}
      </Link>
    );
  }

  return <div className={classes}>{content}</div>;
}
