import { ArrowUpRight, type LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type StatAccent = "primary" | "amber";

export function StatCard({
  label,
  value,
  icon: Icon,
  accent = "amber",
  className,
}: {
  label: string;
  value: React.ReactNode;
  icon?: LucideIcon;
  accent?: StatAccent;
  className?: string;
}) {
  return (
    <Card
      className={cn(
        "overflow-hidden border-0 shadow-card",
        accent === "primary" ? "bg-primary text-primary-foreground" : "bg-amber text-amber-foreground",
        className
      )}
    >
      <CardContent className="flex items-start justify-between gap-3 p-5">
        <div className="min-w-0 space-y-1">
          <p
            className={cn(
              "text-sm font-medium",
              accent === "primary" ? "text-primary-foreground" : "text-amber-foreground/80"
            )}
          >
            {label}
          </p>
          <p className="text-3xl font-bold tracking-tight">{value}</p>
        </div>
        <div
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
            accent === "primary" ? "bg-white/15" : "bg-foreground/10"
          )}
          aria-hidden="true"
        >
          {Icon ? <Icon className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
        </div>
      </CardContent>
    </Card>
  );
}
