#!/usr/bin/env node
/**
 * PreToolUse guard: a push to main that changes app code must carry a release
 * entry (CLAUDE.md, section Releases).
 *
 * A push to main is a production deploy, and every production deploy tells users
 * what changed through `src/lib/releases.ts`. This blocks a `git push` that
 * targets main when the commits it would send touch `src/` or `prisma/` but not
 * `src/lib/releases.ts`. Docs-, test- and tooling-only pushes pass.
 *
 * Fails open: any error reading the input or running git allows the push. A
 * broken guard must never wedge a deploy, and the decisions it makes are pinned
 * by `tests/unit/release-guard.test.ts` rather than by this wiring.
 *
 * Exit 2 blocks the tool call and hands stderr back to Claude.
 */
import { execFileSync } from "node:child_process";
import {
  BLOCK_MESSAGE,
  lacksReleaseEntry,
  pushSourcesToMain,
} from "./release-guard.mjs";

function git(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

async function readStdin() {
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  // A BOM would make JSON.parse throw, and the guard would fail open on input
  // that is otherwise perfectly readable.
  return data.replace(/^﻿/, "");
}

async function main() {
  try {
    const input = JSON.parse(await readStdin());
    const command = input?.tool_input?.command;
    if (typeof command !== "string") return 0;
    if (!/\bgit\b/.test(command) || !/\bpush\b/.test(command)) return 0;

    const cwd = typeof input.cwd === "string" && input.cwd ? input.cwd : process.cwd();
    let branch = null;
    try {
      branch = git(["symbolic-ref", "--short", "-q", "HEAD"], cwd) || null;
    } catch {
      branch = null;
    }

    for (const src of pushSourcesToMain(command, branch)) {
      const changed = git(["diff", "--name-only", `origin/main...${src}`], cwd)
        .split(/\r?\n/)
        .filter(Boolean);
      if (lacksReleaseEntry(changed)) {
        process.stderr.write(BLOCK_MESSAGE + "\n");
        return 2;
      }
    }
    return 0;
  } catch {
    return 0;
  }
}

process.exit(await main());
