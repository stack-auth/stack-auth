'use client';

import { AlignLeft, ExternalLink, FileText, Hash, Search, Sparkles, X } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/cn';
import { useSidebar } from '../layouts/sidebar-context';

type SearchResult = {
  id: string,
  type: 'page' | 'heading' | 'text' | 'api',
  content: string,
  url: string,
  title?: string,
};

type DocumentCategory = 'api' | 'sdk' | 'component' | 'guide' | 'webhook';

type GroupedResult = {
  basePath: string,
  title: string,
  category: DocumentCategory,
  categories: DocumentCategory[], // Support multiple categories (e.g., API + Webhook)
  results: SearchResult[],
};

function categorizeUrl(url: string): { primary: DocumentCategory, all: DocumentCategory[] } {
  const categories: DocumentCategory[] = [];

  // Check for API
  if (url.startsWith('/api/')) {
    categories.push('api');

    // Check if it's also a webhook
    if (url.includes('/webhook')) {
      categories.push('webhook');
      return { primary: 'webhook', all: categories };
    }

    return { primary: 'api', all: categories };
  }

  // Check for SDK
  if (url.includes('/docs/sdk/') || url.includes('/sdk/')) {
    categories.push('sdk');
    return { primary: 'sdk', all: categories };
  }

  // Check for Component
  if (url.includes('/docs/components/') || url.includes('/components/')) {
    categories.push('component');
    return { primary: 'component', all: categories };
  }

  // Default to guide
  categories.push('guide');
  return { primary: 'guide', all: categories };
}

function extractBasePathFromUrl(url: string): string {
  // Handle API URLs
  if (url.startsWith('/api/')) {
    const match = url.match(/\/api\/([^#]+)/);
    return match?.[1] || '';
  }
  // Handle docs URLs
  const match = url.match(/\/docs\/(.+?)(?:#|$)/);
  return match?.[1] || '';
}

function getCategoryLabel(category: DocumentCategory): string {
  switch (category) {
    case 'api': {
      return 'API';
    }
    case 'sdk': {
      return 'SDK';
    }
    case 'component': {
      return 'COMP';
    }
    case 'guide': {
      return 'GUIDE';
    }
    case 'webhook': {
      return 'EVENT';
    }
  }
}

function getCategoryStyles(category: DocumentCategory): string {
  switch (category) {
    case 'api': {
      return 'bg-red-500/10 text-red-700 dark:text-red-400 border border-red-500/20';
    }
    case 'sdk': {
      return 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border border-blue-500/20';
    }
    case 'component': {
      return 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-400 border border-cyan-500/20';
    }
    case 'guide': {
      return 'bg-green-500/10 text-green-700 dark:text-green-400 border border-green-500/20';
    }
    case 'webhook': {
      return 'bg-purple-500/10 text-purple-700 dark:text-purple-400 border border-purple-500/20';
    }
  }
}

function groupResultsByPage(results: SearchResult[]): GroupedResult[] {
  const grouped = new Map<string, GroupedResult>();
  const groupOrder: string[] = []; // Track the order groups are first encountered

  for (const result of results) {
    const basePath = extractBasePathFromUrl(result.url);
    const baseUrl = result.url.split('#')[0];
    const { primary: category, all: categories } = categorizeUrl(result.url);

    if (!grouped.has(baseUrl)) {
      // Try to get title from the result itself first, then from other results with same base URL
      let title = result.title;

      if (!title) {
        // Try to find a page-type result with this base URL that has a title
        const pageResult = results.find(r => r.url.startsWith(baseUrl) && r.title);
        title = pageResult?.title;
      }

      // Fallback to formatting the path
      if (!title) {
        // For API URLs, create readable titles
        if (categories.includes('api')) {
          const parts = basePath.split('/').filter(Boolean);
          if (parts.length > 0) {
            title = parts.map(part =>
              part.split('-').map(word =>
                word.charAt(0).toUpperCase() + word.slice(1)
              ).join(' ')
            ).join(' - ');
          } else {
            title = 'API Documentation';
          }
        } else {
          // For docs URLs, format the last part of the path
          const lastPart = basePath.split('/').pop() || basePath;
          title = lastPart.split('-').map(word =>
            word.charAt(0).toUpperCase() + word.slice(1)
          ).join(' ');
        }
      }

      grouped.set(baseUrl, {
        basePath,
        title: title || 'Documentation',
        category,
        categories,
        results: []
      });

      // Track the order this group was first encountered (preserves relevance order)
      groupOrder.push(baseUrl);
    }

    const groupedResult = grouped.get(baseUrl);
    if (groupedResult) {
      groupedResult.results.push(result);
    }
  }

  // Return groups in the order they were first encountered (preserves API scoring order)
  // This maintains the relevance ranking from our search API
  return groupOrder.map(url => grouped.get(url)!);
}

function SearchResultIcon({ type }: { type: string }) {
  switch (type) {
    case 'page': {
      return <FileText className="w-4 h-4" />;
    }
    case 'heading': {
      return <Hash className="w-4 h-4" />;
    }
    case 'text': {
      return <AlignLeft className="w-4 h-4" />;
    }
    default: {
      return <FileText className="w-4 h-4" />;
    }
  }
}

type CustomSearchDialogProps = {
  open: boolean,
  onOpenChange: (open: boolean) => void,
};

export function CustomSearchDialog({ open, onOpenChange }: CustomSearchDialogProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const searchTimeoutRef = useRef<NodeJS.Timeout>();
  const sidebarContext = useSidebar();

  // Handle AI chat opening
  const handleOpenAIChat = () => {
    onOpenChange(false); // Close search dialog first
    if (!sidebarContext) {
      return;
    }

    const { toggleChat } = sidebarContext;

    // Small delay to ensure search dialog closes smoothly
    setTimeout(() => {
      if (!sidebarContext.isChatOpen) {
        toggleChat();
      }
    }, 100);
  };
  const performSearch = useCallback(async (searchQuery: string) => {
    if (!searchQuery.trim()) {
      setResults([]);
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`/api/search?q=${encodeURIComponent(searchQuery)}`);
      if (response.ok) {
        const data = await response.json();
        setResults(data || []);
        setSelectedIndex(0);
      } else {
        console.error('Search response not ok:', response.status, response.statusText);
        setResults([]);
      }
    } catch (error) {
      console.error('Search failed:', error);
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    searchTimeoutRef.current = setTimeout(() => {
      // eslint-disable-next-line no-restricted-syntax
      performSearch(query).catch((error) => {
        console.error('Search failed:', error);
      });
    }, 300);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [query, performSearch]);

  const groupedResults = groupResultsByPage(results);

  // Sort results by category: guides first, then SDK, then API, then webhooks, then components
  const categoryOrder: Record<DocumentCategory, number> = {
    'guide': 1,
    'sdk': 2,
    'api': 3,
    'webhook': 4,
    'component': 5,
  };

  const filteredResults = groupedResults.sort((a, b) => {
    return categoryOrder[a.category] - categoryOrder[b.category];
  });

  // Flatten results for keyboard navigation
  const flatResults = filteredResults.flatMap(group =>
    group.results.map(result => ({
      ...result,
      groupTitle: group.title,
    }))
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'Escape': {
        onOpenChange(false);
        break;
      }
      case 'ArrowDown': {
        e.preventDefault();
        setSelectedIndex(prev => Math.min(prev + 1, flatResults.length - 1));
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        setSelectedIndex(prev => Math.max(prev - 1, 0));
        break;
      }
      case 'Enter': {
        e.preventDefault();
        const selectedResult = flatResults.at(selectedIndex);
        if (selectedResult) {
          window.location.href = selectedResult.url;
          onOpenChange(false);
        }
        break;
      }
    }
  };

  // Focus input when dialog opens
  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setQuery('');
      setResults([]);
      setSelectedIndex(0);
    }
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
      onClick={() => onOpenChange(false)}
    >
      <div
        className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-2xl max-h-[80vh] bg-fd-background border border-fd-border rounded-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Search Input Header */}
        <div className="flex items-center border-b border-fd-border px-3">
          <Search className="w-4 h-4 text-fd-muted-foreground mr-3" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search documentation..."
            className="flex-1 px-0 py-4 text-sm bg-transparent outline-none placeholder:text-fd-muted-foreground"
          />
          <button
            onClick={() => onOpenChange(false)}
            className="ml-3 p-1 hover:bg-fd-muted rounded-md"
          >
            <X className="w-4 h-4 text-fd-muted-foreground" />
          </button>
        </div>

        {/* Results */}
        <div className="max-h-[500px] overflow-y-auto p-2">
          {loading && (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin w-6 h-6 border-2 border-fd-primary border-t-transparent rounded-full" />
            </div>
          )}

          {!loading && query && filteredResults.length === 0 && (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Search className="w-8 h-8 text-fd-muted-foreground mb-2" />
              <p className="text-sm text-fd-muted-foreground">No results found for &ldquo;{query}&rdquo;</p>
            </div>
          )}

          {!loading && filteredResults.map((group, groupIndex) => (
            <div key={group.basePath || groupIndex} className="mb-4">
              {/* Group Header - grid layout for consistent badge alignment */}
              <div className="grid grid-cols-[1fr_auto_auto] items-center gap-3 px-3 py-2.5 mb-2 bg-fd-muted/20 rounded-lg">
                <h3 className="text-sm font-semibold text-fd-foreground truncate">
                  {group.title}
                </h3>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {group.categories.map((cat, idx) => (
                    <span
                      key={idx}
                      className={cn(
                        "inline-flex items-center justify-center px-2 py-0.5 rounded-md text-[10px] font-medium tracking-wide leading-none",
                        getCategoryStyles(cat)
                      )}
                    >
                      {getCategoryLabel(cat)}
                    </span>
                  ))}
                </div>
                <span className="text-xs text-fd-muted-foreground flex-shrink-0">
                  {group.results.length} result{group.results.length !== 1 ? 's' : ''}
                </span>
              </div>

              {/* Results in this group */}
              <div className="space-y-1 pl-3">
                {group.results.map((result, resultIndex) => {
                  const flatIndex = filteredResults
                    .slice(0, groupIndex)
                    .reduce((acc, g) => acc + g.results.length, 0) + resultIndex;
                  const isSelected = flatIndex === selectedIndex;

                  return (
                    <Link
                      key={result.id}
                      href={result.url}
                      onClick={() => onOpenChange(false)}
                      className={cn(
                        "flex items-start gap-3 px-3 py-3 rounded-lg transition-colors cursor-pointer group",
                        isSelected
                          ? "bg-fd-primary/10 border border-fd-primary/20"
                          : "hover:bg-fd-muted/50"
                      )}
                    >
                      <div className="flex-shrink-0 mt-0.5 text-fd-muted-foreground">
                        <SearchResultIcon type={result.type} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={cn(
                          "text-sm line-clamp-2 transition-colors",
                          isSelected
                            ? "text-fd-primary font-medium"
                            : "text-fd-foreground group-hover:text-fd-primary"
                        )}>
                          {result.content}
                        </p>
                        <p className="text-xs text-fd-muted-foreground mt-1 truncate">
                          {result.url}
                        </p>
                      </div>
                      {result.url.includes('#') && (
                        <ExternalLink className={cn(
                          "w-3 h-3 transition-colors",
                          isSelected
                            ? "text-fd-primary"
                            : "text-fd-muted-foreground group-hover:text-fd-primary"
                        )} />
                      )}
                    </Link>
                  );
                })}
              </div>

              {/* Separator between groups (except for last group) */}
              {groupIndex < filteredResults.length - 1 && (
                <div className="mt-4 mb-4 mx-3 border-t border-fd-border/30" />
              )}
            </div>
          ))}

          {!query && (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Search className="w-8 h-8 text-fd-muted-foreground mb-2" />
              <p className="text-sm text-fd-muted-foreground">Start typing to search documentation...</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-fd-border px-3 py-2 text-xs text-fd-muted-foreground flex justify-between items-center">
          <span>Use ↑↓ to navigate, Enter to select, Esc to close</span>
          <div className="flex items-center gap-2">
            <span>
              {filteredResults.length} result group{filteredResults.length !== 1 ? 's' : ''}
            </span>

            {/* AI Chat Fallback */}
            <span className="text-fd-muted-foreground">•</span>
            <button
              onClick={handleOpenAIChat}
              className="flex items-center gap-1 px-2 py-1 text-xs rounded-md transition-all duration-300 ease-out relative overflow-hidden text-white chat-gradient-active hover:scale-105 hover:brightness-110 hover:shadow-lg"
            >
              <Sparkles className="h-3 w-3 relative z-10" />
              <span className="font-medium relative z-10">Ask AI</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
