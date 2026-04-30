import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"
import { devtools } from "@tanstack/devtools-vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import viteTsConfigPaths from "vite-tsconfig-paths"
import tailwindcss from "@tailwindcss/vite"
import { nitro } from "nitro/vite"
import type { Plugin } from "vite"

const tanstackStartPackagePath = fileURLToPath(
  new URL("../../packages/tanstack-start/package.json", import.meta.url),
)
const tanstackStartSourcePath = fileURLToPath(
  new URL("../../packages/tanstack-start/src/index.ts", import.meta.url),
)
const tanstackStartSourceRoot = fileURLToPath(
  new URL("../../packages/tanstack-start/src/", import.meta.url),
)
const agentDevtoolsReactSourcePath = fileURLToPath(
  new URL("../../../../tanstack-start-dev-tool-mcp/packages/react/src/index.tsx", import.meta.url),
)
const agentDevtoolsSharedSourcePath = fileURLToPath(
  new URL("../../../../tanstack-start-dev-tool-mcp/packages/shared/src/index.ts", import.meta.url),
)
const agentDevtoolsRootPath = fileURLToPath(
  new URL("../../../../tanstack-start-dev-tool-mcp", import.meta.url),
)
const stackAuthRootPath = fileURLToPath(
  new URL("../..", import.meta.url),
)
const tanstackStartPackageJson = JSON.parse(
  readFileSync(tanstackStartPackagePath, "utf-8"),
) as { name: string; version: string }

function stackSdkSourceTransforms(): Plugin {
  const packageVersionLabel = `js ${tanstackStartPackageJson.name}@${tanstackStartPackageJson.version}`

  return {
    name: "stack-sdk-source-transforms",
    enforce: "pre",
    transform(code, id) {
      if (!id.startsWith(tanstackStartSourceRoot)) {
        return null
      }

      const transformedCode = code
        .replace(
          /STACK_COMPILE_TIME_CLIENT_PACKAGE_VERSION_SENTINEL/g,
          packageVersionLabel,
        )
        .replace(/import\.meta\.vitest/g, "undefined")

      if (transformedCode === code) {
        return null
      }

      return {
        code: transformedCode,
        map: null,
      }
    },
  }
}

function tanStackStartServerBrowserStub(): Plugin {
  const virtualModuleId = "\0tanstack-start-server-browser-stub"

  return {
    name: "tanstack-start-server-browser-stub",
    enforce: "pre",
    resolveId(source, _importer, options) {
      if (source === "@tanstack/react-start/server" && !options.ssr) {
        return virtualModuleId
      }

      return null
    },
    load(id) {
      if (id !== virtualModuleId) {
        return null
      }

      return `
        const throwServerOnly = () => {
          throw new Error("@tanstack/react-start/server was called from the browser bundle");
        };

        export const getCookie = throwServerOnly;
        export const getCookies = throwServerOnly;
        export const setCookie = throwServerOnly;
        export const deleteCookie = throwServerOnly;
        export const getRequestHeader = throwServerOnly;
      `
    },
  }
}

const config = defineConfig({
  // Use Vite's default `VITE_` prefix only. We deliberately do NOT expose
  // `STACK_*` to the client bundle — that prefix is reserved for server-only
  // secrets (e.g. STACK_SECRET_SERVER_KEY), which must only be read from
  // `process.env` inside TanStack Start server functions.
  envPrefix: ["VITE_"],
  ssr: {
    // Workspace packages need to be bundled for SSR — Vite would otherwise
    // try to externalize them and fail because their entry shape (CJS-first
    // with an `exports` map and many transitive subpath imports) confuses
    // Node's resolver in the SSR runtime. Catch all @stackframe/* packages.
    noExternal: [/^@stackframe\//, /^@radix-ui\//],
  },
  optimizeDeps: {
    // Keep shared packages pre-bundled, but leave the TanStack Start SDK itself
    // on the source alias so Vite can split client-safe imports from server-only
    // TanStack Start helpers during dev.
    include: [
      "@stackframe/stack-shared",
      "@stackframe/stack-shared/config",
    ],
  },
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: {
      "@stackframe/tanstack-start": tanstackStartSourcePath,
      "@barreloflube/tanstack-start-dev-tool-mcp-react": agentDevtoolsReactSourcePath,
      "@barreloflube/tanstack-start-dev-tool-mcp-shared": agentDevtoolsSharedSourcePath,
    },
  },
  server: {
    fs: {
      allow: [stackAuthRootPath, agentDevtoolsRootPath],
    },
  },
  plugins: [
    stackSdkSourceTransforms(),
    tanStackStartServerBrowserStub(),
    devtools(),
    nitro(),
    // this is the plugin that enables path aliases
    viteTsConfigPaths({
      projects: ["./tsconfig.json"],
    }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
})

export default config
