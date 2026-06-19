import { existsSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { defineConfig, mergeConfig } from "vitest/config";
import sharedConfig from "../../vitest.shared";

const backendDir = resolve(__dirname, "../backend");

function expandEnvValue(value: string, env: Record<string, string>): string {
  return value.replace(/\$\{([A-Z0-9_]+)(?::-([^}]*))?\}/g, (_match, name: string, fallback: string | undefined) => {
    return env[name] ?? process.env[name] ?? fallback ?? "";
  });
}

function unquoteEnvValue(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function loadEnvFiles(dir: string, filenames: string[]): Record<string, string> {
  const env: Record<string, string> = {};
  for (const filename of filenames) {
    const path = join(dir, filename);
    if (!existsSync(path)) {
      continue;
    }
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (match == null) {
        continue;
      }
      const [, key, rawValue] = match;
      if (key == null || rawValue == null) {
        continue;
      }
      env[key] = expandEnvValue(unquoteEnvValue(rawValue), env);
    }
  }
  return env;
}

export default mergeConfig(
  sharedConfig,
  defineConfig({
    test: {
      testTimeout: 60000,
      hookTimeout: 60000,
      poolOptions: {
        threads: {
          minThreads: 1,
          maxThreads: 8,
        },
      },
      env: loadEnvFiles(backendDir, [".env", ".env.development", ".env.development.local"]),
    },
    envDir: backendDir,
    envPrefix: ["STACK_", "HEXCLAVE_"],
  }),
);
