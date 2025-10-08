'use client';

import { AlignLeft, ExternalLink, FileText, Hash, Search, X } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/cn';

type SearchResult = {
  id: string,
  type: 'page' | 'heading' | 'text',
  content: string,
  url: string,
};

type GroupedResult = {
  basePath: string,
  title: string,
  results: SearchResult[],
};

function extractBasePathFromUrl(url: string): string {
  // Extract everything after the platform but before any hash
  const match = url.match(/\/docs\/(.+?)(?:#|$)/);
  return match?.[1] || '';
}

function groupResultsByPage(results: SearchResult[]): GroupedResult[] {
  const grouped = new Map<string, GroupedResult>();
  const groupOrder: string[] = []; // Track the order groups are first encountered

  for (const result of results) {
    const basePath = extractBasePathFromUrl(result.url);
    const baseUrl = result.url.split('#')[0];

    if (!grouped.has(baseUrl)) {
      // Find the page title from page-type results, fallback to path-based title
      const pageResult = results.find(r => r.url === baseUrl && r.type === 'page');
      const title = pageResult?.content || basePath.split('/').pop()?.replace(/-/g, ' ') || 'Unknown';

      grouped.set(baseUrl, {
        basePath,
        title,
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

  // Filter by selected platform
  const filteredResults = groupedResults;

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
            <div key={group.basePath || groupIndex} className="mb-6">
              {/* Group Header */}
              <div className="flex items-center gap-3 px-3 py-2 mb-3 bg-fd-muted/30 rounded-lg">
                <h3 className="text-sm font-semibold text-fd-foreground">
                  {group.title}
                </h3>
                <div className="flex-1" />
                <span className="text-xs text-fd-muted-foreground">
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
          <span>
            {filteredResults.length} result group{filteredResults.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>
    </div>
  );
}
