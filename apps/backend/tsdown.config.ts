import { sentryRollupPlugin } from "@sentry/rollup-plugin";
import { readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Rolldown, type UserConfig } from "tsdown";
// @ts-expect-error - this is a workspace tsdown helper imported from source.
import { createBasePlugin } from "../../configs/tsdown/plugins.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const backendDir = __dirname;

const packageJson = JSON.parse(readFileSync(resolve(backendDir, "package.json"), "utf-8"));

const externalPackages = [
  "@prisma/client",
  "@prisma/adapter-neon",
  "@prisma/adapter-pg",
  "@prisma/instrumentation",
  "@prisma/extension-read-replicas",
  "@prisma/client/runtime/library",
  "@prisma/client/runtime/client",
  "@prisma/client/runtime/edge",
  "bcrypt",
  "oidc-provider",
  "pg",
  "sharp",
  // @aws-sdk and @smithy use complex class hierarchies that rolldown mis-scopes
  // when bundled, emitting references to hoisted classes before they're defined
  // (e.g. "ReferenceError: StructureSchema$1 is not defined" when the server
  // bundle boots via `node dist/server.mjs`). Keep them external so Node resolves
  // them from node_modules at runtime, which is always present alongside the
  // bundle (Docker image, CI runner, Vercel NFT trace). Mirrors the same fix in
  // scripts/db-migrations.tsdown.config.ts.
  "@aws-sdk",
  "@smithy",
];

const nodeBuiltins = builtinModules.flatMap((moduleName) => [moduleName, `node:${moduleName}`]);

const customNoExternal = new Set([
  ...Object.keys(packageJson.dependencies).filter(
    (dep) => !externalPackages.some((externalPackage) => dep === externalPackage || dep.startsWith(externalPackage + "/"))
  ),
]);

function packageNameFromSpecifier(specifier: string) {
  if (specifier.startsWith("@")) {
    const parts = specifier.split("/");
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : specifier;
  }
  return specifier.split("/")[0] ?? specifier;
}

function shouldBundleDependency(specifier: string) {
  if (specifier === "next" || specifier.startsWith("next/")) {
    return true;
  }
  return customNoExternal.has(packageNameFromSpecifier(specifier));
}

const basePlugin: Rolldown.Plugin = createBasePlugin({});
const nextCompatAliases = new Map([
  ["next/headers", resolve(backendDir, "src/lib/next-compat/headers.tsx")],
  ["next/navigation", resolve(backendDir, "src/lib/next-compat/navigation.tsx")],
  ["next/server", resolve(backendDir, "src/lib/next-compat/server.tsx")],
]);
const nextCompatPlugin: Rolldown.Plugin = {
  name: "backend-next-compat-aliases",
  resolveId(source) {
    return nextCompatAliases.get(source) ?? null;
  },
};
// Sentry release names may not contain slashes/whitespace, so sanitize the scoped package name.
const sentryRelease = process.env.SENTRY_RELEASE ?? `${packageJson.name}@${packageJson.version}`.replace(/[/\s]/g, "-");
const shouldUploadSourcemaps = process.env.SENTRY_ORG != null
  && process.env.SENTRY_PROJECT != null
  && process.env.SENTRY_AUTH_TOKEN != null;
const plugins = [
  basePlugin,
  nextCompatPlugin,
  ...(shouldUploadSourcemaps ? [
    sentryRollupPlugin({
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      release: {
        name: sentryRelease,
      },
      sourcemaps: {
        assets: resolve(backendDir, "dist/**/*.map"),
      },
    }),
  ] : []),
];

export default defineConfig({
  entry: [
    resolve(backendDir, "src/server/server.ts"),
    resolve(backendDir, "src/server/vercel.ts"),
  ],
  format: ["esm"],
  outDir: resolve(backendDir, "dist"),
  target: "node22",
  platform: "node",
  noExternal: shouldBundleDependency,
  inlineOnly: false,
  external: [...nodeBuiltins, ...externalPackages],
  clean: true,
  minify: false,
  sourcemap: true,
  alias: {
    "@": resolve(backendDir, "src"),
    ...Object.fromEntries(nextCompatAliases),
  },
  banner: {
    js: `import { createRequire as __createRequire } from 'module';
import { fileURLToPath as __fileURLToPath } from 'url';
import { dirname as __dirname_fn } from 'path';
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __dirname_fn(__filename);
const require = __createRequire(import.meta.url);`,
  },
  plugins,
} satisfies UserConfig);
