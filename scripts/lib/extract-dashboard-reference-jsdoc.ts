import fs from "fs";
import path from "path";

export type DashboardReferenceJSDocEntry = {
  appId: string,
  slug: string,
  body: string,
  title?: string,
  description?: string,
  sourcePath: string,
};

const DASHBOARD_SRC_ROOT = path.join("apps", "dashboard", "src");

function walkSourceFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next") {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkSourceFiles(fullPath));
      continue;
    }
    if (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) {
      results.push(fullPath);
    }
  }
  return results;
}

function parseDashboardReferenceBlock(
  rawComment: string,
  sourcePath: string,
): DashboardReferenceJSDocEntry | null {
  const lines = rawComment.split("\n").map((line) => line.replace(/^\s*\*?\s?/, ""));

  let appId: string | null = null;
  let slug: string | null = null;
  let title: string | undefined;
  let description: string | undefined;
  const bodyLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      if (bodyLines.length > 0) {
        bodyLines.push("");
      }
      continue;
    }

    const refMatch = trimmed.match(/^@dashboardReference\s+([a-z0-9-]+)\/([a-z0-9-]+)\s*$/);
    if (refMatch != null) {
      appId = refMatch[1];
      slug = refMatch[2];
      continue;
    }

    const titleMatch = trimmed.match(/^@dashboardReferenceTitle\s+(.+)$/);
    if (titleMatch != null) {
      title = titleMatch[1].trim();
      continue;
    }

    const descriptionMatch = trimmed.match(/^@dashboardReferenceDescription\s+(.+)$/);
    if (descriptionMatch != null) {
      description = descriptionMatch[1].trim();
      continue;
    }

    if (trimmed.startsWith("@")) {
      continue;
    }

    bodyLines.push(line.trimEnd());
  }

  if (appId == null || slug == null) {
    return null;
  }

  const body = bodyLines.join("\n").trim();
  if (body.length === 0) {
    throw new Error(
      `@dashboardReference ${appId}/${slug} in ${sourcePath} has no prose body. `
      + "Add markdown paragraphs after the tags in the JSDoc block.",
    );
  }

  return {
    appId,
    slug,
    body: `${body}\n`,
    title,
    description,
    sourcePath,
  };
}

function extractBlocksFromFile(content: string, sourcePath: string): DashboardReferenceJSDocEntry[] {
  const entries: DashboardReferenceJSDocEntry[] = [];
  let searchFrom = 0;

  while (searchFrom < content.length) {
    const tagIndex = content.indexOf("@dashboardReference", searchFrom);
    if (tagIndex === -1) {
      break;
    }

    const blockStart = content.lastIndexOf("/**", tagIndex);
    if (blockStart === -1) {
      searchFrom = tagIndex + 1;
      continue;
    }

    const blockEnd = content.indexOf("*/", tagIndex);
    if (blockEnd === -1) {
      break;
    }

    const rawComment = content.slice(blockStart + 3, blockEnd);
    const parsed = parseDashboardReferenceBlock(rawComment, sourcePath);
    if (parsed != null) {
      entries.push(parsed);
    }

    searchFrom = blockEnd + 2;
  }

  return entries;
}

export function extractDashboardReferenceJSDocs(repoRoot: string): Map<string, DashboardReferenceJSDocEntry> {
  const dashboardSrc = path.join(repoRoot, DASHBOARD_SRC_ROOT);
  const byKey = new Map<string, DashboardReferenceJSDocEntry>();

  for (const filePath of walkSourceFiles(dashboardSrc)) {
    const content = fs.readFileSync(filePath, "utf-8");
    if (!content.includes("@dashboardReference")) {
      continue;
    }

    const relativePath = path.relative(repoRoot, filePath);
    for (const entry of extractBlocksFromFile(content, relativePath)) {
      const key = `${entry.appId}/${entry.slug}`;
      const existing = byKey.get(key);
      if (existing != null) {
        throw new Error(
          `Duplicate @dashboardReference for ${key}: ${existing.sourcePath} and ${entry.sourcePath}`,
        );
      }
      byKey.set(key, entry);
    }
  }

  return byKey;
}
