
const customNoExternal = new Set([
  "oauth4webapi",
]);

const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf-8'));


const stackframePlugin =  {
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
};
// https://github.com/egoist/tsup/issues/953
const fixImportExtensions = (extension: string = ".js")  => ({
  name: "fix-import-extensions",
  setup(build) {
    build.onResolve({ filter: /.*/ }, (args) => {
      if (args.importer) {
        const filePathWithExtension = path.join(args.resolveDir, args.path) + ".ts";
        let resolvedPath;
        
        if (fs.existsSync(filePathWithExtension + ".ts")) {
          resolvedPath = args.path + extension;
        } 
        else if (fs.existsSync(filePathWithExtension + ".tsx")) {
          resolvedPath = args.path + extension;
        }
        else if (path.join(args.resolveDir, args.path, `index.ts`)) {
          resolvedPath = args.path.endsWith("/") ? args.path + "index" + extension : args.path + "/index" + extension;
        }
        else if (path.join(args.resolveDir, args.path, `index.tsx`)) {
          resolvedPath = args.path.endsWith("/") ? args.path + "index" + extension : args.path + "/index" + extension;
        }
        return { path: resolvedPath ?? args.path, external: true };
      }
    });
  },
});


const commonOptions: Options = {
  entryPoints: ['src/**/*.(ts|tsx|js|jsx)'],
  sourcemap: true,
  clean: false,
  noExternal: [...customNoExternal],
  dts: 'src/index.ts',  // we only generate types for the barrel file because it drastically decreases the memory needed for tsup https://github.com/egoist/tsup/issues/920#issuecomment-2454732254
  outDir: 'dist',
  legacyOutput: true,
}

const config: Options[] = [
  {
    ...commonOptions,
    format: ['esm'],
    esbuildPlugins: [
      fixImportExtensions(),
      stackframePlugin
    ],
  },
  {
    ...commonOptions,
    format: ['cjs'],
    esbuildPlugins: [
      stackframePlugin
    ],
  },
]

export default defineConfig(config);
