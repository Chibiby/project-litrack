import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * One identifier per production build, shared by `next.config.mjs`
 * (`deploymentId`, which Next uses to turn a navigation across a deploy into a
 * full page load) and the static `public/litrack-version.json` that open tabs
 * check to learn a newer version is live.
 *
 * Computed once and kept in `LITRACK_DEPLOYMENT_ID`, so the OpenNext outer and
 * inner builds and every process that loads next.config agree on one value.
 * Next allows only letters, digits, `_` and `-`.
 */
export const VERSION_FILE = "litrack-version.json";

function gitShortSha() {
  try {
    return execSync("git rev-parse --short=10 HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return String(Date.now());
  }
}

export function resolveDeploymentId(cwd = process.cwd()) {
  const existing = process.env.LITRACK_DEPLOYMENT_ID;
  if (existing) return existing;
  const { version } = JSON.parse(readFileSync(path.join(cwd, "package.json"), "utf8"));
  const id = `v${String(version).replace(/[^a-zA-Z0-9]/g, "_")}-${gitShortSha()}`;
  process.env.LITRACK_DEPLOYMENT_ID = id;
  return id;
}

export function writeVersionFile(id, cwd = process.cwd()) {
  writeFileSync(
    path.join(cwd, "public", VERSION_FILE),
    `${JSON.stringify({ deploymentId: id })}\n`
  );
}
