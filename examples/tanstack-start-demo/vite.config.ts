import fs, { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { nitro } from "nitro/vite";
import tsConfigPaths from "vite-tsconfig-paths";

const tanstackStartPackagePath = fileURLToPath(
  new URL("../../packages/tanstack-start/package.json", import.meta.url),
);
const tanstackStartSourcePath = fileURLToPath(
  new URL("../../packages/tanstack-start/src/index.ts", import.meta.url),
);
const tanstackStartSourceRoot = fileURLToPath(
  new URL("../../packages/tanstack-start/src/", import.meta.url),
);
const stackAuthRootPath = fileURLToPath(new URL("../..", import.meta.url));
const tanstackStartPackageJson = JSON.parse(
  readFileSync(tanstackStartPackagePath, "utf-8"),
) as { name: string, version: string };

function stackSdkSourceTransforms(): Plugin {
  const packageVersionLabel = `js ${tanstackStartPackageJson.name}@${tanstackStartPackageJson.version}`;

  return {
    name: "stack-sdk-source-transforms",
    enforce: "pre",
    transform(code, id) {
      if (!id.startsWith(tanstackStartSourceRoot)) {
        return null;
      }

      const transformedCode = code
        .replace(/STACK_COMPILE_TIME_CLIENT_PACKAGE_VERSION_SENTINEL/g, packageVersionLabel)
        .replace(/import\.meta\.vitest/g, "undefined");

      if (transformedCode === code) {
        return null;
      }

      return {
        code: transformedCode,
        map: null,
      };
    },
  };
}

function tanStackStartServerBrowserStub(): Plugin {
  const virtualModuleId = "\0tanstack-start-server-browser-stub";

  return {
    name: "tanstack-start-server-browser-stub",
    enforce: "pre",
    resolveId(source, _importer, options) {
      if (source === "@tanstack/react-start/server" && !options.ssr) {
        return virtualModuleId;
      }

      return null;
    },
    load(id) {
      if (id !== virtualModuleId) {
        return null;
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
      `;
    },
  };
}

function watchNodeModules(modules: string[]): Plugin {
  return {
    name: "watch-node-modules",
    config() {
      return {
        server: {
          watch: {
            ignored: modules.map((moduleName) => `!**/node_modules/${moduleName}/**`),
          },
        },
      };
    },
  };
}

function waitForWorkspacePackages(packages: string[]): Plugin {
  const packageDistEntries = packages.map((pkg) => ({
    name: pkg,
    entry: path.resolve(__dirname, "node_modules", pkg, "dist", "esm", "index.js"),
  }));

  async function waitForFile(filePath: string, timeoutMs = 60_000): Promise<void> {
    if (fs.existsSync(filePath)) return;
    const start = performance.now();
    return await new Promise((resolve, reject) => {
      const interval = setInterval(() => {
        if (fs.existsSync(filePath)) {
          clearInterval(interval);
          resolve();
        } else if (performance.now() - start > timeoutMs) {
          clearInterval(interval);
          reject(new Error(`Timed out waiting for ${filePath} to exist`));
        }
      }, 500);
    });
  }

  return {
    name: "wait-for-workspace-packages",
    enforce: "pre",
    async buildStart() {
      const missing = packageDistEntries.filter((pkg) => !fs.existsSync(pkg.entry));
      if (missing.length === 0) return;
      console.log(`Waiting for workspace packages to build: ${missing.map((pkg) => pkg.name).join(", ")}`);
      await Promise.all(missing.map((pkg) => waitForFile(pkg.entry)));
      console.log("All workspace packages are ready.");
    },
  };
}

export default defineConfig({
  server: {
    port: Number(`${process.env.NEXT_PUBLIC_STACK_PORT_PREFIX || "81"}42`),
    fs: {
      allow: [stackAuthRootPath],
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.startsWith(tanstackStartSourceRoot)) {
            return "stack-auth-sdk";
          }
          return undefined;
        },
      },
    },
  },
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: {
      "@stackframe/tanstack-start": tanstackStartSourcePath,
    },
  },
  ssr: {
    noExternal: [/^@stackframe\//, /^@radix-ui\//],
  },
  optimizeDeps: {
    include: ["@stackframe/stack-shared", "@stackframe/stack-shared/config"],
  },
  plugins: [
    stackSdkSourceTransforms(),
    tanStackStartServerBrowserStub(),
    waitForWorkspacePackages(["@stackframe/tanstack-start", "@stackframe/stack-shared", "@stackframe/stack-ui"]),
    watchNodeModules(["@stackframe/tanstack-start", "@stackframe/stack-shared", "@stackframe/stack-ui"]),
    tsConfigPaths(),
    tanstackStart(),
    nitro(),
    viteReact(),
  ],
});
