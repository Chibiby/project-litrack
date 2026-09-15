import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** The white card every sign-in step renders in (see LoginShell). */
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
        "rounded-3xl border border-white/70 bg-card p-6 shadow-[0_24px_60px_-20px_rgba(15,23,42,0.35)] sm:p-8 2xl:p-12",
        className
      )}
    >
      {children}
    </div>
  );
}

/** Icon tile, title and one line under it, centred at the top of the card. */
export function AuthCardHeader({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: LucideIcon;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex flex-col items-center text-center">
      <span
        aria-hidden
        className="relative flex size-16 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 2xl:size-20"
      >
        <Icon className="size-9 2xl:size-11" strokeWidth={1.75} />
      </span>
      <h2 className="mt-4 text-3xl font-bold tracking-tight text-indigo-950 2xl:text-4xl">
        {title}
      </h2>
      <p className="mt-1.5 text-base text-slate-600 2xl:text-lg">{subtitle}</p>
    </div>
  );
}

/** Label style shared by the sign-in fields. */
export const AUTH_LABEL = "text-base font-semibold text-indigo-950";

/** The large blue call to action ("Continue", "Sign in"). */
export const AUTH_PRIMARY_BUTTON =
  "h-12 w-full rounded-xl bg-gradient-to-r from-blue-600 to-sky-500 text-base font-semibold text-white shadow-md shadow-blue-600/20 hover:from-blue-700 hover:to-sky-600 2xl:h-14 2xl:text-lg [&_svg]:size-5";
