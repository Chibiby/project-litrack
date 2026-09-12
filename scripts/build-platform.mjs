import { execSync } from "node:child_process";

const isCloudflareWorkersBuild = process.env.WORKERS_CI === "1";

const command = isCloudflareWorkersBuild
  ? "npx prisma generate && npx --yes --package=wrangler@4.131.1 --package=@opennextjs/cloudflare@1.20.6 opennextjs-cloudflare build"
  : "prisma generate && next build";

console.log(
  isCloudflareWorkersBuild
    ? "Building LITRACK for Cloudflare Workers with OpenNext..."
    : "Building LITRACK for the standard Next.js/Vercel runtime...",
);

execSync(command, {
  stdio: "inherit",
  env: process.env,
});
