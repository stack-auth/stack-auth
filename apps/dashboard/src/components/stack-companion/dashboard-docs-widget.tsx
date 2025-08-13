'use client';

import { BookOpen, ExternalLink, Loader2 } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

type DashboardDocsWidgetProps = {
  isActive: boolean,
};

type DocContent = {
  title: string,
  url: string,
};

// Map dashboard routes to documentation pages
const ROUTE_TO_DOC_MAP: Record<string, string> = {
  '/users': 'users',
  '/teams': 'teams',
  '/permissions': 'permissions',
  '/settings': 'settings',
  '/auth-providers': 'auth-providers',
  '/analytics': 'analytics',
  '/': 'overview',
  '': 'overview',
};

// Title mapping for pages
const TITLE_MAP: Record<string, string> = {
  'overview': 'Dashboard Overview',
  'users': 'Users Management',
  'teams': 'Teams Management',
  'permissions': 'Permissions Management',
  'settings': 'Project Settings',
  'auth-providers': 'Authentication Providers',
  'analytics': 'Analytics & Insights',
};

// Route patterns for matching dashboard pages
const DASHBOARD_ROUTE_PATTERNS = [
  // Main dashboard routes
  { pattern: /\/users(?:\/.*)?$/, docPage: 'users' },
  { pattern: /\/teams(?:\/.*)?$/, docPage: 'teams' },
  { pattern: /\/permissions(?:\/.*)?$/, docPage: 'permissions' },
  { pattern: /\/settings(?:\/.*)?$/, docPage: 'settings' },
  { pattern: /\/auth-methods(?:\/.*)?$/, docPage: 'auth-providers' }, // Route is auth-methods but docs are auth-providers
  { pattern: /\/analytics(?:\/.*)?$/, docPage: 'analytics' },

  // Nested route examples (easily extensible)
  // { pattern: /\/users\/[^/]+\/profile$/, docPage: 'user-profile' },
  // { pattern: /\/teams\/[^/]+\/members$/, docPage: 'team-members' },
  // { pattern: /\/settings\/billing$/, docPage: 'billing-settings' },
];

// Get the dashboard page name from the current pathname
const getDashboardPage = (path: string): string => {
  // Normalize the path by removing the projects/<projectId> prefix
  const normalizedPath = path.replace(/^\/projects\/[^/]+/, '');

  // Find the first matching pattern
  for (const { pattern, docPage } of DASHBOARD_ROUTE_PATTERNS) {
    if (pattern.test(normalizedPath)) {
      return docPage;
    }
  }

  // Default to overview for root dashboard or unmatched routes
  return 'overview';
};

// Get documentation URL and title for the current page
const getDocContentForPath = (path: string): DocContent => {
  const page = getDashboardPage(path);
  const url = `http://localhost:8104/dashboard-embed/${page}`;
  const title = TITLE_MAP[page] || `Dashboard ${page}`;

  return { title, url };
};

export function DashboardDocsWidget({ isActive }: DashboardDocsWidgetProps) {
  const pathname = usePathname();
  const [docContent, setDocContent] = useState<DocContent | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [showSwitchPrompt, setShowSwitchPrompt] = useState(false);
  const [currentPageDoc, setCurrentPageDoc] = useState<string>('');

  // Load documentation when the component becomes active or pathname changes
  useEffect(() => {
    if (isActive) {
      const newPageDoc = getDashboardPage(pathname);

      // If this is the first time opening (no existing doc) or companion was closed and reopened
      if (!docContent) {
        setLoading(true);
        setError(null);
        setIframeLoaded(false);
        setCurrentPageDoc(newPageDoc);

        try {
          const content = getDocContentForPath(pathname);
          setDocContent(content);
        } catch (err) {
          console.error('Failed to load documentation:', err);
          setError(err instanceof Error ? err.message : 'Failed to load documentation');
          setLoading(false);
        }
      }
      // If we already have content loaded but user switched to a different page
      else if (currentPageDoc !== newPageDoc) {
        setShowSwitchPrompt(true);
      }
    }
  }, [isActive, pathname, docContent, currentPageDoc]);

  // Handle iframe load events
  const handleIframeLoad = () => {
    setIframeLoaded(true);
    setLoading(false);
    setError(null);
  };

  const handleIframeError = () => {
    setError('Failed to load documentation');
    setLoading(false);
    setIframeLoaded(false);
  };

  // Handle switching to current page's documentation
  const handleSwitchToDocs = () => {
    const newPageDoc = getDashboardPage(pathname);
    setLoading(true);
    setError(null);
    setIframeLoaded(false);
    setCurrentPageDoc(newPageDoc);
    setShowSwitchPrompt(false);

    try {
      const content = getDocContentForPath(pathname);
      setDocContent(content);
    } catch (err) {
      console.error('Failed to load documentation:', err);
      setError(err instanceof Error ? err.message : 'Failed to load documentation');
      setLoading(false);
    }
  };

  // Handle dismissing the switch prompt
  const handleDismissSwitch = () => {
    setShowSwitchPrompt(false);
  };

  if (!isActive) return null;

  return (
    <div className="flex flex-col h-full">
      {/* Error State */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
          <div className="flex items-start gap-2">
            <div className="text-red-600 dark:text-red-400 text-xs">
              <strong>Failed to load docs:</strong> {error}
            </div>
          </div>
          <button
            onClick={() => {
              setLoading(true);
              setError(null);
              setIframeLoaded(false);
              try {
                const content = getDocContentForPath(pathname);
                setDocContent(content);
              } catch (err) {
                console.error('Retry failed:', err);
                setError(err instanceof Error ? err.message : 'Failed to load documentation');
                setLoading(false);
              }
            }}
            className="mt-2 text-xs text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 underline"
          >
            Try again
          </button>
        </div>
      )}

      {/* Content - Iframe */}
      {docContent && !error && (
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex-1 relative">
            <iframe
              src={docContent.url}
              className="w-full h-full border-0 rounded-md bg-white dark:bg-gray-900"
              onLoad={handleIframeLoad}
              onError={handleIframeError}
              title={`Documentation: ${docContent.title}`}
              sandbox="allow-scripts allow-same-origin"
            />
            {!iframeLoaded && loading && (
              <div className="absolute inset-0 flex items-center justify-center bg-muted/50 rounded-md">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-xs">Loading content...</span>
                </div>
              </div>
            )}
            {/* Switch Page Prompt */}
            {showSwitchPrompt && (
              <div className="absolute top-2 left-2 right-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md p-2 shadow-xl z-10">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs text-gray-700 dark:text-gray-300">
                    Switch to <span className="font-medium">{TITLE_MAP[getDashboardPage(pathname)] || 'current page'}</span>?
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={handleSwitchToDocs}
                      className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors font-medium"
                    >
                      Switch
                    </button>
                    <button
                      onClick={handleDismissSwitch}
                      className="px-2 py-1 text-xs text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                    >
                      ×
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
          <div className="flex-shrink-0 pt-2 border-t border-muted/50">
            <button
              onClick={() => {
                const page = getDashboardPage(pathname);
                window.open(`http://localhost:8104/dashboard/${page}`, '_blank');
              }}
              className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1 hover:underline"
            >
              <ExternalLink className="h-3 w-3" />
              View full documentation
            </button>
          </div>
        </div>
      )}

      {/* Fallback when no content and no error */}
      {!docContent && !error && (
        <div className="text-center py-8">
          <BookOpen className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
          <p className="text-xs text-muted-foreground">
            No documentation available for this page
          </p>
        </div>
      )}

    </div>
  );
}
