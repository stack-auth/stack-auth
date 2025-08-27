'use client';

import { useEffect, useState } from 'react';

// Map regular doc routes to embedded routes and resolve relative paths
const getEmbeddedUrl = (href: string, currentPath: string): string => {
  // Remove .md or .mdx extensions from the original href if present
  let cleanHref = href;
  if (cleanHref.endsWith('.md')) {
    cleanHref = cleanHref.slice(0, -3);
  } else if (cleanHref.endsWith('.mdx')) {
    cleanHref = cleanHref.slice(0, -4);
  }

  // Remove leading ./ if present (relative path indicator)
  if (cleanHref.startsWith('./')) {
    cleanHref = cleanHref.slice(2);
  }

  // If it's already an embedded URL, return as-is
  if (cleanHref.includes('-embed/')) {
    return cleanHref;
  }

  // Handle absolute paths that start with known doc routes
  if (cleanHref.startsWith('/docs/')) {
    return cleanHref.replace('/docs/', '/docs-embed/');
  }
  if (cleanHref.startsWith('/api/')) {
    return cleanHref.replace('/api/', '/api-embed/');
  }
  if (cleanHref.startsWith('/dashboard/')) {
    return cleanHref.replace('/dashboard/', '/dashboard-embed/');
  }

  // Handle relative paths - resolve against current path
  if (!cleanHref.startsWith('/') && !cleanHref.startsWith('http') && !cleanHref.startsWith('#')) {
    // Extract the base path from current URL
    // e.g., from '/docs-embed/next/overview' get '/docs-embed/next/'
    const pathParts = currentPath.split('/').filter(part => part);

    if (pathParts.length >= 2 && pathParts[0].endsWith('-embed')) {
      // We're in an embedded doc section
      const embedType = pathParts[0]; // e.g., 'docs-embed'
      const section = pathParts[1]; // e.g., 'next'

      // Build the full embedded path
      return `/${embedType}/${section}/${cleanHref}`;
    }
  }

  // Handle other absolute paths that should be treated as relative to current section
  if (cleanHref.startsWith('/') && currentPath.includes('-embed/')) {
    const pathParts = currentPath.split('/').filter(part => part);
    if (pathParts.length >= 2 && pathParts[0].endsWith('-embed')) {
      const embedType = pathParts[0]; // e.g., 'docs-embed'
      const section = pathParts[1]; // e.g., 'next'

      // Remove leading slash and build embedded path
      const cleanPath = cleanHref.startsWith('/') ? cleanHref.slice(1) : cleanHref;
      return `/${embedType}/${section}/${cleanPath}`;
    }
  }

  // Return unchanged for external links or unrecognized patterns
  return cleanHref;
};

type DebugEntry = {
  timestamp: string,
  originalHref: string,
  embeddedHref: string,
  action: 'navigated' | 'ignored' | 'error',
  error?: string,
};

export function EmbeddedLinkInterceptor() {
  const [debugEntries, setDebugEntries] = useState<DebugEntry[]>([]);
  const [showDebug, setShowDebug] = useState(false);
  const [, setNavigationHistory] = useState<string[]>([]);

  // Initialize navigation history with current URL
  useEffect(() => {
    setNavigationHistory([window.location.pathname]);
  }, []);

  const addDebugEntry = (originalHref: string, embeddedHref: string, action: 'navigated' | 'ignored' | 'error', error?: string) => {
    const entry: DebugEntry = {
      timestamp: new Date().toLocaleTimeString(),
      originalHref,
      embeddedHref,
      action,
      error
    };
    setDebugEntries(prev => [entry, ...prev].slice(0, 10)); // Keep last 10 entries
  };

  // Function to check if a URL exists
  const checkUrlExists = async (url: string): Promise<boolean> => {
    try {
      const response = await fetch(url, { method: 'HEAD' });
      return response.ok;
    } catch {
      return false;
    }
  };

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;

      // Find the closest anchor tag
      const anchor = target.closest('a');
      if (!anchor) return;

      const href = anchor.getAttribute('href');
      if (!href) return;

      // Intercept internal links that need to be rewritten OR relative links
      if (href.startsWith('/docs/') || href.startsWith('/api/') || href.startsWith('/dashboard/') ||
          (!href.startsWith('http') && !href.startsWith('#') && !href.startsWith('mailto:') && !href.startsWith('tel:'))) {
        event.preventDefault();

        const currentPath = window.location.pathname;
        const embeddedHref = getEmbeddedUrl(href, currentPath);

        // Debug logging
        console.log('Link Debug:', {
          originalHref: href,
          currentPath,
          resolvedHref: embeddedHref
        });

        // Check if the URL exists before navigating (async operation)
        checkUrlExists(embeddedHref).then((urlExists) => {
          if (urlExists) {
            // Add to debug log
            addDebugEntry(href, embeddedHref, 'navigated');

            // Add to navigation history
            setNavigationHistory(prev => [...prev, embeddedHref]);

            // Navigate to the embedded version
            window.location.href = embeddedHref;
          } else {
            // URL doesn't exist, log error but don't navigate
            addDebugEntry(href, embeddedHref, 'error', 'Page not found (404)');
          }
        }).catch(() => {
          // Network error or other issue
          addDebugEntry(href, embeddedHref, 'error', 'Network error or unable to check URL');
        });
      } else {
        // Log ignored links for debugging
        addDebugEntry(href, href, 'ignored');
      }
    };

    // Add click listener to document
    document.addEventListener('click', handleClick);

    // Cleanup
    return () => {
      document.removeEventListener('click', handleClick);
    };
  }, []);

  return (
    <>

      {/* Debug Toggle Button */}
      <div className="fixed top-4 right-4 z-50">
        <button
          onClick={() => setShowDebug(!showDebug)}
          className="px-3 py-2 bg-gray-800 hover:bg-gray-700 text-white text-xs font-medium rounded-md shadow-lg transition-colors"
          title="Toggle debug window"
        >
          Debug {showDebug ? '▼' : '▲'}
        </button>
      </div>

      {/* Debug Window */}
      {showDebug && (
        <div className="fixed top-16 right-4 w-96 max-h-96 bg-gray-900 text-white text-xs rounded-lg shadow-2xl z-50 overflow-hidden">
          <div className="bg-gray-800 px-3 py-2 border-b border-gray-700">
            <div className="flex items-center justify-between">
              <span className="font-medium">Link Debug Log</span>
              <button
                onClick={() => setDebugEntries([])}
                className="text-gray-400 hover:text-white transition-colors"
                title="Clear log"
              >
                Clear
              </button>
            </div>
          </div>
          <div className="overflow-y-auto max-h-80 p-3 space-y-2">
            {debugEntries.length === 0 ? (
              <div className="text-gray-400 text-center py-4">No links clicked yet</div>
            ) : (
              debugEntries.map((entry, index) => (
                <div
                  key={index}
                  className={`p-2 rounded border-l-2 ${
                    entry.action === 'navigated'
                      ? 'bg-green-900/20 border-green-500'
                      : entry.action === 'error'
                      ? 'bg-red-900/20 border-red-500'
                      : 'bg-yellow-900/20 border-yellow-500'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-gray-400">{entry.timestamp}</span>
                    <span
                      className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                        entry.action === 'navigated'
                          ? 'bg-green-600 text-white'
                          : entry.action === 'error'
                          ? 'bg-red-600 text-white'
                          : 'bg-yellow-600 text-white'
                      }`}
                    >
                      {entry.action}
                    </span>
                  </div>
                  <div className="space-y-1">
                    <div>
                      <span className="text-gray-400">Original:</span>
                      <span className="ml-2 font-mono">{entry.originalHref}</span>
                    </div>
                    {entry.action === 'navigated' && entry.originalHref !== entry.embeddedHref && (
                      <div>
                        <span className="text-gray-400">Rewritten:</span>
                        <span className="ml-2 font-mono text-green-400">{entry.embeddedHref}</span>
                      </div>
                    )}
                    {entry.action === 'error' && (
                      <>
                        <div>
                          <span className="text-gray-400">Attempted:</span>
                          <span className="ml-2 font-mono text-red-400">{entry.embeddedHref}</span>
                        </div>
                        {entry.error && (
                          <div>
                            <span className="text-gray-400">Error:</span>
                            <span className="ml-2 text-red-400">{entry.error}</span>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </>
  );
}
