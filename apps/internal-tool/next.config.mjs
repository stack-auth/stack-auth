/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  // Keep the Claude Code harness as a runtime require instead of bundling it.
  // Turbopack can't statically resolve its `new URL('../bridge/...', import.meta.url)`
  // asset lookups, so bundling fails with "Can't resolve '../bridge/' <dynamic>".
  serverExternalPackages: ["@ai-sdk/harness-claude-code"],
};

export default nextConfig;
