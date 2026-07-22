// Packages a source directory into a gzipped ustar tarball for
// `hexclave deploy`. Respects .gitignore and .vercelignore files (at every
// directory level, like git), and always drops node_modules, .git, and
// symlinks. The output is deterministic for identical input trees (sorted
// entries, fixed mtime in the tar writer), which makes retried deploys upload
// byte-identical tarballs.

import { createTar, type TarEntry } from "@hexclave/shared/dist/utils/tar";
import { StatusError } from "@hexclave/shared/dist/utils/errors";
import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { CliError } from "./errors.js";
import { type IgnoreRule, parseIgnoreFile } from "./ignore-rules.js";

const IGNORE_FILE_NAMES = [".gitignore", ".vercelignore"];
const ALWAYS_EXCLUDED_DIR_NAMES = new Set(["node_modules", ".git"]);

type IgnoreScope = {
  // Path of the directory the rules are anchored at, relative to the package
  // root ("" for the root itself), POSIX separators.
  base: string,
  rules: IgnoreRule[],
};

function relativeToScope(scope: IgnoreScope, relativePath: string): string {
  return scope.base === "" ? relativePath : relativePath.slice(scope.base.length + 1);
}

function isIgnored(scopes: IgnoreScope[], relativePath: string, isDirectory: boolean): boolean {
  // Deeper ignore files take precedence, mirroring git: evaluate scopes
  // outermost-first and let later (deeper) matches override earlier ones.
  let ignored = false;
  for (const scope of scopes) {
    const scopedPath = relativeToScope(scope, relativePath);
    for (const rule of scope.rules) {
      if (rule.dirOnly && !isDirectory) continue;
      if (rule.regex.test(scopedPath)) {
        ignored = !rule.negated;
      }
    }
  }
  return ignored;
}

export type PackagedSource = {
  tarballGzipped: Buffer,
  fileCount: number,
  totalBytes: number,
};

export function packageSourceDirectory(rootDirectory: string): PackagedSource {
  const rootStat = fs.statSync(rootDirectory, { throwIfNoEntry: false });
  if (rootStat == null || !rootStat.isDirectory()) {
    throw new CliError(`Source directory not found: ${rootDirectory}`);
  }

  const entries: TarEntry[] = [];
  let totalBytes = 0;

  const walk = (absoluteDir: string, relativeDir: string, parentScopes: IgnoreScope[]) => {
    const scopes = [...parentScopes];
    for (const ignoreFileName of IGNORE_FILE_NAMES) {
      const ignoreFilePath = path.join(absoluteDir, ignoreFileName);
      if (fs.existsSync(ignoreFilePath) && fs.statSync(ignoreFilePath).isFile()) {
        scopes.push({ base: relativeDir, rules: parseIgnoreFile(fs.readFileSync(ignoreFilePath, "utf-8")) });
      }
    }

    const dirents = fs.readdirSync(absoluteDir, { withFileTypes: true })
      .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    for (const dirent of dirents) {
      const relativePath = relativeDir === "" ? dirent.name : `${relativeDir}/${dirent.name}`;
      const absolutePath = path.join(absoluteDir, dirent.name);
      if (dirent.isSymbolicLink()) {
        // Symlinks are dropped: our tar subset doesn't represent them, and
        // following them risks packaging files outside the source directory.
        continue;
      }
      if (dirent.isDirectory()) {
        if (ALWAYS_EXCLUDED_DIR_NAMES.has(dirent.name)) continue;
        if (isIgnored(scopes, relativePath, true)) continue;
        walk(absolutePath, relativePath, scopes);
      } else if (dirent.isFile()) {
        if (isIgnored(scopes, relativePath, false)) continue;
        const data = fs.readFileSync(absolutePath);
        totalBytes += data.length;
        entries.push({ path: relativePath, data });
      }
      // Sockets, FIFOs, devices: silently skipped.
    }
  };

  walk(rootDirectory, "", []);

  if (entries.length === 0) {
    throw new CliError(`No files to deploy in ${rootDirectory} (everything is ignored or the directory is empty).`);
  }

  let tarball;
  try {
    tarball = createTar(entries);
  } catch (error) {
    if (error instanceof StatusError) {
      // The shared tar writer throws StatusError (it also runs on the
      // backend); in the CLI that class isn't handled by main()'s
      // CliError/AuthError catch and would crash with a Sentry report, so
      // rewrap it as a normal user-facing CLI error.
      throw new CliError(error.message);
    }
    throw error;
  }
  return {
    tarballGzipped: gzipSync(tarball),
    fileCount: entries.length,
    totalBytes,
  };
}
