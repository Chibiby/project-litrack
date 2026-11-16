import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export type LegalSection = { heading: string; body: React.ReactNode };

/**
 * Shared frame for the public Privacy Policy and Terms and Conditions pages.
 * Readable from the sign-in screen without an account, so it uses no app
 * shell and no session.
 */
export function LegalPage({
  title,
  updated,
  intro,
  sections,
}: {
  title: string;
  /** Local YYYY-MM-DD the text last changed. */
  updated: string;
  intro: React.ReactNode;
  sections: readonly LegalSection[];
}) {
  return (
    <main id="main-content" className="min-h-dvh bg-background">
      <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
        <Link
          href="/login"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back to sign in
        </Link>
        <h1 className="mt-6 text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          LITRACK · Last updated <time dateTime={updated}>{updated}</time>
        </p>
        <div className="mt-6 space-y-4 text-base leading-relaxed text-foreground/90">{intro}</div>
        <nav aria-label="On this page" className="mt-8 rounded-lg border bg-muted/30 p-4">
          <p className="text-sm font-semibold">On this page</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
            {sections.map((s, i) => (
              <li key={s.heading}>
                <a href={`#section-${i + 1}`} className="text-primary hover:underline">
                  {s.heading}
                </a>
              </li>
            ))}
          </ol>
        </nav>
        <div className="mt-10 space-y-10">
          {sections.map((s, i) => (
            <section key={s.heading} id={`section-${i + 1}`} className="scroll-mt-6">
              <h2 className="text-xl font-semibold tracking-tight">
                {i + 1}. {s.heading}
              </h2>
              <div className="mt-3 space-y-3 leading-relaxed text-foreground/90 [&_li]:ml-5 [&_ul]:list-disc [&_ul]:space-y-1.5">
                {s.body}
              </div>
            </section>
          ))}
        </div>
        <p className="mt-12 border-t pt-6 text-sm text-muted-foreground">
          See also{" "}
          <Link href={title === "Privacy Policy" ? "/terms" : "/privacy"} className="text-primary hover:underline">
            {title === "Privacy Policy" ? "Terms and Conditions" : "Privacy Policy"}
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
