"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { KeyRound, MonitorPlay, UserCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export type SettingsRoleBase = "/admin" | "/school-head" | "/teacher";

function SettingsSidebar({ roleBase }: { roleBase: SettingsRoleBase }) {
  const pathname = usePathname();
  const items = [
    { label: "Profile", href: `${roleBase}/settings/profile`, icon: UserCircle },
    { label: "Security", href: `${roleBase}/settings/security`, icon: KeyRound },
    // Demo mode is a system-wide switch, so it belongs to the Super Admin alone.
    // The route itself is guarded by `requireUser("SUPER_ADMIN")`; hiding the
    // link here is only so the other two roles are not shown a dead end.
    ...(roleBase === "/admin"
      ? ([{ label: "Demo mode", href: "/admin/settings/demo", icon: MonitorPlay }] as const)
      : []),
  ] as const;

  return (
    <nav aria-label="Settings" className="w-full shrink-0 lg:w-52">
      <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
        Settings
      </p>
      <ul className="space-y-1">
        {items.map((item) => {
          const isActive =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                prefetch={true}
                className={cn(
                  "relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                {isActive && (
                  <span
                    aria-hidden
                    className="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-primary"
                  />
                )}
                <Icon
                  className={cn(
                    "h-4 w-4 shrink-0",
                    isActive ? "text-primary" : "text-muted-foreground"
                  )}
                />
                <span className="flex-1 truncate">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * Settings chrome for role `/settings/*` layouts: page title from the segment,
 * secondary Profile | Security nav, then page content.
 */
export function SettingsShell({
  roleBase,
  profileSubtitle,
  securitySubtitle = "Manage your password and email",
  children,
}: {
  roleBase: SettingsRoleBase;
  profileSubtitle: string;
  securitySubtitle?: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const segment = pathname.includes("/settings/security")
    ? "security"
    : pathname.includes("/settings/demo")
      ? "demo"
      : "profile";
  const title =
    segment === "security" ? "Security" : segment === "demo" ? "Demo mode" : "Profile";
  const subtitle =
    segment === "security"
      ? securitySubtitle
      : segment === "demo"
        ? "Show or hide the training school used in the ARAL video"
        : profileSubtitle;

  return (
    // Matches AppShell's content gutters (header is full-bleed, outside this panel).
    <div className="w-full p-4 lg:p-6">
      <div className="mb-4 lg:mb-6">
        <h1 className="truncate text-xl font-bold tracking-tight text-foreground sm:text-2xl">
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-0.5 truncate text-sm text-muted-foreground">{subtitle}</p>
        ) : null}
      </div>

      <main id="main-content">
        <div className="flex flex-col gap-8 lg:flex-row lg:gap-10">
          <SettingsSidebar roleBase={roleBase} />
          <div className="min-w-0 flex-1">{children}</div>
        </div>
      </main>
    </div>
  );
}
