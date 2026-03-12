import fs from 'fs';
import type { Rolldown } from 'tsdown';

const SOURCE_FILE_PATTERN = /\.(jsx?|tsx?)$/;
const USE_CLIENT_DIRECTIVE_PATTERN = /["']use\s+client["']/i;
const USE_CLIENT_AT_TOP_PATTERN = /^\s*["']use\s+client["']\s*;?/;

export const createBasePlugin = (_options: {}): Rolldown.Plugin => {
  const packageJson = JSON.parse(fs.readFileSync("./package.json", "utf-8"));
  const packageVersionLabel = `js ${packageJson.name}@${packageJson.version}`;

  return {
    name: 'stackframe tsdown plugin (private)',
    transform(code: string, id: string) {
      if (!SOURCE_FILE_PATTERN.test(id)) {
        return null;
      }

      let transformedCode = code;
      transformedCode = transformedCode.replace(/STACK_COMPILE_TIME_CLIENT_PACKAGE_VERSION_SENTINEL/g, packageVersionLabel);
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
