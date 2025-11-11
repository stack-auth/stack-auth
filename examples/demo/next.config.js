/** @type {import('next').NextConfig} */
const nextConfig = {
  reactCompiler: true,
}
 
const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
})
 
module.exports = withBundleAnalyzer(nextConfig)
