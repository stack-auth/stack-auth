import { apiSource, source } from '../../../lib/source';

export const GET = async () => {
  const rootUrl = "https://docs.stack-auth.com";

  // Get pages from both sources
  const docsPages = source.getPages();
  const apiPages = apiSource.getPages();
  const allPages = [...docsPages, ...apiPages];

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${allPages
  .map((page) => {
    const url = new URL(page.url, rootUrl);
    return `  <url>
    <loc>${url.toString()}</loc>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>`;
  })
  .join("\n")}
</urlset>`;

  return new Response(sitemap, {
    headers: {
      "Content-Type": "application/xml",
      "Cache-Control": "public, max-age=3600",
    },
  });
};
