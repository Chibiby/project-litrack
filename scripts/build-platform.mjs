import { execSync } from "node:child_process";

const isCloudflareWorkersBuild = process.env.WORKERS_CI === "1";
const isOpenNextInnerBuild = process.env.OPENNEXT_INNER_BUILD === "1";

if (isCloudflareWorkersBuild && !isOpenNextInnerBuild) {
  console.log("Installing Cloudflare Workers build tooling locally...");
  execSync(
    "npm install --no-save --no-package-lock --legacy-peer-deps @opennextjs/cloudflare@1.20.6 wrangler@4.131.1",
    {
      stdio: "inherit",
      env: process.env,
    },
  );

  console.log("Building LITRACK for Cloudflare Workers with OpenNext...");
  execSync("npx opennextjs-cloudflare build", {
    stdio: "inherit",
    env: {
      ...process.env,
      OPENNEXT_INNER_BUILD: "1",
    },
  });
} else {
  console.log("Building LITRACK with the standard Next.js build...");
  execSync("prisma generate && next build", {
    stdio: "inherit",
    env: process.env,
  });
}
