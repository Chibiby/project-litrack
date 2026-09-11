import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { roleHomePath } from "@/lib/auth/roles";
import { RELEASES } from "@/lib/releases";

export const metadata: Metadata = { title: "Releases · LITRACK" };

/**
 * `force-dynamic` because `requireUser` reads cookies. The list itself is a
 * committed constant, so there is nothing here to cache.
 */
export const dynamic = "force-dynamic";

/**
 * The full release history (§1 of the ten concerns).
 *
 * Readable by anyone signed in, with no role branching: what changed in the app
 * is not tenant data, and three copies of this page — one per role shell — would
 * be three places for the same list to drift. `requireUser()` with no argument
 * is the whole authorization story.
 *
 * Outside the role shells on purpose, like `/pending-approval`: it is one page
 * for every role, and the way back is to the reader's own home.
 */
export default async function ReleasesPage() {
  const user = await requireUser();

  return (
    <main id="main-content" className="min-h-screen bg-background px-4 py-10">
      <div className="mx-auto max-w-2xl">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          What&apos;s new
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every version of LITRACK, newest first.
        </p>

        <ol className="mt-8 space-y-10">
          {RELEASES.map((release) => (
            <li key={release.version}>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 className="text-lg font-medium text-foreground">{release.title}</h2>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {release.version} · {release.date}
                </span>
              </div>
              <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                {release.fixes.map((fix) => (
                  <li key={fix} className="flex gap-2">
                    <span aria-hidden="true" className="text-primary">
                      &bull;
                    </span>
                    <span>{fix}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>

        <p className="mt-12 text-sm">
          <Link
            href={roleHomePath(user.role)}
            className="text-primary underline-offset-4 hover:underline"
          >
            Back to LITRACK
          </Link>
        </p>
      </div>
    </main>
  );
}
