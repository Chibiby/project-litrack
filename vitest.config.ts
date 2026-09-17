import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Next 16 rewrites tsconfig.json to jsx: "react-jsx" (it was "preserve" on
  // Next 15, which esbuild does not understand and so fell back to the classic
  // transform — "React is not defined"). Kept explicit so tests do not depend
  // on whatever tsconfig value the next Next upgrade writes.
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
