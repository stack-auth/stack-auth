"use server";

/**
 * Server-only helpers for evaluating config file content via jiti.
 *
 * This file is marked "use server" so Next.js keeps it out of the client
 * bundle.  `evaluateConfigContent` writes the content string to a temp file,
 * runs `jiti.import()` on it, and returns the exported `config` value — all
 * of which require Node.js APIs (fs, os, path).
 */

import { createJiti } from "jiti";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";

const jiti = createJiti(import.meta.url, { moduleCache: false });

type ConfigModule = {
  config?: unknown,
};

function isConfigModule(value: unknown): value is ConfigModule {
  return value !== null && typeof value === "object";
}

/**
 * Evaluates a config file content string by writing it to a temp file and
 * importing it with jiti. Returns the exported config value.
 */
export async function evaluateConfigContent(content: string): Promise<unknown> {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "hexclave-config-"));
  const tempFile = path.join(tempDir, "stack.config.ts");
  writeFileSync(tempFile, content, "utf-8");
  try {
    const configModule = await jiti.import<unknown>(tempFile);
    if (!isConfigModule(configModule)) {
      throw new Error("The config file must export a plain `config` object or \"show-onboarding\".");
    }
    return configModule.config;
  } finally {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  }
}
