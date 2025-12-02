/**
 * AI Documentation Context
 *
 * This module provides Stack Auth documentation context for the AI assistant.
 * Docs are loaded and indexed for semantic search to provide relevant context.
 */

import fs from "fs";
import path from "path";

export type DocChunk = {
  id: string,
  title: string,
  path: string,
  content: string,
  keywords: string[],
};

let cachedDocs: DocChunk[] | null = null;

/**
 * Load and parse all documentation files
 */
export function loadDocs(): DocChunk[] {
  if (cachedDocs) return cachedDocs;

  // From apps/dashboard, docs are at ../../docs/content/docs
  // process.cwd() might be the monorepo root or apps/dashboard depending on how it's run
  let docsDir = path.join(process.cwd(), "docs/content/docs");
  if (!fs.existsSync(docsDir)) {
    docsDir = path.join(process.cwd(), "../docs/content/docs");
  }
  if (!fs.existsSync(docsDir)) {
    docsDir = path.join(process.cwd(), "../../docs/content/docs");
  }
  const chunks: DocChunk[] = [];

  function processDirectory(dir: string, basePath: string = "") {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          // Route groups like (guides) should be completely removed from URL path
          // They're Next.js organizational folders that don't appear in the URL
          const isRouteGroup = entry.name.startsWith("(") && entry.name.endsWith(")");
          const newBasePath = isRouteGroup ? basePath : `${basePath}/${entry.name}`;
          processDirectory(fullPath, newBasePath);
        } else if (entry.name.endsWith(".mdx")) {
          try {
            const content = fs.readFileSync(fullPath, "utf-8");
            const chunk = parseDocFile(content, fullPath, basePath);
            if (chunk) chunks.push(chunk);
          } catch {
            // Skip files that can't be read
          }
        }
      }
    } catch {
      // Directory doesn't exist or can't be read
    }
  }

  processDirectory(docsDir);
  cachedDocs = chunks;
  return chunks;
}

/**
 * Parse a single documentation file
 */
function parseDocFile(content: string, filePath: string, basePath: string): DocChunk | null {
  // Extract frontmatter title if present
  const titleMatch = content.match(/^---[\s\S]*?title:\s*["']?([^"'\n]+)["']?[\s\S]*?---/);
  const title = titleMatch?.[1] || path.basename(filePath, ".mdx");

  // Clean content but preserve important technical information
  let cleanContent = content
    // Remove frontmatter
    .replace(/^---[\s\S]*?---\n?/, "")
    // Remove import statements
    .replace(/^import\s+.*$/gm, "")
    // Remove JSX component wrappers but keep their content
    // e.g., <Step>content</Step> -> content
    .replace(/<(\w+)[^>]*>([\s\S]*?)<\/\1>/g, "$2")
    // Remove self-closing JSX tags like <Info> or <Steps>
    .replace(/<\w+\s*\/>/g, "")
    // Remove opening tags without content (like <Steps>)
    .replace(/<\w+[^>]*>/g, "")
    // Remove closing tags
    .replace(/<\/\w+>/g, "")
    // Remove JSX expressions like {variable}
    .replace(/\{[^}]+\}/g, "")
    // Clean up excessive whitespace but keep structure
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // Extract keywords from content
  const keywords = extractKeywords(title + " " + cleanContent);

  // Truncate content to keep context focused (prevents hallucination from too much context)
  if (cleanContent.length > 2500) {
    cleanContent = cleanContent.slice(0, 2500) + "...";
  }

  return {
    id: filePath,
    title,
    path: basePath + "/" + path.basename(filePath, ".mdx"),
    content: cleanContent,
    keywords,
  };
}

/**
 * Extract keywords from text for search matching
 */
function extractKeywords(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);

  // Get unique words, prioritizing less common ones
  const wordFreq = new Map<string, number>();
  for (const word of words) {
    wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
  }

  // Common words to exclude
  const stopWords = new Set([
    "the", "and", "for", "are", "but", "not", "you", "all", "can", "had",
    "her", "was", "one", "our", "out", "has", "have", "been", "were", "they",
    "this", "that", "with", "will", "your", "from", "more", "when", "some",
    "into", "them", "then", "than", "also", "just", "only", "come", "made",
    "find", "here", "thing", "both", "does", "using", "used", "use", "example",
  ]);

  return Array.from(wordFreq.entries())
    .filter(([word]) => !stopWords.has(word))
    .sort((a, b) => a[1] - b[1]) // Less frequent = more specific
    .slice(0, 30)
    .map(([word]) => word);
}

/**
 * Search for relevant documentation based on query
 */
export function searchDocs(query: string, maxResults: number = 5): DocChunk[] {
  const docs = loadDocs();
  const queryWords = query
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);

  // Score each doc by keyword matches
  const scored = docs.map((doc) => {
    let score = 0;

    // Title matches are worth more
    const titleLower = doc.title.toLowerCase();
    for (const word of queryWords) {
      if (titleLower.includes(word)) score += 10;
    }

    // Keyword matches
    for (const word of queryWords) {
      if (doc.keywords.includes(word)) score += 3;
    }

    // Content matches
    const contentLower = doc.content.toLowerCase();
    for (const word of queryWords) {
      if (contentLower.includes(word)) score += 1;
    }

    return { doc, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map((s) => s.doc);
}

/**
 * Format docs as context for the AI
 */
export function formatDocsContext(docs: DocChunk[]): string {
  if (docs.length === 0) return "";

  const sections = docs.map((doc) => {
    // Build the full documentation URL
    // doc.path is like "/concepts/auth-providers/google"
    // Full URL should be "https://docs.stack-auth.com/docs/concepts/auth-providers/google"
    const docUrl = `https://docs.stack-auth.com/docs${doc.path}`;
    return `## ${doc.title}\nDocumentation URL: ${docUrl}\n\n${doc.content}`;
  });

  return `Here is the relevant Stack Auth documentation. Use ONLY this information to answer. Copy URLs and technical values EXACTLY as shown:\n\n${sections.join("\n\n---\n\n")}`;
}
