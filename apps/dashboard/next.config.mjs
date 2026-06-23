import { withSentryConfig } from "@sentry/nextjs";
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sharedBackendRequire = createRequire(path.join(__dirname, "../../packages/shared-backend/package.json"));
const claudeAgentSdkDir = path.dirname(sharedBackendRequire.resolve("@anthropic-ai/claude-agent-sdk"));
const claudeAgentSdkTraceDir = path.relative(__dirname, claudeAgentSdkDir);

const withConfiguredSentryConfig = (nextConfig) =>
  withSentryConfig(
    nextConfig,
    {
      // For all available options, see:
      // https://github.com/getsentry/sentry-webpack-plugin#options

      org: "stackframe-pw",
      project: "stack-server",

      widenClientFileUpload: true,
      telemetry: false,
    },
    {
      // For all available options, see:
      // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

      // Upload a larger set of source maps for prettier stack traces (increases build time)
      widenClientFileUpload: true,

      // Transpiles SDK to be compatible with IE11 (increases bundle size)
      transpileClientSDK: true,

      // Route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
      // This can increase your server load as well as your hosting bill.
      // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
      // side errors will fail.
      tunnelRoute: "/monitoring",

      // Hides source maps from generated client bundles
      hideSourceMaps: true,

      // Automatically tree-shake Sentry logger statements to reduce bundle size
      disableLogger: true,

      // Enables automatic instrumentation of Vercel Cron Monitors.
      // See the following for more information:
      // https://docs.sentry.io/product/crons/
      // https://vercel.com/docs/cron-jobs
      automaticVercelMonitors: true,
    }
  );

function resolveHexclaveStackEnvVar(hexclaveName, stackName) {
  const hexclaveValue = process.env[hexclaveName];
  const stackValue = process.env[stackName];
  if (hexclaveValue && stackValue && hexclaveValue !== stackValue) {
    throw new Error(`Environment variables ${hexclaveName} and ${stackName} are both set to different values. Remove one of them or set them to the same value.`);
  }
  return hexclaveValue || stackValue || undefined;
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  // optionally set output to "standalone" for Docker builds
  // https://nextjs.org/docs/pages/api-reference/next-config-js/output
  output: process.env.NEXT_CONFIG_OUTPUT,
  distDir: process.env.HEXCLAVE_DASHBOARD_NEXT_DIST_DIR,
  outputFileTracingRoot: path.join(__dirname, "../.."),
  outputFileTracingIncludes: {
    "/api/remote-development-environment/config/apply-update": [
      path.join(claudeAgentSdkTraceDir, "cli.js"),
      path.join(claudeAgentSdkTraceDir, "manifest.json"),
      path.join(claudeAgentSdkTraceDir, "manifest.zst.json"),
      path.join(claudeAgentSdkTraceDir, "resvg.wasm"),
      path.join(claudeAgentSdkTraceDir, "vendor/**/*"),
    ],
  },

  pageExtensions: ["js", "jsx", "mdx", "ts", "tsx"],

  // we're open-source, so we can provide source maps — but skip them for
  // RDE standalone builds where they just take up space for no reason
  productionBrowserSourceMaps: process.env.NEXT_CONFIG_OUTPUT !== "standalone",

  poweredByHeader: false,

  typescript: {
    ignoreBuildErrors: process.env.STACK_NEXT_CONFIG_DISABLE_TYPESCRIPT === "true",
  },

  images: {
    // Disable image optimization in standalone/RDE builds to avoid shipping
    // the sharp native binary (~17 MB). The RDE runs locally so optimized
    // images are not needed.
    ...(process.env.NEXT_CONFIG_OUTPUT === "standalone" ? { unoptimized: true } : {}),
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.featurebase-attachments.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'raw.githubusercontent.com',
        port: '',
        pathname: '/**',
      },
    ],
  },

  async rewrites() {
    return [
      {
        source: "/consume/static/:path*",
        destination: "https://eu-assets.i.posthog.com/static/:path*",
      },
      {
        source: "/consume/:path*",
        destination: "https://eu.i.posthog.com/:path*",
      },
      {
        source: "/consume/decide",
        destination: "https://eu.i.posthog.com/decide",
      },
    ];
  },

  async headers() {
    const isLocalEmulator = resolveHexclaveStackEnvVar("NEXT_PUBLIC_HEXCLAVE_IS_LOCAL_EMULATOR", "NEXT_PUBLIC_STACK_IS_LOCAL_EMULATOR") === "true";
    return [
      {
        source: "/(.*)",
        headers: [
          {
            // needed for stripe connect embedded components
            key: "Cross-Origin-Opener-Policy",
            value: "same-origin-allow-popups",
          },
          {
            key: "Permissions-Policy",
            value: "",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          ...resolveHexclaveStackEnvVar("NEXT_PUBLIC_HEXCLAVE_IS_PREVIEW", "NEXT_PUBLIC_STACK_IS_PREVIEW") === "true" ? [] : [{
            key: "X-Frame-Options",
            value: "SAMEORIGIN",
          }],
          {
            key: "Content-Security-Policy",
            // Note: *.localhost requires Chrome 117+ and may not work in Firefox
            // without network.dns.localDomains configuration. Fine for dev tool purposes.
            value: isLocalEmulator ? "frame-ancestors 'self' http://localhost:* https://localhost:* http://127.0.0.1:* https://127.0.0.1:* http://[::1]:* https://[::1]:* http://*.localhost https://*.localhost" : "",
          },
        ],
      },
    ];
  },
};

export default withConfiguredSentryConfig(
  nextConfig
);
