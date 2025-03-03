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
  dts: {
    // Ignore unused ts-expect-error directives
    compilerOptions: {
      skipLibCheck: true,
      ignoreDeprecations: "5.0"
    }
  },
  outDir: 'dist',
  format: ['esm', 'cjs'],
  legacyOutput: true,
  esbuildOptions(options) {
    // Handle import.meta.vitest in CJS format
    if (options.format === 'cjs') {
      options.define = {
        ...options.define,
        'import.meta.vitest': 'undefined',
      };
    }
  },
  esbuildPlugins: [
    {
      name: 'stackframe tsup plugin (private)',
      setup(build) {
        build.onEnd(result => {
          const sourceFiles = result.outputFiles?.filter(file => !file.path.endsWith('.map')) ?? [];
          for (const file of sourceFiles) {
            const fileText = new TextDecoder().decode(file.contents);
            const matchUseClient = /[\s\n\r]*(^|\n|\r|;)\s*['"]use\s+client['"]\s*(\n|\r|;)/im;
            if (matchUseClient.test(fileText)) {
              file.contents = new TextEncoder().encode(`"use client";\n${fileText}`);
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
