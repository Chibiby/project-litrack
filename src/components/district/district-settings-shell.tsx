import Link from "next/link";
import { ChevronRight, KeyRound, UserCircle, type LucideIcon } from "lucide-react";
import { PageHero } from "@/components/shell/page-hero";
import { Surface } from "@/components/ui/surface";
import { DISTRICT_ROUTES } from "@/lib/routes/district";
import { cn } from "@/lib/utils";

export type DistrictSettingsSection = "profile" | "security";

const ROWS: { key: DistrictSettingsSection; label: string; icon: LucideIcon; href: string }[] = [
  { key: "profile", label: "Profile", icon: UserCircle, href: DISTRICT_ROUTES.settingsProfile },
  { key: "security", label: "Security", icon: KeyRound, href: DISTRICT_ROUTES.settingsSecurity },
];

function SettingsNavCard({ active }: { active: DistrictSettingsSection }) {
  return (
    <Surface as="section" className="rounded-2xl p-4">
      <h2 className="text-base font-semibold text-foreground">Settings</h2>
      <p className="mt-0.5 text-sm text-muted-foreground">Manage your account.</p>
      <nav aria-label="Settings" className="mt-3">
        <ul className="space-y-1">
          {ROWS.map((row) => {
            const Icon = row.icon;
            const isActive = row.key === active;
            return (
              <li key={row.key}>
                <Link
                  href={row.href}
                  prefetch
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "relative flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-10",
                    isActive ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted"
                  )}
                >
                  {isActive ? (
                    <span
                      aria-hidden
                      className="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-primary"
                    />
                  ) : null}
                  <Icon
                    aria-hidden
                    className={cn("size-4 shrink-0", isActive ? "text-primary" : "text-muted-foreground")}
                  />
                  <span className="flex-1 truncate">{row.label}</span>
                  <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground lg:hidden" />
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </Surface>
  );
}

/**
 * The district admin's Settings chrome: the School Head settings shape
 * (`school-head-settings-shell.tsx`) — hero, then the Settings card beside the
 * page content — pointed at the district's two routes. Below lg the content
 * column is `display: contents`, so its children share the card's column.
 */
export function DistrictSettingsShell({
  active,
  bannerSrc,
  children,
}: {
  active: DistrictSettingsSection;
  bannerSrc: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <PageHero
        bannerSrc={bannerSrc}
        artClassName="right-[calc(18%-272px)] sm:right-[calc(23%-272px)]"
        phoneMaskClassName="max-[439px]:[&>img]:[mask-image:linear-gradient(to_right,transparent_67%,black_72%)]"
        contentClassName="lg:min-h-[15rem]"
      >
        <h1 className="max-w-[11rem] text-2xl font-extrabold tracking-tight text-slate-950 dark:text-white sm:max-w-none sm:text-3xl lg:text-5xl">
          Settings
        </h1>
        <p className="mt-2 max-w-[11rem] text-sm leading-snug text-slate-600 dark:text-slate-300 sm:max-w-sm sm:text-base lg:max-w-md lg:text-lg lg:text-slate-800">
          {active === "security" ? "Change your password." : "Update your name and photo."}
        </p>
      </PageHero>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:mt-6 lg:grid-cols-[19rem_minmax(0,1fr)] lg:items-start lg:gap-6">
        <SettingsNavCard active={active} />
        <div className="contents lg:flex lg:min-w-0 lg:flex-col lg:gap-6">{children}</div>
      </div>
    </>
  );
}
