import { execSync } from "node:child_process";

const isCloudflareWorkersBuild = process.env.WORKERS_CI === "1";
const isOpenNextInnerBuild = process.env.OPENNEXT_INNER_BUILD === "1";

if (isCloudflareWorkersBuild && !isOpenNextInnerBuild) {
  console.log("Building LITRACK for Cloudflare Workers with OpenNext...");
  execSync("npx opennextjs-cloudflare build", {
    stdio: "inherit",
    env: {
      ...process.env,
      OPENNEXT_INNER_BUILD: "1",
    },
  });
} else {
  // OpenNext's inner build re-enters this script (OPENNEXT_INNER_BUILD=1), so
  // this one line picks the bundler for BOTH the standard and the Cloudflare
  // build. `--turbopack` is explicit on purpose: Next 16 refuses a bare
  // `next build` while next.config.mjs still defines `webpack()`, and that hook
  // is kept so rolling back is a single flag change to `--webpack`.
  console.log("Building LITRACK with the standard Next.js build...");
  execSync("prisma generate && next build --turbopack", {
    stdio: "inherit",
    env: process.env,
  });
  if (isOpenNextInnerBuild) {
    // Windows-only repair of Turbopack's absolute external-package links, which
    // otherwise make the Worker load Prisma's Node client; see the script.
    execSync("node scripts/relink-standalone-externals.mjs", {
      stdio: "inherit",
      env: process.env,
    });
  }
}
