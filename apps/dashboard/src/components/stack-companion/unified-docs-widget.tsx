'use client';

import { ArrowLeft, BookOpen, ExternalLink, Loader2, Menu } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

type UnifiedDocsWidgetProps = {
  isActive: boolean,
};

type DocContent = {
  title: string,
  url: string,
  type: 'dashboard' | 'docs' | 'api',
};

type DocType = 'dashboard' | 'docs' | 'api';

// Platform options
const PLATFORM_OPTIONS = [
  { value: 'next', label: 'Next.js', color: 'rgb(59, 130, 246)' },
  { value: 'react', label: 'React', color: 'rgb(16, 185, 129)' },
  { value: 'js', label: 'JavaScript', color: 'rgb(245, 158, 11)' },
  { value: 'python', label: 'Python', color: 'rgb(168, 85, 247)' },
];

// Function to toggle sidebar in embedded docs via postMessage
const toggleEmbeddedSidebar = (iframe: HTMLIFrameElement, visible: boolean) => {
  try {
    iframe.contentWindow?.postMessage({
      type: 'TOGGLE_SIDEBAR',
      visible: visible
    }, '*');
  } catch (error) {
    console.warn('Failed to communicate with embedded docs:', error);
  }
};

// Route patterns for matching dashboard pages
const DASHBOARD_ROUTE_PATTERNS = [
  // Main dashboard routes (match your actual dashboard URLs)
  // Users
  { pattern: /\/users(?:\/.*)?$/, docPage: 'users' },
  { pattern: /\/auth-methods(?:\/.*)?$/, docPage: 'auth-methods' },

  // Teams
  { pattern: /\/teams(?:\/.*)?$/, docPage: 'orgs-and-teams' },
  { pattern: /\/team-permissions(?:\/.*)?$/, docPage: 'team-permissions' },

  // Emails
  { pattern: /\/emails(?:\/.*)?$/, docPage: 'emails' },

  // Payments - Need docs for this first

  // Configuration
  { pattern: /\/domains(?:\/.*)?$/, docPage: 'domains' },
  { pattern: /\/webhooks(?:\/.*)?$/, docPage: 'webhooks' },
  { pattern: /\/api-keys(?:\/.*)?$/, docPage: 'stack-auth-keys' },
  { pattern: /\/project-settings(?:\/.*)?$/, docPage: 'project-settings' },
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

// Get documentation URL and title for the current page and doc type
const getDocContentForPath = (path: string, docType: DocType, platform: string = 'next'): DocContent => {
  switch (docType) {
    case 'dashboard': {
      const page = getDashboardPage(path);

      // Map dashboard pages to existing docs pages
      const dashboardToDocsMap: Record<string, { path: string, title: string }> = {
        'overview': { path: `${platform}/overview`, title: 'Stack Auth Overview' },
        'users': { path: `${platform}/getting-started/users`, title: 'User Management' },
        'auth-methods': { path: `${platform}/concepts/auth-providers`, title: 'Authentication Providers' },
        'orgs-and-teams': { path: `${platform}/concepts/orgs-and-teams`, title: 'Teams & Organizations' },
        'team-permissions': { path: `${platform}/concepts/permissions#team-permissions`, title: 'Team Permissions' },
        'emails': { path: `${platform}/concepts/emails`, title: 'Emails' },
        'domains': { path: `${platform}/getting-started/production#domains`, title: 'Domains' },
        'webhooks': { path: `${platform}/concepts/webhooks`, title: 'Webhooks' },
        'stack-auth-keys': { path: `${platform}/getting-started/setup#update-api-keys`, title: 'Stack Auth Keys' },
        'project-settings': { path: `${platform}/getting-started/production#enabling-production-mode`, title: 'Project Configuration' },
      };

      const docMapping = dashboardToDocsMap[page];
      const url = `http://localhost:8104/docs-embed/${docMapping.path}`;
      const title = docMapping.title;
      return { title, url, type: 'dashboard' };
    }
    case 'docs': {
      // Default to getting started for main docs
      const url = `http://localhost:8104/docs-embed/${platform}/getting-started/setup`;
      const title = 'Stack Auth Documentation';
      return { title, url, type: 'docs' };
    }
    case 'api': {
      // Default to overview for API docs
      const url = `http://localhost:8104/api-embed/overview`;
      const title = 'API Reference';
      return { title, url, type: 'api' };
    }
    default: {
      throw new Error(`Unknown doc type: ${docType}`);
    }
  }
};

export function UnifiedDocsWidget({ isActive }: UnifiedDocsWidgetProps) {
  const pathname = usePathname();
  const [selectedDocType, setSelectedDocType] = useState<DocType>('dashboard');
  const [selectedPlatform, setSelectedPlatform] = useState<string>('next');
  const [docContent, setDocContent] = useState<DocContent | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [showSwitchPrompt, setShowSwitchPrompt] = useState(false);
  const [currentPageDoc, setCurrentPageDoc] = useState<string>('');
  const [canGoBack, setCanGoBack] = useState(false);
  const [iframeRef, setIframeRef] = useState<HTMLIFrameElement | null>(null);
  const [isSidebarVisible, setIsSidebarVisible] = useState(false);

  // Load documentation when the component becomes active, doc type changes, platform changes, or pathname changes
  useEffect(() => {
    if (isActive) {
      const newPageDoc = getDashboardPage(pathname);

      // If this is the first time opening, doc type changed, or platform changed
      if (!docContent || docContent.type !== selectedDocType ||
          (selectedDocType !== 'api' && !docContent.url.includes(`/${selectedPlatform}/`))) {
        setLoading(true);
        setError(null);
        setIframeLoaded(false);
        setCurrentPageDoc(newPageDoc);

        try {
          const page = getDashboardPage(pathname);
          console.log('Debug mapping:', {
            pathname,
            normalizedPath: pathname.replace(/^\/projects\/[^/]+/, ''),
            detectedPage: page,
            platform: selectedPlatform
          });
          const content = getDocContentForPath(pathname, selectedDocType, selectedPlatform);
          console.log('Loading docs:', { page, platform: selectedPlatform, url: content.url });
          setDocContent(content);
        } catch (err) {
          console.error('Failed to load documentation:', err);
          setError(err instanceof Error ? err.message : 'Failed to load documentation');
          setLoading(false);
        }
      }
      // If we already have content loaded but user switched to a different dashboard page (only relevant for dashboard docs)
      else if (selectedDocType === 'dashboard' && currentPageDoc !== newPageDoc) {
        setShowSwitchPrompt(true);
      }
    }
  }, [isActive, pathname, selectedDocType, selectedPlatform, docContent, currentPageDoc]);

  // Monitor iframe for back button capability
  useEffect(() => {
    // Simple heuristic: assume we can go back after the iframe has been loaded for a while
    // and user has had time to navigate
    if (iframeLoaded) {
      const timer = setTimeout(() => {
        setCanGoBack(true);
      }, 2000); // Show back button after 2 seconds of iframe being loaded

      return () => clearTimeout(timer);
    }
  }, [iframeLoaded]);

  // Handle iframe load events
  const handleIframeLoad = (event: React.SyntheticEvent<HTMLIFrameElement>) => {
    setIframeLoaded(true);
    setLoading(false);
    setError(null);
    setIframeRef(event.currentTarget);
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
      const content = getDocContentForPath(pathname, selectedDocType, selectedPlatform);
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

  // Handle doc type selection
  const handleDocTypeChange = (docType: DocType) => {
    if (docType !== selectedDocType) {
      setSelectedDocType(docType);
      setShowSwitchPrompt(false);
      setIsSidebarVisible(false); // Hide sidebar when switching doc types
    }
  };

  // Handle platform selection
  const handlePlatformChange = (platform: string) => {
    if (platform !== selectedPlatform) {
      setSelectedPlatform(platform);
      // Sidebar will automatically update to show new platform content
    }
  };

  // Handle back button click
  const handleGoBack = () => {
    try {
      if (iframeRef?.contentWindow) {
        // Try to go back in iframe history
        iframeRef.contentWindow.history.back();
      }
    } catch (error) {
      // If we can't access iframe history, try to reload the previous page
      // This is a fallback that at least resets the iframe
      console.warn('Cannot access iframe history, reloading current page');
      if (iframeRef) {
        iframeRef.src = iframeRef.src;
      }
    }
  };


  if (!isActive) return null;

  return (
    <div className="flex flex-col h-full">

      {/* Switch Prompt for Dashboard Docs */}
      {showSwitchPrompt && selectedDocType === 'dashboard' && (
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3 mb-3">
          <div className="text-blue-800 dark:text-blue-200 text-xs">
            <strong>Page changed:</strong> Switch to docs for this page?
          </div>
          <div className="flex gap-2 mt-2">
            <button
              onClick={handleSwitchToDocs}
              className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-2 py-1 rounded"
            >
              Switch
            </button>
            <button
              onClick={handleDismissSwitch}
              className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
            >
              Keep current
            </button>
          </div>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 mb-3">
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
                const content = getDocContentForPath(pathname, selectedDocType, selectedPlatform);
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
        <div className="flex-1 flex flex-col min-h-0 relative">
          {/* Loading Overlay */}
          {loading && (
            <div className="absolute inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-10">
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                <div className="text-xs text-muted-foreground">Loading documentation...</div>
              </div>
            </div>
          )}

          {/* Header with controls */}
          <div className="pb-2 mb-3 border-b space-y-2">
            {/* Top row: drawer toggle, back button, title, external link */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {/* Sidebar toggle - only show for docs and dashboard types */}
                {(selectedDocType === 'docs' || selectedDocType === 'dashboard') && (
                  <button
                    onClick={() => {
                      const newVisibility = !isSidebarVisible;
                      setIsSidebarVisible(newVisibility);
                      if (iframeRef) {
                        toggleEmbeddedSidebar(iframeRef, newVisibility);
                      }
                    }}
                    className="flex items-center justify-center w-6 h-6 rounded hover:bg-muted transition-colors"
                    title="Toggle navigation sidebar"
                  >
                    <Menu className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                  </button>
                )}
                {canGoBack && (
                  <button
                    onClick={handleGoBack}
                    className="flex items-center justify-center w-6 h-6 rounded hover:bg-muted transition-colors"
                    title="Go back to previous page"
                  >
                    <ArrowLeft className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                  </button>
                )}
                <BookOpen className="h-3 w-3 text-muted-foreground" />
                <h4 className="text-xs font-medium text-muted-foreground">{docContent.title}</h4>
              </div>
              <a
                href={docContent.url.replace('/docs-embed/', '/docs/').replace('/api-embed/', '/api/')} // Convert embed URLs to full URLs
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground hover:text-foreground transition-colors"
                title="Open in new tab"
              >
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>

            {/* Platform selector row - only show for docs and dashboard types */}
            {(selectedDocType === 'docs' || selectedDocType === 'dashboard') && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Platform:</span>
                <div className="flex gap-1">
                  {PLATFORM_OPTIONS.map((platform) => (
                    <button
                      key={platform.value}
                      onClick={() => handlePlatformChange(platform.value)}
                      className={`px-2 py-1 text-xs rounded transition-colors ${
                        selectedPlatform === platform.value
                          ? 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 font-medium'
                          : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                      }`}
                      title={`Switch to ${platform.label} documentation`}
                    >
                      {platform.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Iframe */}
          <div className="flex-1 min-h-0">
            <iframe
              key={docContent.url} // Force iframe reload when URL changes
              src={docContent.url}
              className="w-full h-full border-0 rounded-md"
              onLoad={handleIframeLoad}
              onError={handleIframeError}
              title={docContent.title}
              sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
            />
          </div>
        </div>
      )}
    </div>
  );
}
