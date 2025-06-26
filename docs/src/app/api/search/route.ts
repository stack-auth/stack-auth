import fs from 'fs';
import { source } from 'lib/source';
import type { NextRequest } from 'next/server';
import path from 'path';

type SearchResult = {
  id: string,
  type: 'page' | 'heading' | 'text',
  content: string,
  url: string,
};

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
      if (title.toLowerCase().includes(queryLower)) {
        results.push({
          id: `${url}-page`,
          type: 'page',
          content: title,
          url: url
        });
      }

      // Check if description matches
      if (description.toLowerCase().includes(queryLower)) {
        results.push({
          id: `${url}-description`,
          type: 'text',
          content: description,
          url: url
        });
      }

      // Search through TOC items (headings)
      page.data.toc.forEach((tocItem, tocIndex) => {
        const tocTitle = tocItem.title;
        if (typeof tocTitle === 'string' && tocTitle.toLowerCase().includes(queryLower)) {
          results.push({
            id: `${url}-${tocIndex}`,
            type: 'heading',
            content: tocTitle,
            url: `${url}#${tocItem.url.slice(1)}` // Remove the # from tocItem.url and add it back
          });
        }
      });

      // Full content search by reading the actual MDX file
      try {
        // Construct file path from URL
        const relativePath = url.replace('/docs/', './content/docs/') + '.mdx';
        const fullPath = path.resolve(relativePath);

        if (fs.existsSync(fullPath)) {
          const textContent = extractTextFromMDX(fullPath);

          if (textContent.toLowerCase().includes(queryLower)) {
            // Find a snippet around the match for better context
            const matchIndex = textContent.toLowerCase().indexOf(queryLower);
            const start = Math.max(0, matchIndex - 50);
            const end = Math.min(textContent.length, matchIndex + 100);
            const snippet = textContent.slice(start, end);

            results.push({
              id: `${url}-content-${pageIndex}`,
              type: 'text',
              content: `...${snippet}...`,
              url: url
            });
          }
        }
      } catch (error) {
        // Silently ignore file reading errors
      }
    });

    console.log(`Found ${results.length} search results for "${query}"`);
    console.log('Sample results with platform info:', results.slice(0, 3));

    return Response.json(results);

  } catch (error) {
    console.error('Search error:', error);
    return Response.json({ error: 'Search failed', details: String(error) }, { status: 500 });
  }
}
