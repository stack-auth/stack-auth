import fs from 'fs';
import path from 'path';
import type { Rolldown } from 'tsdown';
import { findPackageRootFromSource } from './package-root.ts';

const SOURCE_FILE_PATTERN = /\.(jsx?|tsx?)$/;
const USE_CLIENT_DIRECTIVE_PATTERN = /["']use\s+client["']/i;
const USE_CLIENT_AT_TOP_PATTERN = /^\s*["']use\s+client["']\s*;?/;
const CLIENT_VERSION_SENTINEL = 'STACK_COMPILE_TIME_CLIENT_PACKAGE_VERSION_SENTINEL';

export const createBasePlugin = (_options: {}): Rolldown.Plugin => {
  const packageVersionLabels = new Map<string, string>();

  return {
    name: 'stackframe tsdown plugin (private)',
    transform(code: string, id: string) {
      if (!SOURCE_FILE_PATTERN.test(id)) {
        return null;
      }

      let transformedCode = code;
      // The label must come from the package that owns this module, not from the process's cwd: the
      // dev build runs `tsdown --workspace='packages/*'` from the monorepo root, which would otherwise
      // stamp every package's dist with the root package.json (`@hexclave/monorepo@0.0.0`).
      if (code.includes(CLIENT_VERSION_SENTINEL)) {
        const packageRoot = findPackageRootFromSource(id);
        let packageVersionLabel = packageVersionLabels.get(packageRoot);
        if (packageVersionLabel == null) {
          const packageJsonPath = path.join(packageRoot, 'package.json');
          const packageJson: unknown = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
          if (
            typeof packageJson !== 'object'
            || packageJson === null
            || !('name' in packageJson)
            || typeof packageJson.name !== 'string'
            || !('version' in packageJson)
            || typeof packageJson.version !== 'string'
          ) {
            throw new Error(`Expected ${packageJsonPath} to include string name and version fields.`);
          }

          packageVersionLabel = `js ${packageJson.name}@${packageJson.version}`;
          packageVersionLabels.set(packageRoot, packageVersionLabel);
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
