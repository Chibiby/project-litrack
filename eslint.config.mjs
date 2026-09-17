import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Flat-config port of the former `.eslintrc.json`
// (`extends: ["next/core-web-vitals", "next/typescript"]` + the two rule
// overrides below). `next lint` was removed in Next 16; `npm run lint` now runs
// `eslint src`, which is the only one of `next lint`'s default directories
// (app, pages, components, lib, src) that exists in this repo.
//
// A flat config does not cascade into parent directories, so the old
// `.claude/worktrees/*` "plugin was conflicted" failure no longer applies.
export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // `next lint` never reported unused eslint-disable directives; the ESLint
    // CLI warns by default. Keep the pre-upgrade behavior.
    linterOptions: { reportUnusedDisableDirectives: "off" },
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
      // eslint-config-next 16 ships eslint-plugin-react-hooks 7, whose
      // `recommended` set adds the React Compiler rules. Every one of them stays
      // at its default EXCEPT these three, which had existing violations at the
      // time of the Next 16 upgrade (34 / 13 / 2 sites). They are warnings, not
      // off, so the sites stay visible; fix them and delete these lines — they
      // are also the React Compiler readiness list.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/purity": "warn",
    },
  },
  // Default ignores of eslint-config-next, restated so they survive overrides.
  globalIgnores([".next/**", ".next-verify/**", ".open-next/**", "out/**", "build/**", "next-env.d.ts"]),
]);
