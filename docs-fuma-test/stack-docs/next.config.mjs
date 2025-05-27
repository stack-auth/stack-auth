import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  async redirects() {
    return [
      // Redirect direct API access to default platform
      {
        source: '/docs/api/:path*',
        destination: '/docs/pages-next/api/:path*',
        permanent: false,
      },
      {
        source: '/docs/rest-api/:path*',
        destination: '/docs/pages-next/api/:path*',
        permanent: false,
      },
    ];
  },
  async rewrites() {
    return [
      // Rewrite specific API endpoints to serve from main API docs
      {
        source: '/docs/pages-:platform/api/client/:path*',
        destination: '/docs/api/client/:path*',
      },
      {
        source: '/docs/pages-:platform/api/server/:path*',
        destination: '/docs/api/server/:path*',
      },
      {
        source: '/docs/pages-:platform/api/webhooks/:path*',
        destination: '/docs/api/webhooks/:path*',
      },
      {
        source: '/docs/pages-:platform/api/admin/:path*',
        destination: '/docs/api/admin/:path*',
      },
      // Handle overview routes specifically
      {
        source: '/docs/pages-:platform/api/overview',
        destination: '/docs/pages-:platform/api',
      },
    ];
  },
};

export default withMDX(config);

