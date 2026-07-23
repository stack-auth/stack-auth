import { existsSync, readFileSync, writeFileSync } from "fs";
import path from "path";

const OLD_DOCS_ORIGIN = "https://docs.stack-auth.com";
const NEW_DOCS_ORIGIN = "https://docs.hexclave.com";
const SITEMAP_URL = `${OLD_DOCS_ORIGIN}/sitemap.xml`;
const DEFAULT_TARGET_ORIGIN = "http://localhost:3000";
const DEFAULT_OUTPUT_PATH = "docs-legacy-redirects-test-results.untracked.json";
const DEFAULT_CONCURRENCY = 10;
const PERMANENT_REDIRECT_STATUSES = [301, 308] as const;

type RedirectTestResult = {
  path: string,
  originalUrl: string,
  newUrl: string | null,
  status: number | null,
  ok: boolean,
  error: string | null,
};

function parseArgs(argv: string[]) {
  const args = new Map<string, string>();
  for (const arg of argv) {
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (match) {
      args.set(match[1], match[2]);
    }
  }
  return {
    target: args.get("target") ?? DEFAULT_TARGET_ORIGIN,
    sitemap: args.get("sitemap") ?? SITEMAP_URL,
    out: args.get("out") ?? DEFAULT_OUTPUT_PATH,
    concurrency: Number(args.get("concurrency") ?? DEFAULT_CONCURRENCY),
  };
}

async function loadSitemapXml(sitemapSource: string): Promise<string> {
  if (sitemapSource.startsWith("http://") || sitemapSource.startsWith("https://")) {
    const response = await fetch(sitemapSource);
    if (!response.ok) {
      throw new Error(`Failed to fetch sitemap from ${sitemapSource}: ${response.status} ${response.statusText}`);
    }
    return await response.text();
  }
  if (!existsSync(sitemapSource)) {
    throw new Error(`Sitemap file not found: ${sitemapSource}`);
  }
  return readFileSync(sitemapSource, "utf-8");
}

function extractSitemapPaths(sitemapXml: string): string[] {
  const locMatches = [...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)];
  const paths = locMatches.map(([, url]) => new URL(url).pathname);
  return [...new Set(paths)].sort();
}

async function testRedirect(targetOrigin: string, sitemapPath: string): Promise<RedirectTestResult> {
  const originalUrl = `${OLD_DOCS_ORIGIN}${sitemapPath}`;
  try {
    const response = await fetch(`${targetOrigin}${sitemapPath}`, { redirect: "manual" });
    const newUrl = response.headers.get("location");
    const ok = (
      (PERMANENT_REDIRECT_STATUSES as readonly number[]).includes(response.status) &&
      newUrl != null &&
      newUrl.startsWith(NEW_DOCS_ORIGIN)
    );
    return { path: sitemapPath, originalUrl, newUrl, status: response.status, ok, error: null };
  } catch (e) {
    return { path: sitemapPath, originalUrl, newUrl: null, status: null, ok: false, error: String(e) };
  }
}

// Simple bounded-concurrency pool; avoids hammering the local dev server with 300+ parallel
// requests while still being much faster than testing sequentially.
async function mapWithConcurrency<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex++;
      results[currentIndex] = await fn(items[currentIndex]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

async function main() {
  const { target, sitemap, out, concurrency } = parseArgs(process.argv.slice(2));

  console.log(`Loading sitemap from ${sitemap}...`);
  const sitemapXml = await loadSitemapXml(sitemap);
  const paths = extractSitemapPaths(sitemapXml);
  console.log(`Testing ${paths.length} paths against ${target} (concurrency=${concurrency})...`);

  const results = await mapWithConcurrency(paths, concurrency, (sitemapPath) => testRedirect(target, sitemapPath));

  const failures = results.filter((r) => !r.ok);

  const outputPath = path.resolve(out);
  writeFileSync(
    outputPath,
    `${JSON.stringify({
      testedAt: new Date().toISOString(),
      targetOrigin: target,
      oldDocsOrigin: OLD_DOCS_ORIGIN,
      newDocsOrigin: NEW_DOCS_ORIGIN,
      totalTested: results.length,
      totalFailed: failures.length,
      results,
    }, null, 2)}\n`,
    "utf-8",
  );

  console.log(`\nTested ${results.length} paths: ${results.length - failures.length} passed, ${failures.length} failed.`);
  console.log(`Full original <-> new URL mapping written to ${outputPath}`);

  if (failures.length > 0) {
    console.log("\nFailed redirects:");
    for (const failure of failures) {
      console.log(`  ${failure.originalUrl} -> status=${failure.status ?? "N/A"} location=${failure.newUrl ?? "N/A"} ${failure.error ? `error=${failure.error}` : ""}`);
    }
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
