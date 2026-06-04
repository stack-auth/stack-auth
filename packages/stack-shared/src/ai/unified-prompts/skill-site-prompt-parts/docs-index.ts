import docsJson from "./docs-json.generated";

const DOCS_BASE = "https://docs.hexclave.com";

type SidebarPage = string | SidebarGroup;
type SidebarGroup = { group: string, root?: string, pages: SidebarPage[] };
type DocsJson = { navigation?: { tabs?: readonly unknown[] } };

const ACRONYMS = new Set(["api", "cli", "mcp", "sdk", "jwt", "jwts", "faq", "url", "ui", "ux", "rbac", "oauth", "saas", "ai"]);

function humanizeSegment(seg: string): string {
  return seg
    .split("-")
    .map((w) => (ACRONYMS.has(w.toLowerCase()) ? w.toUpperCase() : w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function humanize(slug: string): string {
  const parts = slug.split("/");
  const last = parts[parts.length - 1];
  // Disambiguate generic leaf names by prefixing the parent segment.
  if ((last === "overview" || last === "index") && parts.length >= 2) {
    return humanizeSegment(parts[parts.length - 2]);
  }
  return humanizeSegment(last);
}

function docUrl(slug: string): string {
  if (slug === "index") {
    return DOCS_BASE;
  }
  const encoded = slug.split("/").map(encodeURIComponent).join("/");
  return `${DOCS_BASE}/${encoded}`;
}

function renderSidebar(pages: SidebarPage[], depth = 0): string[] {
  const lines: string[] = [];
  const indent = "  ".repeat(depth);
  for (const p of pages) {
    if (typeof p === "string") {
      lines.push(`${indent}- [${humanize(p)}](${docUrl(p)})`);
    } else {
      const heading = p.root
        ? `${indent}- **[${p.group}](${docUrl(p.root)})**`
        : `${indent}- **${p.group}**`;
      lines.push(heading);
      lines.push(...renderSidebar(p.pages, depth + 1));
    }
  }
  return lines;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSidebarPage(value: unknown): value is SidebarPage {
  if (typeof value === "string") {
    return true;
  }
  return isRecord(value)
    && typeof value.group === "string"
    && (value.root == null || typeof value.root === "string")
    && Array.isArray(value.pages)
    && value.pages.every(isSidebarPage);
}

export function buildDocsIndexPrompt(docsJson: DocsJson): string {
  const rawDocsJson: unknown = docsJson;
  const tabs = isRecord(rawDocsJson) && isRecord(rawDocsJson.navigation) && Array.isArray(rawDocsJson.navigation.tabs)
    ? rawDocsJson.navigation.tabs
    : undefined;
  const tab = tabs?.find((t) => isRecord(t) && t.tab === "Documentation");
  if (!isRecord(tab) || !Array.isArray(tab.pages) || !tab.pages.every(isSidebarPage)) {
    throw new Error('buildDocsIndexPrompt: "Documentation" tab not found in docs-mintlify/docs.json navigation');
  }
  return renderSidebar(tab.pages).join("\n");
}

export const docsIndexPrompt = buildDocsIndexPrompt(docsJson);
