import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // tsconfig.json sets jsx: "preserve" (Next.js/SWC handles the actual
  // transform outside tsc). esbuild doesn't understand "preserve", so
  // without this it falls back to the classic transform and JSX-using
  // test/component files fail with "React is not defined".
  esbuild: {
    jsx: "automatic",
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    // Component tests need a DOM; pure-logic tests stay on the faster node env.
    environmentMatchGlobs: [["tests/components/**", "jsdom"]],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "server-only": path.resolve(__dirname, "./tests/mocks/server-only.ts"),
    },
  },
});
