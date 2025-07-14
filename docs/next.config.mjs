import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  eslint: {
    // Temporarily disable ESLint during builds for Vercel deployment
    ignoreDuringBuilds: true,
  },
  // Include OpenAPI files in output tracing for Vercel deployments
  outputFileTracingIncludes: {
    '/api/**/*': ['./openapi/**/*'],
    '/**/*': ['./openapi/**/*'],
  },
  async redirects() {
    return [
      // Redirect /docs/api to the overview page
      {
        source: '/docs/api',
        destination: '/docs/api/overview',
        permanent: false,
      },
    ];
  },
  async rewrites() {
    return [
      // PostHog proxy rewrites to prevent ad blockers
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
      // Redirect .mdx requests to the llms.mdx route handler
      {
        source: '/docs/:path*.mdx',
        destination: '/llms.mdx/:path*',
      },
      {
        source: '/api/:path*.mdx',
        destination: '/llms.mdx/:path*',
      },
      // Serve OpenAPI files from the openapi directory
      {
        source: '/openapi/:path*',
        destination: '/openapi/:path*',
      },
      // No other rewrites needed for API docs - they're served directly from /docs/api/*
    ];
  },
};

export default withMDX(config);

