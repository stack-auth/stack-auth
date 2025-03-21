import { withSentryConfig } from "@sentry/nextjs";

import createBundleAnalyzer from "@next/bundle-analyzer";

const withBundleAnalyzer = createBundleAnalyzer({
  enabled: !!process.env.ANALYZE_BUNDLE,
});

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

/** @type {import('next').NextConfig} */
const nextConfig = {
  // optionally set output to "standalone" for Docker builds
  // https://nextjs.org/docs/pages/api-reference/next-config-js/output
  output: process.env.NEXT_CONFIG_OUTPUT,

  pageExtensions: ["js", "jsx", "mdx", "ts", "tsx"],

  // we're open-source, so we can provide source maps
  productionBrowserSourceMaps: true,

  poweredByHeader: false,

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
  skipTrailingSlashRedirect: true, 

  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Cross-Origin-Opener-Policy",
            value: "same-origin",
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
          {
            key: "X-Frame-Options",
            value: "SAMEORIGIN",
          },
          {
            key: "Content-Security-Policy",
            value: "",
          },
        ],
      },
    ];
  },
};

export default withConfiguredSentryConfig(
  withBundleAnalyzer(nextConfig)
);
