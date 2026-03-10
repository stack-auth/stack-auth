import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { defineConfig, mergeConfig } from "vitest/config";
import sharedConfig from "../../vitest.shared";

const templateReactPath = fileURLToPath(new URL("../../packages/template/node_modules/react/index.js", import.meta.url));
const templateReactJsxRuntimePath = fileURLToPath(new URL("../../packages/template/node_modules/react/jsx-runtime.js", import.meta.url));
const templateReactJsxDevRuntimePath = fileURLToPath(new URL("../../packages/template/node_modules/react/jsx-dev-runtime.js", import.meta.url));
const templateReactDomPath = fileURLToPath(new URL("../../packages/template/node_modules/react-dom/index.js", import.meta.url));
const templateReactDomClientPath = fileURLToPath(new URL("../../packages/template/node_modules/react-dom/client.js", import.meta.url));

export default mergeConfig(
  sharedConfig,
  defineConfig({
    test: {
      testTimeout: 20000,
      env: {
        ...loadEnv("", process.cwd(), ""),
        ...loadEnv("development", process.cwd(), ""),
      },
      setupFiles: ["./vitest.setup.ts"],
    },
    resolve: {
      alias: [
        {
          find: /^@\/(.+)$/,
          replacement: `${resolve(__dirname, "./src")}/$1`,
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
    envDir: __dirname,
    envPrefix: "STACK_",
  }),
);
