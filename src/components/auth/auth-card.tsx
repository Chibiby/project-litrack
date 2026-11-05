import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { LiquidGlassLayer } from "./liquid-glass-layer";

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
        "rounded-xl border border-white/70 bg-card bg-gradient-to-b from-violet-50 via-sky-50/40 via-25% to-card to-50% p-6 shadow-[0_24px_60px_-20px_rgba(46,16,101,0.35)] [--primary:var(--violet)] [--ring:var(--violet)] sm:p-8 2xl:p-12",
        // Inside LoginShell's `glass` frame (/login only) the card itself goes
        // clear and LiquidGlassLayer draws the glass behind the content: tint,
        // specular rim, and (Chromium) a lens that bends the art at the edge.
        "relative isolate [.login-glass_&]:border-transparent [.login-glass_&]:bg-transparent [.login-glass_&]:bg-none [.login-glass_&]:shadow-[0_24px_60px_-20px_rgba(46,16,101,0.35),0_2px_6px_rgba(46,16,101,0.08)]",
        className
      )}
    >
      <div className="hidden rounded-[inherit] [.login-glass_&]:contents">
        <LiquidGlassLayer />
      </div>
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
          className="relative mb-5 flex size-16 items-center justify-center rounded-lg bg-violet-100 text-violet-600 2xl:mb-6 2xl:size-20"
        >
          <Icon className="size-9 2xl:size-11" strokeWidth={1.75} />
        </span>
      ) : null}
      <h2 className="text-2xl font-bold leading-tight tracking-tight text-indigo-950 sm:text-3xl 2xl:text-4xl">
        {title}
      </h2>
      <p className="mt-0.5 text-sm text-slate-600 sm:text-base 2xl:mt-1 2xl:text-lg">{subtitle}</p>
    </div>
  );
}

/** Label style shared by the sign-in fields. */
export const AUTH_LABEL = "text-sm font-medium text-indigo-950 2xl:text-base";

/** The violet gradient pill of the sidebar highlight, for the v2 sign-in controls. */
export const AUTH_PILL = "bg-gradient-to-r from-violet-600 to-violet-500 text-white shadow-md shadow-violet-500/30 hover:from-violet-700 hover:to-violet-600";

/**
 * The large call to action ("Next", "Sign in"). On the Liquid Glass card a
 * button that cannot be pressed yet turns into a plain glass pill (translucent
 * fill, hairline edge, muted text) instead of a washed-out violet one; while it
 * is busy signing in (aria-busy) it keeps the violet.
 */
export const AUTH_PRIMARY_BUTTON = cn(
  "h-11 w-full rounded-xl text-sm font-bold sm:h-12 sm:text-base 2xl:h-14 2xl:text-lg [&_svg]:size-4 sm:[&_svg]:size-5 bg-gradient-to-r from-violet-600 to-violet-500 text-white shadow-md shadow-violet-500/30 hover:from-violet-700 hover:to-violet-600",
  "[.login-glass_&:disabled:not([aria-busy=true])]:border [.login-glass_&:disabled:not([aria-busy=true])]:border-white/70 [.login-glass_&:disabled:not([aria-busy=true])]:bg-card/35 [.login-glass_&:disabled:not([aria-busy=true])]:bg-none [.login-glass_&:disabled:not([aria-busy=true])]:text-slate-500 [.login-glass_&:disabled:not([aria-busy=true])]:opacity-100 [.login-glass_&:disabled:not([aria-busy=true])]:shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]",
);

/**
 * Every field and picker on the Liquid Glass card. Apple's rule for controls
 * on glass is "fills, not more glass": a translucent white fill (no blur of its
 * own) with a hairline white edge and a top highlight, so the card's glass reads
 * through the field instead of an opaque white slab. Hover and focus raise the
 * fill for contrast while typing.
 */
export const GLASS_FIELD =
  "border-white/70 bg-card/45 shadow-[inset_0_1px_0_rgba(255,255,255,0.8),0_1px_2px_rgba(46,16,101,0.06)] transition-colors hover:bg-card/55 focus-visible:bg-card/70 data-[state=open]:bg-card/70";

/**
 * Floating-label text fields. Same height, icon position and text size as the
 * /login pickers, so every field lines up. The label sits inside the field
 * where a placeholder would, and moves to the top edge (smaller) while the
 * field is focused, filled (wrapper's data-filled) or autofilled by the
 * browser — so the field stays named while you type. The wrapper needs
 * `group relative` and `data-filled`.
 */
export const FIELD_ICON =
  "pointer-events-none absolute left-5 top-1/2 size-5 -translate-y-1/2 text-slate-600";
export const FLOAT_INPUT = cn(
  GLASS_FIELD,
  "h-12 pb-1 pl-14 pt-5 text-base text-indigo-950 lg:h-12 lg:text-base 2xl:h-14 2xl:pt-6",
);
export const FLOAT_LABEL =
  "pointer-events-none absolute left-14 top-1/2 -translate-y-1/2 text-sm font-normal text-slate-600 sm:text-base transition-all duration-150 motion-reduce:transition-none group-focus-within:top-3 group-focus-within:text-xs group-focus-within:text-violet-700 group-data-[filled=true]:top-3 group-data-[filled=true]:text-xs group-has-[:autofill]:top-3 group-has-[:autofill]:text-xs 2xl:group-has-[:autofill]:top-4 2xl:group-focus-within:top-4 2xl:group-data-[filled=true]:top-4";

/** Notes inside the glass card (session ended, …): a glass fill, not a grey box. */
export const GLASS_NOTE =
  "rounded-lg border border-white/70 bg-card/45 px-4 py-3 text-sm text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]";

/** Text links in the card ("Forgot password?", "School login"). */
export const AUTH_LINK =
  "font-medium text-violet-700 underline underline-offset-4 hover:text-violet-800";
