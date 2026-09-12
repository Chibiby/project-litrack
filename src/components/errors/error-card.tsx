import type { LucideIcon } from "lucide-react";

/**
 * The one card every error page uses: an icon in a tinted circle, a title, an
 * explanation, an optional reference, and the ways out.
 *
 * Matches the app's card style (`bg-card`, `shadow-card`, blue primary). Violet
 * stays reserved for ARAL, so it never appears here.
 */
export function ErrorCard({
  icon: Icon,
  tone = "destructive",
  title,
  description,
  reference,
  children,
}: {
  icon: LucideIcon;
  tone?: "destructive" | "primary";
  title: string;
  description: React.ReactNode;
  reference?: string | null;
  children?: React.ReactNode;
}) {
  const toneClasses =
    tone === "primary" ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive";

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-xl border border-border/80 bg-card p-8 text-center shadow-card">
        <div
          className={`mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full ${toneClasses}`}
        >
          <Icon className="h-7 w-7" aria-hidden />
        </div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        <div className="mt-2 text-sm text-muted-foreground">{description}</div>
        {reference ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Reference: <span className="font-mono">{reference}</span>
          </p>
        ) : null}
        {children ? (
          <div className="mt-6 flex flex-wrap justify-center gap-2">{children}</div>
        ) : null}
      </div>
    </main>
  );
}
