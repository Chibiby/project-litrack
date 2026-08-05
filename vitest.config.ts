import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["node_modules", ".next", "e2e/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Allow importing modules that use `import "server-only"` in unit tests.
      "server-only": path.resolve(__dirname, "./test/stubs/server-only.ts"),
    },
  },
});
