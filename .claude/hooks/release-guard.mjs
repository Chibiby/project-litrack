/**
 * The two decisions behind the release-entry push guard, kept pure so
 * `tests/unit/release-guard.test.ts` can pin them without running the hook.
 *
 * See `require-release-entry.mjs` for the runner and CLAUDE.md § Releases for
 * the rule they enforce.
 */

export const RELEASES_FILE = "src/lib/releases.ts";
const CODE_PREFIXES = ["src/", "prisma/"];

/**
 * The local refs a command pushes to main, or `[]` when it pushes nothing to
 * main. `currentBranch` is `null` on a detached HEAD.
 */
export function pushSourcesToMain(command, currentBranch) {
  const sources = [];
  // One shell command can chain several; check each segment.
  for (const segment of command.split(/&&|\|\||;|\|/)) {
    const tokens = segment.trim().split(/\s+/).filter(Boolean);
    const gitAt = tokens.indexOf("git");
    if (gitAt === -1) continue;
    const pushAt = tokens.indexOf("push", gitAt + 1);
    if (pushAt === -1) continue;

    const args = tokens
      .slice(pushAt + 1)
      .map((t) => t.replace(/^["']|["']$/g, ""))
      .filter((t) => !t.startsWith("-"));
    const refspecs = args.slice(1); // args[0] is the remote

    if (refspecs.length === 0) {
      if (currentBranch === "main") sources.push("HEAD");
      continue;
    }
    for (const spec of refspecs) {
      const clean = spec.replace(/^\+/, "");
      const [src, dst] = clean.includes(":") ? clean.split(":") : [clean, clean];
      const target = dst.replace(/^refs\/heads\//, "");
      if (target !== "main" || !src) continue;
      // `git push origin main` from main pushes the working HEAD, which may sit
      // ahead of the local `main` ref only when they differ — HEAD is the honest
      // source there.
      sources.push(src === "main" && currentBranch === "main" ? "HEAD" : src);
    }
  }
  return sources;
}

/** Whether a push with these changed paths needs a release entry it lacks. */
export function lacksReleaseEntry(changedFiles) {
  const touchesCode = changedFiles.some((f) =>
    CODE_PREFIXES.some((p) => f.startsWith(p))
  );
  return touchesCode && !changedFiles.includes(RELEASES_FILE);
}

export const BLOCK_MESSAGE =
  "Push to main blocked: this push changes src/ or prisma/ but adds no release entry.\n" +
  `Add an entry to the top of RELEASES in ${RELEASES_FILE}, and set the same version in package.json and package-lock.json.\n` +
  "Fix-only push: bump the last number (1.6.0 -> 1.6.1). Any feature: bump the middle number (1.6.0 -> 1.7.0).\n" +
  "See CLAUDE.md, section Releases.";
