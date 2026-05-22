import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { nitro } from "nitro/vite";
import tsConfigPaths from "vite-tsconfig-paths";

const stackAuthRootPath = fileURLToPath(new URL("../..", import.meta.url));

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

export default defineConfig(({ mode }) => {
  const isVitest = mode === "test" || process.env.VITEST === "true";

  return {
    server: {
      port: Number(`${process.env.NEXT_PUBLIC_HEXCLAVE_PORT_PREFIX || "81"}43`),
      fs: {
        allow: [stackAuthRootPath],
      },
    },
    resolve: {
      dedupe: ["react", "react-dom"],
    },
    ssr: {
      noExternal: [/^@stackframe\//, /^@radix-ui\//],
    },
    optimizeDeps: {
      include: ["@stackframe/stack-shared", "@stackframe/stack-shared/config"],
    },
    plugins: [
      ...(isVitest ? [] : [
        waitForWorkspacePackages(["@stackframe/tanstack-start", "@stackframe/stack-shared", "@stackframe/stack-ui"]),
        watchNodeModules(["@stackframe/tanstack-start", "@stackframe/stack-shared", "@stackframe/stack-ui"]),
      ]),
      tsConfigPaths(),
      ...(isVitest ? [] : [
        tanstackStart(),
        nitro(),
      ]),
      viteReact(),
    ],
  };
});
