import { cn } from "@/lib/utils";
import { BookOpen, Sprout, TrendingUp, Trophy, Users, type LucideIcon } from "lucide-react";
import { StatCard, type StatTone, STAT_GRID } from "@/components/dashboard/teacher/stat-cards";
import type { BosyStatCard } from "@/lib/aral/bosy";

const CARD_STYLE: Record<BosyStatCard["key"], { icon: LucideIcon; tone: StatTone }> = {
  total: { icon: Users, tone: "violet" },
  tier1: { icon: Sprout, tone: "amber" },
  tier2: { icon: BookOpen, tone: "primary" },
  tier3: { icon: TrendingUp, tone: "pink" },
  tier4: { icon: Trophy, tone: "emerald" },
};

/** The five BOSY summary cards. Same `StatCard` and grid as the MOSY page. */
export function BosyStatCards({ cards }: { cards: BosyStatCard[] }) {
  return (
    <div className={cn(STAT_GRID, "[&>*:last-child]:max-sm:col-span-2")}>
      {cards.map((card) => {
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
