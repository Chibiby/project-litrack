import path from "node:path";
import { defineConfig } from "vitest/config";

// Opt-in database lane. Run through `npm run test:db`, which builds a local
// Postgres and sets DATABASE_URL. Never part of the default `npm run test`.
export default defineConfig({
  esbuild: {
    jsx: "automatic",
  },
  test: {
    environment: "node",
    include: ["tests/db/**/*.test.ts"],
    // One shared database: files must not interleave their truncates.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "server-only": path.resolve(__dirname, "./tests/mocks/server-only.ts"),
    },
  },
});
