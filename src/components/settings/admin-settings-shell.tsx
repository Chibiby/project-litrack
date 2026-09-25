"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChevronRight,
  KeyRound,
  Lock,
  MonitorPlay,
  UserCircle,
  type LucideIcon,
} from "lucide-react";
import { PageHero } from "@/components/shell/page-hero";
import { Surface } from "@/components/ui/surface";
import { teacherBannerSrc } from "@/lib/dashboard/banner";
import { cn } from "@/lib/utils";

type Row = { label: string; href: string; icon: LucideIcon };

const ROWS: readonly Row[] = [
  { label: "Profile", href: "/admin/settings/profile", icon: UserCircle },
  { label: "Security", href: "/admin/settings/security", icon: KeyRound },
  { label: "Demo session", href: "/admin/settings/demo", icon: MonitorPlay },
  { label: "Submissions", href: "/admin/submissions", icon: Lock },
];

const COPY: Record<string, { title: string; subtitle: string }> = {
  "/admin/settings/security": {
    title: "Security",
    subtitle: "Change your password and sign-in email.",
  },
  "/admin/settings/demo": {
    title: "Demo session",
    subtitle: "Show or hide the training school used in the ARAL video.",
  },
};

const DEFAULT_COPY = {
  title: "Profile Settings",
  subtitle: "Update your Super Admin name and photo.",
};

/** Which settings row a pathname belongs to; exact or nested match. */
export function activeSettingsHref(pathname: string): string | null {
  const row = ROWS.find(
    (r) => pathname === r.href || pathname.startsWith(`${r.href}/`)
  );
  return row?.href ?? null;
}

/**
 * v2 chrome for the Super Admin's Settings pages: the page hero, then the
 * Settings card beside the page content — the same shape as
 * `SchoolHeadSettingsShell`, with the admin's four rows. Mounted once by the
 * `/admin/settings` layout, so it reads the active row from the pathname
 * rather than from each page. The shared `SettingsShell` stays as it is for
 * `/district`.
 */
export function AdminSettingsShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const active = activeSettingsHref(pathname);
  const copy = (active && COPY[active]) || DEFAULT_COPY;

  return (
    <main id="main-content" className="w-full p-4 lg:p-6">
      <PageHero
        bannerSrc={teacherBannerSrc(null)}
        artClassName="right-[calc(18%-272px)] sm:right-[calc(23%-272px)]"
        phoneMaskClassName="max-[439px]:[&>img]:[mask-image:linear-gradient(to_right,transparent_67%,black_72%)]"
        contentClassName="lg:min-h-[15rem]"
      >
        <h1 className="max-w-[11rem] text-2xl font-extrabold tracking-tight text-slate-950 dark:text-white sm:max-w-none sm:text-3xl lg:text-5xl">
          {copy.title}
        </h1>
        <p className="mt-2 max-w-[11rem] text-sm leading-snug text-slate-600 dark:text-slate-300 sm:max-w-sm sm:text-base lg:max-w-md lg:text-lg lg:text-slate-800">
          {copy.subtitle}
        </p>
      </PageHero>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:mt-6 lg:grid-cols-[19rem_minmax(0,1fr)] lg:items-start lg:gap-6">
        <Surface as="section" className="rounded-2xl p-4">
          <h2 className="text-base font-semibold text-foreground">Settings</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Your account, and the system-wide switches only a Super Admin holds.
          </p>
          <nav aria-label="Settings" className="mt-3">
            <ul className="space-y-1">
              {ROWS.map((row) => {
                const Icon = row.icon;
                const isActive = row.href === active;
                return (
                  <li key={row.href}>
                    <Link
                      href={row.href}
                      prefetch
                      aria-current={isActive ? "page" : undefined}
                      className={cn(
                        "relative flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
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
        <div className="flex min-w-0 flex-col gap-4 lg:gap-6">{children}</div>
      </div>
    </main>
  );
}
