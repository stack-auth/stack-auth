'use client';

import { AlignLeft, ChevronDown, ExternalLink, FileText, Hash, Search, Webhook, X, Zap } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/cn';
import { getCurrentPlatform } from '../../lib/platform-utils';

// Platform colors matching your theme
const PLATFORM_COLORS = {
  'next': '#3B82F6', // Blue - matches rgb(59, 130, 246)
  'react': '#10B981', // Green - matches rgb(16, 185, 129)
  'js': '#F59E0B', // Yellow - matches rgb(245, 158, 11)
  'javascript': '#F59E0B', // Yellow - matches rgb(245, 158, 11)
  'python': '#A855F7', // Purple - matches rgb(168, 85, 247)
  'api': '#FF6B6B', // Keep existing red for API
} as const;

const PLATFORM_NAMES = {
  'next': 'Next.js',
  'react': 'React',
  'js': 'JavaScript',
  'javascript': 'JavaScript',
  'python': 'Python',
  'api': 'API',
} as const;

type SearchResult = {
  id: string,
  type: 'page' | 'heading' | 'text' | 'api',
  content: string,
  url: string,
};

type GroupedResult = {
  platform: string,
  basePath: string,
  title: string,
  results: SearchResult[],
};

function extractPlatformFromUrl(url: string): string {
  if (url.startsWith('/api/')) return 'api';
  const match = url.match(/\/docs\/([^\/]+)/);
  const platform = match?.[1] || 'api';
  return platform;
}

function extractBasePathFromUrl(url: string): string {
  // Handle API URLs differently
  if (url.startsWith('/api/')) {
    const match = url.match(/\/api\/([^\/]+)/);
    return match?.[1] || '';
  }
  // Extract everything after the platform but before any hash for docs URLs
  const match = url.match(/\/docs\/[^\/]+(.+?)(?:#|$)/);
  return match?.[1] || '';
}

function groupResultsByPage(results: SearchResult[]): GroupedResult[] {
  const grouped = new Map<string, GroupedResult>();
  const groupOrder: string[] = []; // Track the order groups are first encountered

  for (const result of results) {
    const platform = extractPlatformFromUrl(result.url);
    const basePath = extractBasePathFromUrl(result.url);

    // Create appropriate baseUrl based on whether it's an API or docs URL
    const baseUrl = platform === 'api' ? `/api/${basePath}` : `/docs/${platform}${basePath}`;

    if (!grouped.has(baseUrl)) {
      let title = 'Unknown';

      if (platform === 'api') {
        // For API URLs, create better titles based on the API type
        switch (basePath) {
          case 'client': {
            title = 'Client API';
            break;
          }
          case 'server': {
            title = 'Server API';
            break;
          }
          case 'webhooks': {
            title = 'Webhooks';
            break;
          }
          default: {
            title = `${basePath.charAt(0).toUpperCase()}${basePath.slice(1)} API`;
          }
        }
      } else {
        // For docs URLs, find the page title from page-type results, fallback to path-based title
        const pageResult = results.find(r => r.url === baseUrl && r.type === 'page');
        title = pageResult?.content || basePath.split('/').pop()?.replace(/-/g, ' ') || 'Unknown';
      }

      grouped.set(baseUrl, {
        platform,
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

function PlatformBadge({ platform }: { platform: string }) {
  const color = PLATFORM_COLORS[platform as keyof typeof PLATFORM_COLORS];
  const name = PLATFORM_NAMES[platform as keyof typeof PLATFORM_NAMES];

  return (
    <span
      className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-md"
      style={{
        backgroundColor: `${color}20`,
        color: color,
        border: `1px solid ${color}40`
      }}
    >
      {name}
    </span>
  );
}

function SearchResultIcon({ type, url }: { type: string, url?: string }) {
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
    case 'api': {
      // Use different icons based on the API type
      if (url?.includes('/webhooks/')) {
        return <Webhook className="w-4 h-4" />;
      }
      return <Zap className="w-4 h-4" />;
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

// Helper function to detect current platform from URL
function getCurrentPlatformForSearch(pathname: string): string {
  const platform = getCurrentPlatform(pathname);
  if (platform) return platform;

  // Check if we're on API pages
  if (pathname.includes('/api/')) return 'api';

  return 'all';
}

export function CustomSearchDialog({ open, onOpenChange }: CustomSearchDialogProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedPlatformFilter, setSelectedPlatformFilter] = useState<string>('all');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  const searchTimeoutRef = useRef<NodeJS.Timeout>();

  // Available platforms for the dropdown
  const availablePlatforms = ['all', 'next', 'react', 'js', 'python', 'api'];

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    };

    if (dropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [dropdownOpen]);

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
  // When a specific platform is selected, include both that platform AND API results
  // When 'api' is selected, show only API results
  // When 'all' is selected, show everything
  let filteredResults = selectedPlatformFilter === 'all'
    ? groupedResults
    : selectedPlatformFilter === 'api'
      ? groupedResults.filter(group => group.platform === 'api')
      : groupedResults.filter(group =>
        group.platform === selectedPlatformFilter || group.platform === 'api'
      );

  // Sort filtered results to prioritize the selected platform over API
  if (selectedPlatformFilter !== 'all' && selectedPlatformFilter !== 'api') {
    filteredResults = filteredResults.sort((a, b) => {
      // Selected platform comes first, then API, then others
      if (a.platform === selectedPlatformFilter && b.platform !== selectedPlatformFilter) return -1;
      if (b.platform === selectedPlatformFilter && a.platform !== selectedPlatformFilter) return 1;
      if (a.platform === 'api' && b.platform !== 'api' && b.platform !== selectedPlatformFilter) return -1;
      if (b.platform === 'api' && a.platform !== 'api' && a.platform !== selectedPlatformFilter) return 1;
      return 0;
    });
  }

  // Flatten results for keyboard navigation
  const flatResults = filteredResults.flatMap(group =>
    group.results.map(result => ({
      ...result,
      groupTitle: group.title,
      platform: group.platform
    }))
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'Escape': {
        if (dropdownOpen) {
          setDropdownOpen(false);
        } else {
          onOpenChange(false);
        }
        break;
      }
      case 'ArrowDown': {
        if (!dropdownOpen) {
          e.preventDefault();
          setSelectedIndex(prev => Math.min(prev + 1, flatResults.length - 1));
        }
        break;
      }
      case 'ArrowUp': {
        if (!dropdownOpen) {
          e.preventDefault();
          setSelectedIndex(prev => Math.max(prev - 1, 0));
        }
        break;
      }
      case 'Enter': {
        if (!dropdownOpen) {
          e.preventDefault();
          const selectedResult = flatResults[selectedIndex];
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

  // Reset state when dialog opens and set platform based on current URL
  useEffect(() => {
    if (open) {
      setQuery('');
      setResults([]);
      setSelectedIndex(0);
      setDropdownOpen(false);

      // Auto-detect platform from current URL
      const currentPlatform = getCurrentPlatformForSearch(pathname);
      setSelectedPlatformFilter(currentPlatform);
    }
  }, [open, pathname]);

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
          <div className="flex items-center gap-2 ml-3 relative" ref={dropdownRef}>
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className={cn(
                "text-xs px-3 py-1.5 rounded-md flex items-center gap-2",
                dropdownOpen ? "bg-fd-primary text-fd-primary-foreground" : "bg-fd-muted text-fd-muted-foreground hover:bg-fd-muted/80"
              )}
            >
              {selectedPlatformFilter === 'all' ? (
                <span>All platforms</span>
              ) : selectedPlatformFilter === 'api' ? (
                <>
                  <PlatformBadge platform={selectedPlatformFilter} />
                  <span>only</span>
                </>
              ) : (
                <>
                  <PlatformBadge platform={selectedPlatformFilter} />
                  <span>+ API</span>
                </>
              )}
              <ChevronDown className={cn("w-3 h-3 transition-transform", dropdownOpen && "rotate-180")} />
            </button>

            {/* Dropdown Menu */}
            {dropdownOpen && (
              <div className="absolute top-full left-0 mt-1 bg-fd-background border border-fd-border rounded-md shadow-lg z-50 min-w-[140px]">
                {availablePlatforms.map((platform) => (
                  <button
                    key={platform}
                    onClick={() => {
                      setSelectedPlatformFilter(platform);
                      setDropdownOpen(false);
                    }}
                    className={cn(
                      "w-full text-left px-3 py-2 text-xs hover:bg-fd-muted flex items-center gap-2",
                      selectedPlatformFilter === platform && "bg-fd-primary/10 text-fd-primary"
                    )}
                  >
                    {platform === 'all' ? (
                      <span>All platforms</span>
                    ) : (
                      <>
                        <PlatformBadge platform={platform} />
                      </>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
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
            <div key={`${group.platform}-${group.basePath}`} className="mb-6">
              {/* Group Header */}
              <div className="flex items-center gap-3 px-3 py-2 mb-3 bg-fd-muted/30 rounded-lg">
                <PlatformBadge platform={group.platform} />
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
                        <SearchResultIcon type={result.type} url={result.url} />
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
            {selectedPlatformFilter !== 'all' && filteredResults.length > 0 && (
              <span className="ml-2 text-fd-primary">
                • {selectedPlatformFilter === 'api'
                  ? 'API only'
                  : `${PLATFORM_NAMES[selectedPlatformFilter as keyof typeof PLATFORM_NAMES]} + API`
                }
              </span>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}
