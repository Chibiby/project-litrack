import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { roleHomePath } from "@/lib/auth/roles";
import { RELEASES, visibleFixes } from "@/lib/releases";
import { ImpersonationNotice } from "@/components/admin/impersonation-notice";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

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
  const userName = user.fullName || `${user.firstName} ${user.lastName}`;

  return (
    <main id="main-content" className="min-h-screen bg-background px-4 py-10">
      {/*
        Reachable from inside an impersonated session via the sidebar's
        "What's new" link and the notifications menu, not just a redirect
        target — the banner still has to be here or the way back is lost.
      */}
      <ImpersonationNotice userId={user.id} accountName={userName} />
      <div className="mx-auto max-w-2xl">
        <Button asChild variant="ghost" className="-ml-3 mb-6 gap-2">
          <Link href={roleHomePath(user.role)}>
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Back to LITRACK
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          What&apos;s new
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every version of LITRACK, newest first.
        </p>

        <ol className="mt-8 space-y-10">
          {RELEASES.map((release) => ({
            release,
            // Filtered on the server, by the role of the signed-in reader: a
            // restricted note is never sent to a browser it was not written for.
            fixes: visibleFixes(release, user.role),
          }))
            .filter(({ fixes }) => fixes.length > 0)
            .map(({ release, fixes }) => (
              // `id` is the bell's link target: each release row there points
              // at `/releases#v{version}`.
              <li key={release.version} id={`v${release.version}`} className="scroll-mt-8">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h2 className="text-lg font-medium text-foreground">{release.title}</h2>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    v{release.version} · {release.date}
                  </span>
                </div>
                <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                  {fixes.map((fix) => (
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

      </div>
    </main>
  );
}
