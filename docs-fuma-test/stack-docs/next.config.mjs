import { createMDX } from 'fumadocs-mdx/next';
import path from 'path';

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  
  // Add module alias for @stackframe/stack to use our mock implementation
  webpack: (config) => {
    config.resolve.alias['@stackframe/stack'] = path.resolve('./src/__mocks__/stackframe-stack.js');
    return config;
  },
};

export default withMDX(config);
