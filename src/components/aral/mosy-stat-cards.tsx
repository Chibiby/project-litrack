import { cn } from "@/lib/utils";
import {
  CheckCircle2,
  ClipboardCheck,
  DoorOpen,
  Hourglass,
  Users,
  type LucideIcon,
} from "lucide-react";
import { StatCard, type StatTone, STAT_GRID } from "@/components/dashboard/teacher/stat-cards";
import type { MosyStatCard, MosyStats } from "@/lib/aral/mosy";

const CARD_STYLE: Record<
  MosyStatCard["key"],
  { icon: LucideIcon; tone: StatTone }
> = {
  total: { icon: Users, tone: "violet" },
  updated: { icon: ClipboardCheck, tone: "primary" },
  forDecision: { icon: Hourglass, tone: "amber" },
  movedOut: { icon: DoorOpen, tone: "neutral" },
  stay: { icon: CheckCircle2, tone: "emerald" },
};

/** The five MOSY summary cards, from `computeMosyStats`. Same `StatCard` as Profiling. */
export function MosyStatCards({ stats }: { stats: MosyStats }) {
  return (
    <div className={cn(STAT_GRID, "[&>*:last-child]:max-sm:col-span-2")}>
      {stats.cards.map((card) => {
        const style = CARD_STYLE[card.key];
        return (
          <StatCard
            key={card.key}
            title={card.label}
            value={card.value}
            hint={card.hint}
            icon={style.icon}
            tone={style.tone}
            denseOnPhone
          />
        );
      })}
    </div>
  );
}
