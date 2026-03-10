import { fileURLToPath } from "node:url";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from 'vitest/config';

const stackSharedDistPath = fileURLToPath(new URL("./packages/stack-shared/dist/", import.meta.url));
const templateReactPath = fileURLToPath(new URL("./packages/template/node_modules/react/index.js", import.meta.url));
const templateReactJsxRuntimePath = fileURLToPath(new URL("./packages/template/node_modules/react/jsx-runtime.js", import.meta.url));
const templateReactJsxDevRuntimePath = fileURLToPath(new URL("./packages/template/node_modules/react/jsx-dev-runtime.js", import.meta.url));
const templateReactDomPath = fileURLToPath(new URL("./packages/template/node_modules/react-dom/index.js", import.meta.url));
const templateReactDomClientPath = fileURLToPath(new URL("./packages/template/node_modules/react-dom/client.js", import.meta.url));

export default defineConfig({
  plugins: [tsconfigPaths() as any],
  esbuild: {
    jsx: "transform",
    jsxInject: 'import React from "react"',
  },
  resolve: {
    alias: [
      {
        find: /^@stackframe\/stack-shared\/dist\/(.+)$/,
        replacement: `${stackSharedDistPath}$1`,
      },
      {
        find: /^@stackframe\/stack-shared\/(.+)$/,
        replacement: `${stackSharedDistPath}$1`,
      },
      {
        find: "react/jsx-runtime",
        replacement: templateReactJsxRuntimePath,
      },
      {
        find: "react/jsx-dev-runtime",
        replacement: templateReactJsxDevRuntimePath,
      },
      {
        find: "react-dom/client",
        replacement: templateReactDomClientPath,
      },
      {
        find: "react-dom",
        replacement: templateReactDomPath,
      },
      {
        find: "react",
        replacement: templateReactPath,
      },
    ],
  },
  test: {
    watch: false,
    pool: 'threads',
    poolOptions: {
      threads: {
        minThreads: 1,
        maxThreads: 8,
      },
    },
    include: ['**/*.test.{js,ts,jsx,tsx}'],
    includeSource: ['**/*.{js,ts,jsx,tsx}'],
  },
})
