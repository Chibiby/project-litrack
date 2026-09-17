/**
 * Rewrite absolute symlinks in `.next/standalone/.next/node_modules` as
 * relative links into the standalone copy of `node_modules`.
 *
 * Next 16 (Turbopack) links each server-external package it hashed — e.g.
 * `@prisma/client-2c3a283f134fdcb6` — into `.next/node_modules`. On POSIX the
 * link is relative; on Windows it is absolute and points back at the checkout's
 * own `node_modules`. OpenNext's Cloudflare bundler cannot follow that absolute
 * link, resolves `@prisma/client` to its Node entry instead of the `workerd`
 * one, and the deployed Worker fails every query with
 * `no such file or directory, readAll '/bundle/node_modules/.prisma/client/query_compiler_bg.wasm'`.
 *
 * Relinking to the path a POSIX build would have produced makes a Windows build
 * bundle Prisma's Workers client again. A no-op when the directory is missing
 * or every link is already relative (POSIX, webpack builds).
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const standalone = path.join(root, ".next", "standalone");
const base = path.join(standalone, ".next", "node_modules");

function relink(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const linkPath = path.join(dir, entry.name);
    let target;
    try {
      target = fs.readlinkSync(linkPath);
    } catch {
      if (entry.isDirectory()) relink(linkPath);
      continue;
    }
    if (!path.isAbsolute(target)) continue;

    const standaloneTarget = path.join(standalone, path.relative(root, target));
    if (!fs.existsSync(standaloneTarget)) {
      throw new Error(
        `relink-standalone-externals: ${path.relative(root, linkPath)} points at ${target}, which has no copy in .next/standalone`,
      );
    }
    fs.unlinkSync(linkPath);
    fs.symlinkSync(path.relative(dir, standaloneTarget), linkPath, "dir");
    console.log(
      `[relink-standalone-externals] ${path.relative(root, linkPath)} -> ${fs.readlinkSync(linkPath)}`,
    );
  }
}

if (fs.existsSync(base)) relink(base);
