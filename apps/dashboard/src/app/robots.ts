import type { MetadataRoute } from 'next';

/**
 * Permissive robots policy: all crawlers, including AI/LLM crawlers, may fetch the
 * dashboard's public surface (landing redirect, llms.txt). Authenticated app routes
 * and API endpoints are excluded since they never render useful content for crawlers.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/api/',
          '/handler/',
          '/projects/',
          '/new-project',
          '/playground',
          '/purchase/',
          '/integrations/',
          '/rde-debug',
          '/development-environment',
        ],
      },
    ],
  };
}
