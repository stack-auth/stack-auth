import fs from 'fs';
import path from 'path';
import { defineConfig, Options } from 'tsup';

const customNoExternal = new Set([
  "oauth4webapi",
]);

const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf-8'));

const config: Options = {
  entryPoints: ['src/**/*.(ts|tsx|js|jsx)'],
  sourcemap: true,
  clean: false,
  noExternal: [...customNoExternal],
  dts: 'src/index.ts',  // we only generate types for the barrel file because it drastically decreases the memory needed for tsup https://github.com/egoist/tsup/issues/920#issuecomment-2454732254
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
            const matchUseClient = /[\s\n\r]*(^|\n|\r|;)\s*['"]use\s+client['"]\s*(\n|\r|;)/im;
            if (matchUseClient.test(file.text)) {
              file.contents = new TextEncoder().encode(`"use client";\n${file.text}`);
            }
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
          return {
            contents,
            loader: path.extname(args.path).slice(1) as 'js' | 'jsx' | 'ts' | 'tsx'
          };
        });
      },
    },
  ],
};

export default defineConfig(config);
