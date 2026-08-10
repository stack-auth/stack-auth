import fs from 'fs';
import type { Rolldown } from 'tsdown';

const SOURCE_FILE_PATTERN = /\.(jsx?|tsx?)$/;
const USE_CLIENT_DIRECTIVE_PATTERN = /["']use\s+client["']/i;
const USE_CLIENT_AT_TOP_PATTERN = /^\s*["']use\s+client["']\s*;?/;
const CLIENT_VERSION_SENTINEL = 'STACK_COMPILE_TIME_CLIENT_PACKAGE_VERSION_SENTINEL';

export const createBasePlugin = (_options: {}): Rolldown.Plugin => {
  let packageVersionLabel: string | undefined;

  return {
    name: 'stackframe tsdown plugin (private)',
    buildStart(options: Rolldown.NormalizedInputOptions) {
      // Workspace builds run from the monorepo root, but Rolldown's per-config cwd is the package root.
      const packageJson: unknown = JSON.parse(fs.readFileSync(`${options.cwd}/package.json`, 'utf-8'));
      if (
        typeof packageJson !== 'object'
        || packageJson == null
        || !('name' in packageJson)
        || typeof packageJson.name !== 'string'
        || !('version' in packageJson)
        || typeof packageJson.version !== 'string'
      ) {
        throw new Error(`Expected ${options.cwd}/package.json to include string name and version fields.`);
      }
      packageVersionLabel = `js ${packageJson.name}@${packageJson.version}`;
    },
    transform(code: string, id: string) {
      if (!SOURCE_FILE_PATTERN.test(id)) {
        return null;
      }

      let transformedCode = code;
      if (code.includes(CLIENT_VERSION_SENTINEL)) {
        if (packageVersionLabel == null) {
          throw new Error('Expected tsdown buildStart to resolve the package version before transform.');
        }
        transformedCode = transformedCode.replaceAll(CLIENT_VERSION_SENTINEL, packageVersionLabel);
      }
      transformedCode = transformedCode.replace(/import\.meta\.vitest/g, 'undefined');

      if (USE_CLIENT_DIRECTIVE_PATTERN.test(transformedCode) && !USE_CLIENT_AT_TOP_PATTERN.test(transformedCode)) {
        transformedCode = `"use client";\n${transformedCode}`;
      }

      if (transformedCode === code) {
        return null;
      }

      return {
        code: transformedCode,
        map: null,
      };
    },
  };
};
