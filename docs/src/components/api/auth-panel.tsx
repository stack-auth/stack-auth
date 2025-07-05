'use client';

import { AlertTriangle, Key, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSidebar } from '../layouts/sidebar-context';
import { useAPIPageContext } from './api-page-wrapper';
import { Button } from './button';

export function AuthPanel() {
  const sidebarContext = useSidebar();

  // Always call hooks at the top level
  const apiContext = useAPIPageContext();

  // Use default functions if sidebar context is not available
  const { isAuthOpen, toggleAuth } = sidebarContext || {
    isAuthOpen: false,
    toggleAuth: () => {}
  };

  // Default headers structure
  const defaultHeaders: Record<string, string> = {
    'Content-Type': '',
    'X-Stack-Access-Type': '',
    'X-Stack-Project-Id': '',
    'X-Stack-Publishable-Client-Key': '',
    'X-Stack-Secret-Server-Key': '',
    'X-Stack-Access-Token': '',
  };

  const { sharedHeaders, updateSharedHeaders, lastError, highlightMissingHeaders } = apiContext || {
    sharedHeaders: defaultHeaders,
    updateSharedHeaders: () => {},
    lastError: null,
    highlightMissingHeaders: false
  };

  // Ensure sharedHeaders is always a Record<string, string>
  const headers: Record<string, string> = sharedHeaders;

  const [isHomePage, setIsHomePage] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);

  // Detect if we're on homepage and scroll state (same as AIChatDrawer)
  useEffect(() => {
    const checkHomePage = () => {
      setIsHomePage(document.body.classList.contains('home-page'));
    };

    const checkScrolled = () => {
      setIsScrolled(document.body.classList.contains('scrolled'));
    };

    // Initial check
    checkHomePage();
    checkScrolled();

    // Set up observers for class changes
    const observer = new MutationObserver(() => {
      checkHomePage();
      checkScrolled();
    });

    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['class']
    });

    return () => {
      observer.disconnect();
    };
  }, []);

  // Calculate position based on homepage and scroll state (same as AIChatDrawer)
  const topPosition = isHomePage && isScrolled ? 'top-0' : 'top-14';
  const height = isHomePage && isScrolled ? 'h-screen' : 'h-[calc(100vh-3.5rem)]';

  const stackAuthHeaders = [
    { key: 'Content-Type', label: 'Content Type', placeholder: 'application/json', required: true },
    { key: 'X-Stack-Access-Type', label: 'Access Type', placeholder: 'client or server', required: true },
    { key: 'X-Stack-Project-Id', label: 'Project ID', placeholder: 'your-project-uuid', required: true },
    { key: 'X-Stack-Publishable-Client-Key', label: 'Client Key', placeholder: 'pck_your_key_here', required: false },
    { key: 'X-Stack-Secret-Server-Key', label: 'Server Key', placeholder: 'ssk_your_key_here', required: false },
    { key: 'X-Stack-Access-Token', label: 'Access Token', placeholder: 'user_access_token', required: false },
  ];

  const missingRequiredHeaders = stackAuthHeaders.filter(
    header => header.required && !headers[header.key].trim()
  );

  return (
    <>
      {/* Desktop Auth Panel - Matching AIChatDrawer design */}
      <div
        className={`hidden md:block fixed ${topPosition} right-0 ${height} bg-fd-background border-l border-fd-border flex flex-col transition-all duration-300 ease-out z-50 w-96 ${
          isAuthOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Header - Matching AIChatDrawer */}
        <div className="flex items-center justify-between p-3 border-b border-fd-border bg-fd-background">
          <div className="flex items-center gap-2">
            <div className={`w-5 h-5 rounded flex items-center justify-center ${
              highlightMissingHeaders
                ? 'bg-red-100 dark:bg-red-900/30 auth-error-pulse'
                : 'bg-blue-100 dark:bg-blue-900/30'
            }`}>
              {highlightMissingHeaders ? (
                <AlertTriangle className="w-3 h-3 text-red-600 dark:text-red-400" />
              ) : (
                <Key className="w-3 h-3 text-blue-600 dark:text-blue-400" />
              )}
            </div>
            <div>
              <h3 className="font-medium text-fd-foreground text-sm">
                {highlightMissingHeaders ? 'Authentication Required' : 'API Authentication'}
              </h3>
              <p className="text-xs text-fd-muted-foreground">
                Configure headers for requests
              </p>
            </div>
          </div>
          <button
            onClick={toggleAuth}
            className="p-1 text-fd-muted-foreground hover:text-fd-foreground hover:bg-fd-muted rounded transition-colors"
            title="Close auth panel"
          >
            <X className="w-3 h-3" />
          </button>
        </div>

        {/* Error Message - Reserve space to prevent layout shifts */}
        <div className="mx-3 mt-3 h-auto">
          {highlightMissingHeaders && lastError ? (
            <div className="p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md auth-error-pulse">
              <div className="flex items-center gap-2 text-xs">
                <AlertTriangle className="w-3 h-3 text-red-600 dark:text-red-400 flex-shrink-0" />
                <span className="text-red-800 dark:text-red-300 font-medium">
                  {lastError.status} Error - Authentication required
                </span>
              </div>
              {missingRequiredHeaders.length > 0 && (
                <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                  Missing: {missingRequiredHeaders.map(h => h.label).join(', ')}
                </p>
              )}
            </div>
          ) : null}
        </div>

        {/* Content - Fixed height to prevent layout shifts */}
        <div className="flex-1 min-h-0">
          <div className="h-full overflow-y-auto p-3 space-y-3">
            {stackAuthHeaders.map((header) => {
              const isMissing = highlightMissingHeaders && header.required && !headers[header.key].trim();

              return (
                <div key={header.key} className={`space-y-1.5 ${
                  isMissing ? 'p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md auth-error-pulse' : ''
                }`}>
                  <label className="text-xs font-medium text-fd-foreground flex items-center gap-2">
                    {header.label}
                    {header.required && (
                      <span className={`text-xs px-1.5 py-0.5 rounded text-xs ${
                        isMissing
                          ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                          : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                      }`}>
                        required
                      </span>
                    )}
                    {isMissing && (
                      <AlertTriangle className="w-3 h-3 text-red-500" />
                    )}
                  </label>
                  <input
                    type="text"
                    placeholder={header.placeholder}
                    value={headers[header.key] || ''}
                    onChange={(e) => updateSharedHeaders({ ...headers, [header.key]: e.target.value })}
                    className={`w-full px-2 py-1.5 border rounded-md text-xs bg-fd-background text-fd-foreground placeholder:text-fd-muted-foreground focus:outline-none focus:ring-1 focus:border-transparent transition-all duration-200 ${
                      isMissing
                        ? 'border-red-300 focus:ring-red-500 dark:border-red-700'
                        : 'border-fd-border focus:ring-fd-primary focus:border-fd-primary'
                    }`}
                  />
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer Status */}
        <div className="border-t border-fd-border p-3">
          <div className="flex items-center gap-2 text-xs">
            <div className={`w-2 h-2 rounded-full ${
              missingRequiredHeaders.length === 0 ? 'bg-green-500' : 'bg-red-500 auth-error-pulse'
            }`} />
            <span className="text-fd-muted-foreground">
              {Object.values(headers).filter(v => v.trim()).length} of {stackAuthHeaders.length} configured
            </span>
          </div>
          {missingRequiredHeaders.length === 0 && Object.values(headers).some(v => v.trim()) && (
            <div className="flex items-center gap-2 text-xs mt-1">
              <div className="w-2 h-2 rounded-full bg-green-500" />
              <span className="text-green-600 dark:text-green-400">
                Ready for API requests
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Mobile Auth Panel */}
      <div className="md:hidden fixed inset-0 z-50 flex flex-col bg-fd-background">
        {/* Mobile Header */}
        <div className="flex items-center justify-between p-3 border-b border-fd-border bg-fd-background">
          <div className="flex items-center gap-2">
            <div className={`w-5 h-5 rounded flex items-center justify-center ${
              highlightMissingHeaders
                ? 'bg-red-100 dark:bg-red-900/30 auth-error-pulse'
                : 'bg-blue-100 dark:bg-blue-900/30'
            }`}>
              {highlightMissingHeaders ? (
                <AlertTriangle className="w-3 h-3 text-red-600 dark:text-red-400" />
              ) : (
                <Key className="w-3 h-3 text-blue-600 dark:text-blue-400" />
              )}
            </div>
            <div>
              <h3 className="font-medium text-fd-foreground text-sm">
                {highlightMissingHeaders ? 'Authentication Required' : 'API Authentication'}
              </h3>
              <p className="text-xs text-fd-muted-foreground">
                Configure headers for requests
              </p>
            </div>
          </div>
          <button
            onClick={toggleAuth}
            className="p-1 text-fd-muted-foreground hover:text-fd-foreground hover:bg-fd-muted rounded transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Error Message - Mobile */}
        <div className="mx-3 mt-3 h-auto">
          {highlightMissingHeaders && lastError ? (
            <div className="p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md auth-error-pulse">
              <div className="flex items-center gap-2 text-xs">
                <AlertTriangle className="w-3 h-3 text-red-600 dark:text-red-400" />
                <span className="text-red-800 dark:text-red-300 font-medium">
                  {lastError.status} Error - Authentication required
                </span>
              </div>
              {missingRequiredHeaders.length > 0 && (
                <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                  Missing: {missingRequiredHeaders.map(h => h.label).join(', ')}
                </p>
              )}
            </div>
          ) : null}
        </div>

        {/* Mobile Content - Fixed height to prevent layout shifts */}
        <div className="flex-1 min-h-0">
          <div className="h-full overflow-y-auto p-3">
            <div className="space-y-3">
              {stackAuthHeaders.map((header) => {
                const isMissing = highlightMissingHeaders && header.required && !headers[header.key].trim();

                return (
                  <div key={header.key} className={`space-y-1.5 ${
                    isMissing ? 'p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md auth-error-pulse' : ''
                  }`}>
                    <label className="text-sm font-medium text-fd-foreground flex items-center gap-2">
                      {header.label}
                      {header.required && (
                        <span className={`text-xs px-1.5 py-0.5 rounded ${
                          isMissing
                            ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                            : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                        }`}>
                          required
                        </span>
                      )}
                      {isMissing && (
                        <AlertTriangle className="w-3 h-3 text-red-500" />
                      )}
                    </label>
                    <input
                      type="text"
                      placeholder={header.placeholder}
                      value={headers[header.key] || ''}
                      onChange={(e) => updateSharedHeaders({ ...headers, [header.key]: e.target.value })}
                      className={`w-full px-3 py-2 border rounded-md text-sm bg-fd-background text-fd-foreground placeholder:text-fd-muted-foreground focus:outline-none focus:ring-1 focus:border-transparent transition-all duration-200 ${
                        isMissing
                          ? 'border-red-300 focus:ring-red-500 dark:border-red-700'
                          : 'border-fd-border focus:ring-fd-primary focus:border-fd-primary'
                      }`}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Mobile Footer */}
        <div className="border-t border-fd-border p-3 bg-fd-background">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs">
              <div className={`w-2 h-2 rounded-full ${
                missingRequiredHeaders.length === 0 ? 'bg-green-500' : 'bg-red-500 auth-error-pulse'
              }`} />
              <span className="text-fd-muted-foreground">
                {Object.values(headers).filter(v => v.trim()).length} of {stackAuthHeaders.length} configured
              </span>
            </div>
            <Button onClick={toggleAuth} className="text-xs px-3 py-1">
              Done
            </Button>
          </div>
          {missingRequiredHeaders.length === 0 && Object.values(headers).some(v => v.trim()) && (
            <div className="flex items-center gap-2 text-xs mt-2">
              <div className="w-2 h-2 rounded-full bg-green-500" />
              <span className="text-green-600 dark:text-green-400">
                Ready for API requests
              </span>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
