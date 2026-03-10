import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig } from 'vitest/config'
import sharedConfig from '../../vitest.shared'

const templateReactPath = fileURLToPath(new URL("./node_modules/react/index.js", import.meta.url));
const templateReactJsxRuntimePath = fileURLToPath(new URL("./node_modules/react/jsx-runtime.js", import.meta.url));
const templateReactJsxDevRuntimePath = fileURLToPath(new URL("./node_modules/react/jsx-dev-runtime.js", import.meta.url));
const templateReactDomPath = fileURLToPath(new URL("./node_modules/react-dom/index.js", import.meta.url));
const templateReactDomClientPath = fileURLToPath(new URL("./node_modules/react-dom/client.js", import.meta.url));

export default mergeConfig(
  sharedConfig,
  defineConfig({
    resolve: {
      alias: {
        "react/jsx-runtime": templateReactJsxRuntimePath,
        "react/jsx-dev-runtime": templateReactJsxDevRuntimePath,
        "react-dom/client": templateReactDomClientPath,
        "react-dom": templateReactDomPath,
        react: templateReactPath,
      },
    },
  }),
)
