import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The white card every sign-in step renders in (see LoginShell), in the v2
 * app's colours: a lavender-to-sky wash under the header, like the page
 * banners, and violet as the primary and focus colour — set as tokens here so
 * the default Button variant and every input's focus ring follow it.
 */
export function AuthCard({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-3xl border border-white/70 bg-card bg-gradient-to-b from-violet-50 via-sky-50/40 via-25% to-card to-50% p-6 shadow-[0_24px_60px_-20px_rgba(46,16,101,0.35)] [--primary:var(--violet)] [--ring:var(--violet)] sm:p-8 2xl:p-12",
        // Inside LoginShell's `glass` frame (/login only): a translucent,
        // blurred pane with a bright rim and a soft top sheen, iOS style. The
        // white tint stays high enough to keep the text readable over the art.
        "[.login-glass_&]:border-white/60 [.login-glass_&]:bg-[rgba(255,255,255,0.45)] [.login-glass_&]:bg-[linear-gradient(160deg,rgba(255,255,255,0.6),rgba(255,255,255,0.15)_45%,rgba(255,255,255,0.3))] [.login-glass_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_-1px_0_rgba(255,255,255,0.3),0_24px_60px_-20px_rgba(46,16,101,0.35)] [.login-glass_&]:backdrop-blur-2xl [.login-glass_&]:backdrop-saturate-150",
        className
      )}
    >
      {children}
    </div>
  );
}

/** Optional icon tile, title and one line under it, centred at the top of the card. */
export function AuthCardHeader({
  icon: Icon,
  title,
  subtitle,
}: {
  icon?: LucideIcon;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex flex-col items-center text-center">
      {Icon ? (
        <span
          aria-hidden
          className="relative mb-5 flex size-16 items-center justify-center rounded-2xl bg-violet-100 text-violet-600 2xl:mb-6 2xl:size-20"
        >
          <Icon className="size-9 2xl:size-11" strokeWidth={1.75} />
        </span>
      ) : null}
      <h2 className="text-3xl font-bold leading-tight tracking-tight text-indigo-950 2xl:text-4xl">
        {title}
      </h2>
      <p className="mt-0.5 text-base text-slate-600 2xl:mt-1 2xl:text-lg">{subtitle}</p>
    </div>
  );
}

/** Label style shared by the sign-in fields. */
export const AUTH_LABEL = "text-sm font-medium text-indigo-950 2xl:text-base";

/** The violet gradient pill of the sidebar highlight, for the v2 sign-in controls. */
export const AUTH_PILL = "bg-gradient-to-r from-violet-600 to-violet-500 text-white shadow-md shadow-violet-500/30 hover:from-violet-700 hover:to-violet-600";

/** The large call to action ("Continue", "Sign in"). */
export const AUTH_PRIMARY_BUTTON =
  "h-12 w-full rounded-xl text-base font-bold 2xl:h-14 2xl:text-lg [&_svg]:size-5 bg-gradient-to-r from-violet-600 to-violet-500 text-white shadow-md shadow-violet-500/30 hover:from-violet-700 hover:to-violet-600";

/** Text links in the card ("Forgot password?", "School login"). */
export const AUTH_LINK =
  "font-medium text-violet-700 underline underline-offset-4 hover:text-violet-800";
