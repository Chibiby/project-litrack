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

// Heuristic: any of these identifiers appearing anywhere in a route.ts file's
// source text is treated as evidence the file gates access somehow (a real
// session check, a cron shared-secret check, or at minimum abuse-rate
// limiting). This is intentionally a text search, not an AST check for a call
// at the top of the handler, because handlers wrap auth in helpers
// (`route()`, `action()`) and via imports re-exported under other names.
const AUTH_CHECK_PATTERN = /getCurrentUser|requireUser|requireAdminScope|CRON_SECRET|rateLimit/i;

const litrackPlugin = {
  rules: {
    "api-route-auth-check": {
      meta: {
        type: "problem",
        docs: {
          description:
            "Guard-rail: src/app/api/**/route.ts must reference a recognized auth check " +
            "(getCurrentUser, requireUser, requireAdminScope, CRON_SECRET, or rate limiting). " +
            "If a route is intentionally open, disable this rule inline with a comment " +
            "explaining why (e.g. // eslint-disable-next-line litrack/api-route-auth-check -- public, rate-limited endpoint).",
        },
        schema: [],
        messages: {
          missing:
            "This API route has no visible auth check (getCurrentUser/requireUser/requireAdminScope/CRON_SECRET/rateLimit). " +
            "If it is intentionally open, add an inline eslint-disable comment explaining why.",
        },
      },
      create(context) {
        return {
          Program(node) {
            const sourceCode = context.sourceCode ?? context.getSourceCode();
            if (!AUTH_CHECK_PATTERN.test(sourceCode.getText())) {
              context.report({ node, messageId: "missing" });
            }
          },
        };
      },
    },
  },
};

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
    },
  },
  {
    // Guard-rail #1: flag (don't fail) any src file that has grown past a
    // size where a single reviewer can hold the whole thing in their head.
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "max-lines": ["warn", { max: 900, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    // Guard-rail #2: flag (don't fail) API route handlers with no visible
    // auth gate. See AUTH_CHECK_PATTERN above for what counts as evidence.
    files: ["src/app/api/**/route.ts"],
    plugins: { litrack: litrackPlugin },
    rules: {
      "litrack/api-route-auth-check": "warn",
    },
  },
  // Default ignores of eslint-config-next, restated so they survive overrides.
  globalIgnores([".next/**", ".next-verify/**", ".open-next/**", "out/**", "build/**", "next-env.d.ts"]),
]);
