import {
  CheckCircle2,
  ClipboardCheck,
  DoorOpen,
  Hourglass,
  Users,
  type LucideIcon,
} from "lucide-react";
import { StatCard, type StatDecor, type StatTone } from "@/components/dashboard/teacher/stat-cards";
import type { MosyStatCard, MosyStats } from "@/lib/aral/mosy";

const CARD_STYLE: Record<
  MosyStatCard["key"],
  { icon: LucideIcon; tone: StatTone; decor: StatDecor }
> = {
  total: { icon: Users, tone: "violet", decor: "people" },
  updated: { icon: ClipboardCheck, tone: "primary", decor: "wave" },
  forDecision: { icon: Hourglass, tone: "amber", decor: "clock" },
  movedOut: { icon: DoorOpen, tone: "neutral", decor: "sprout" },
  stay: { icon: CheckCircle2, tone: "emerald", decor: "bars" },
};

/** The five MOSY summary cards, from `computeMosyStats`. Same `StatCard` as Profiling. */
export function MosyStatCards({ stats }: { stats: MosyStats }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 2xl:grid-cols-5 [&>*:last-child]:max-lg:col-span-2">
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
            decor={style.decor}
            inlineOnPhone
            denseOnPhone
          />
        );
      })}
    </div>
  );
}
