import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  eslint: {
    // Re-enable ESLint during builds now that TS errors are fixed
    ignoreDuringBuilds: false,
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

