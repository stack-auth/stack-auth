import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
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
      // No rewrites needed for API docs - they're served directly from /docs/api/*
    ];
  },
};

export default withMDX(config);

