import fs from 'fs';
import path from 'path';
import { defineConfig } from 'tsup';

const customNoExternal = new Set([
  "oauth4webapi",
]);

export default function createJsLibraryTsupConfig(options: { barrelFile: boolean }) {
  const packageJson = JSON.parse(fs.readFileSync("./package.json", "utf-8"));
  return defineConfig({
    entryPoints: ['src/**/*.(ts|tsx|js|jsx)'],
    sourcemap: true,
    clean: false,
    noExternal: [...customNoExternal],
    dts: options.barrelFile ? 'src/index.ts' : true,  // we only generate types for the barrel file because it drastically decreases the memory needed for tsup https://github.com/egoist/tsup/issues/920#issuecomment-2454732254
    outDir: 'dist',
    format: ['esm', 'cjs'],
    legacyOutput: true,
    esbuildPlugins: [
      {
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
  
          build.onResolve({ filter: /^.*$/m }, async (args) => {
            if (args.kind === "entry-point" || customNoExternal.has(args.path)) {
              return undefined;
            }
            return {
              external: true,
            };
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
      },
    ],
  });
}
