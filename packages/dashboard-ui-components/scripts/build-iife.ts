import * as esbuild from 'esbuild';
import * as path from 'node:path';

const JSX_RUNTIME_SHIM = `
import React from "react";
// jsx(type, props, key) differs from createElement(type, props, ...children):
// the third arg in jsx is the key, but in createElement it's treated as children.
// We must merge the key into props instead of passing it as a positional arg.
export function jsx(type, props, key) {
  return React.createElement(type, key !== undefined ? Object.assign({}, props, { key }) : props);
}
export function jsxs(type, props, key) {
  return React.createElement(type, key !== undefined ? Object.assign({}, props, { key }) : props);
}
export function jsxDEV(type, props, key) {
  return React.createElement(type, key !== undefined ? Object.assign({}, props, { key }) : props);
}
export var Fragment = React.Fragment;
`;

const externals: Record<string, string> = {
  'react': 'globalThis.React',
  'react-dom': 'globalThis.ReactDOM',
  'react-dom/client': 'globalThis.ReactDOM',
  'recharts': 'globalThis.Recharts',
};

const externalizeToGlobals: esbuild.Plugin = {
  name: 'externalize-to-globals',
  setup(build) {
    for (const [mod, global] of Object.entries(externals)) {
      const filter = new RegExp(`^${mod.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
      build.onResolve({ filter }, (args) => ({
        path: args.path,
        namespace: `global-${mod}`,
      }));
      build.onLoad({ filter: /.*/, namespace: `global-${mod}` }, () => ({
        contents: `module.exports = ${global};`,
        loader: 'js',
      }));
    }

    const jsxFilter = /^react\/jsx(-dev)?-runtime$/;
    build.onResolve({ filter: jsxFilter }, (args) => ({
      path: args.path,
      namespace: 'jsx-shim',
    }));
    build.onLoad({ filter: /.*/, namespace: 'jsx-shim' }, () => ({
      contents: JSX_RUNTIME_SHIM,
      loader: 'js',
    }));
  },
};

async function main() {
  const pkgDir = path.resolve(__dirname, '..');

  await esbuild.build({
    entryPoints: [path.join(pkgDir, 'src/index.ts')],
    bundle: true,
    format: 'iife',
    globalName: 'DashboardUI',
    outfile: path.join(pkgDir, 'dist/dashboard-ui-components.global.js'),
    sourcemap: true,
    platform: 'browser',
    target: 'es2021',
    jsx: 'automatic',
    plugins: [externalizeToGlobals],
    define: {
      'process.env.NODE_ENV': '"production"',
    },
    banner: {
      js: 'if(typeof process==="undefined"){globalThis.process={env:{NODE_ENV:"production"}};}',
    },
    absWorkingDir: pkgDir,
    nodePaths: [path.join(pkgDir, 'node_modules')],
    logLevel: 'info',
  });

  console.log('[build-iife] IIFE bundle built successfully');
}

main().catch((err) => {
  console.error('[build-iife] Failed:', err);
  process.exit(1);
});
