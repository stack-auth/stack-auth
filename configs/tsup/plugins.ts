import type { Plugin } from "esbuild";
import fs from 'fs';
import path from "path";

export const createBasePlugin = (options: {}): Plugin => {
  const packageJson = JSON.parse(fs.readFileSync("./package.json", "utf-8"));
  return {
    name: 'stackframe tsup plugin (private)',
    setup(build) {
      build.onEnd(result => {
        const sourceFiles = result.outputFiles?.filter(file => !file.path.endsWith('.map')) ?? [];
        for (const file of sourceFiles) {
          let newText = file.text;

          // make sure "use client" is at the top of the file
          const matchUseClient = /[\s\n\r]*(^|\n|\r|;)\s*['"]use\s+client['"]\s*(\n|\r|;)/im;
          if (matchUseClient.test(file.text)) {
            newText = `"use client";\n${file.text}`;
          }

          file.contents = new TextEncoder().encode(newText);
        }
      });

      build.onLoad({ filter: /\.(jsx?|tsx?)$/ }, async (args) => {
        let contents = await fs.promises.readFile(args.path, 'utf8');
        contents = contents.replace(/STACK_COMPILE_TIME_CLIENT_PACKAGE_VERSION_SENTINEL/g, `js ${packageJson.name}@${packageJson.version}`);
        contents = contents.replace(/import\.meta\.vitest/g, 'undefined');
        return {
          contents,
          loader: path.extname(args.path).slice(1) as 'js' | 'jsx' | 'ts' | 'tsx'
        };
      });
    },
  }
}
