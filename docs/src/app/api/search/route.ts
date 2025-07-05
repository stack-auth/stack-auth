import fs from 'fs';
import { source } from 'lib/source';
import type { NextRequest } from 'next/server';
import path from 'path';

type SearchResult = {
  id: string,
  type: 'page' | 'heading' | 'text',
  content: string,
  url: string,
  score: number, // Add scoring for prioritization
};

// Helper function to get platform priority for tie-breaking
function getPlatformPriority(url: string): number {
  // Higher number = higher priority
  if (url.includes('/docs/next/')) return 100;
  if (url.includes('/docs/react/')) return 90;
  if (url.includes('/docs/js/')) return 80;
  if (url.includes('/docs/python/')) return 70;
  // API and other pages
  if (url.includes('/api/')) return 60;
  return 50; // Default priority
}

// Helper function to calculate search relevance score
function calculateScore(query: string, text: string, type: 'title' | 'description' | 'heading' | 'content'): number {
  const queryLower = query.toLowerCase().trim();
  const textLower = text.toLowerCase().trim();
  // Base scores by type (higher = more important)
  const baseScores = {
    title: 100,
    description: 70,
    heading: 50,
    content: 20
  };

  let score = 0;
  let matchType = '';

  // Exact match bonus (highest priority)
  if (textLower === queryLower) {
    score += baseScores[type] * 3; // Triple score for exact matches
    matchType = 'exact';
  }
  // Starts with query bonus
  else if (textLower.startsWith(queryLower)) {
    score += baseScores[type] * 2; // Double score for starts with
    matchType = 'starts-with';
  }
  // Contains as whole word bonus
  else if (new RegExp(`\\b${queryLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(textLower)) {
    score += baseScores[type] * 1.5;
    matchType = 'whole-word';
  }
  // Contains query bonus
  else if (textLower.includes(queryLower)) {
    score += baseScores[type];
    matchType = 'contains';
  }
  else {
    return 0; // No match
  }

  // Length penalty - shorter text with match is more relevant
  const lengthPenalty = Math.min(text.length / 100, 0.3);
  score -= lengthPenalty * 5;

  // Multiple occurrence bonus
  const occurrences = (textLower.match(new RegExp(queryLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
  if (occurrences > 1) {
    score += (occurrences - 1) * 15;
  }

  // Log scoring details for debugging
  if (score > 0) {
    console.log(`Score calculation: "${text}" (${type}) = ${score.toFixed(1)} [${matchType}, ${occurrences} occurrences]`);
  }

  return Math.max(score, 0);
}

// Helper function to extract text content from MDX
function extractTextFromMDX(filePath: string): string {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    // Remove frontmatter
    const withoutFrontmatter = content.replace(/^---[\s\S]*?---/, '');
    // Remove JSX components and keep only text content
    const textOnly = withoutFrontmatter
      .replace(/<[^>]*>/g, ' ') // Remove JSX tags
      .replace(/\{[^}]*\}/g, ' ') // Remove JSX expressions
      .replace(/```[a-zA-Z]*\n/g, ' ') // Remove code block language markers
      .replace(/```/g, ' ') // Remove code block delimiters but keep content
      .replace(/`([^`]*)`/g, '$1') // Remove inline code backticks but keep content
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // Extract link text
      .replace(/[#*_~]/g, '') // Remove markdown formatting (but keep backticks for now)
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
    return textOnly;
  } catch (error) {
    console.error(`Error reading file ${filePath}:`, error);
    return '';
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');

  console.log('Search API called with query:', query);

  if (!query) {
    return Response.json([]);
  }

  try {
    // Get all pages from the source
    const pages = source.getPages();
    console.log(`Found ${pages.length} pages in source`);

    const results: SearchResult[] = [];
    const queryLower = query.toLowerCase();

    // Search through all pages
    pages.forEach((page, pageIndex) => {
      const url = page.url;
      const title = page.data.title || '';
      const description = page.data.description || '';

      // Check if page title matches
      const titleScore = calculateScore(query, title, 'title');
      if (titleScore > 0) {
        console.log(`Page title match: "${title}" at ${url} - Score: ${titleScore.toFixed(1)}`);
        results.push({
          id: `${url}-page`,
          type: 'page',
          content: title,
          url: url,
          score: titleScore
        });
      }

      // Check if description matches
      const descriptionScore = calculateScore(query, description, 'description');
      if (descriptionScore > 0) {
        results.push({
          id: `${url}-description`,
          type: 'text',
          content: description,
          url: url,
          score: descriptionScore
        });
      }

      // Search through TOC items (headings)
      page.data.toc.forEach((tocItem, tocIndex) => {
        const tocTitle = tocItem.title;
        if (typeof tocTitle === 'string') {
          const headingScore = calculateScore(query, tocTitle, 'heading');
          if (headingScore > 0) {
            results.push({
              id: `${url}-${tocIndex}`,
              type: 'heading',
              content: tocTitle,
              url: `${url}#${tocItem.url.slice(1)}`, // Remove the # from tocItem.url and add it back
              score: headingScore
            });
          }
        }
      });

      // Full content search by reading the actual MDX file
      try {
        // Construct file path from URL
        const relativePath = url.replace('/docs/', './content/docs/') + '.mdx';
        const fullPath = path.resolve(relativePath);

        if (fs.existsSync(fullPath)) {
          const textContent = extractTextFromMDX(fullPath);
          const contentScore = calculateScore(query, textContent, 'content');

          if (contentScore > 0) {
            // Find a snippet around the match for better context
            const matchIndex = textContent.toLowerCase().indexOf(queryLower);
            const start = Math.max(0, matchIndex - 50);
            const end = Math.min(textContent.length, matchIndex + 100);
            const snippet = textContent.slice(start, end);

            results.push({
              id: `${url}-content-${pageIndex}`,
              type: 'text',
              content: `...${snippet}...`,
              url: url,
              score: contentScore
            });
          }
        }
      } catch (error) {
        // Silently ignore file reading errors
      }
    });

    // Sort results by score in descending order (highest score first)
    // Use platform priority as tie-breaker when scores are equal
    results.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score; // Primary sort by score
      }
      return getPlatformPriority(b.url) - getPlatformPriority(a.url); // Tie-breaker by platform priority
    });

    console.log(`\n=== RAW RESULTS FOR "${query}" ===`);
    results.slice(0, 10).forEach((result, i) => {
      const priority = getPlatformPriority(result.url);
      console.log(`${i + 1}. "${result.content}" (${result.type}) - Score: ${result.score.toFixed(1)} - Priority: ${priority} - URL: ${result.url}`);
    });

    // Remove duplicate URLs and keep only the highest scoring result per URL
    const seenUrls = new Set<string>();
    const uniqueResults = results.filter(result => {
      const baseUrl = result.url.split('#')[0]; // Remove fragment for deduplication
      if (seenUrls.has(baseUrl)) {
        console.log(`Duplicate URL filtered: ${result.content} (${result.score.toFixed(1)}) for ${baseUrl}`);
        return false;
      }
      seenUrls.add(baseUrl);
      return true;
    });

    // Re-sort after deduplication using the same logic
    uniqueResults.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score; // Primary sort by score
      }
      return getPlatformPriority(b.url) - getPlatformPriority(a.url); // Tie-breaker by platform priority
    });

    console.log(`\n=== FINAL RESULTS FOR "${query}" ===`);
    uniqueResults.slice(0, 10).forEach((result, i) => {
      const priority = getPlatformPriority(result.url);
      console.log(`${i + 1}. "${result.content}" (${result.type}) - Score: ${result.score.toFixed(1)} - Priority: ${priority} - URL: ${result.url}`);
    });

    console.log(`\nFound ${uniqueResults.length} unique search results for "${query}"`);

    // Remove score from response (internal use only)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- score is used internally for sorting.
    const responseResults = uniqueResults.map(({ score, ...result }) => result);

    return Response.json(responseResults);

  } catch (error) {
    console.error('Search error:', error);
    return Response.json({ error: 'Search failed', details: String(error) }, { status: 500 });
  }
}
