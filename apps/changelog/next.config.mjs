/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  // For static export, we need to disable image optimization
  images: {
    unoptimized: true,
  },
};

export default nextConfig;

