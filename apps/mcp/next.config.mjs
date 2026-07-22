import { withSentryConfig } from "@sentry/nextjs";

const withConfiguredSentryConfig = (nextConfig) =>
  withSentryConfig(
    nextConfig,
    {
      // For all available options, see:
      // https://github.com/getsentry/sentry-webpack-plugin#options

      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,

      widenClientFileUpload: true,
      telemetry: false,
    },
    {
      // For all available options, see:
      // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

      // Upload a larger set of source maps for prettier stack traces (increases build time)
      widenClientFileUpload: true,

      // Hides source maps from generated client bundles
      hideSourceMaps: true,

      // Automatically tree-shake Sentry logger statements to reduce bundle size
      disableLogger: true,
    }
  );

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
};

export default withConfiguredSentryConfig(nextConfig);
