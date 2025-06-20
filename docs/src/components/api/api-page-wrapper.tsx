'use client';

import { AlertTriangle, Key, X } from 'lucide-react';
import { createContext, ReactNode, useContext, useState } from 'react';
import { Button } from './button';

// Stack Auth required headers
const STACK_AUTH_HEADERS = {
  'Content-Type': 'application/json',
  'X-Stack-Access-Type': '', // client or server
  'X-Stack-Project-Id': '', // project UUID
  'X-Stack-Publishable-Client-Key': '', // pck_...
  'X-Stack-Secret-Server-Key': '', // ssk_...
  'X-Stack-Access-Token': '', // user's access token
};

// Type for API error objects
type APIError = {
  message?: string,
  error?: string,
  details?: string,
  code?: string | number,
  [key: string]: unknown,
}

// Context for sharing headers across all API components on the page
type APIPageContextType = {
  sharedHeaders: Record<string, string>,
  updateSharedHeaders: (headers: Record<string, string>) => void,
  reportError: (status: number, error: APIError) => void,
  isHeadersPanelOpen: boolean,
}

const APIPageContext = createContext<APIPageContextType | null>(null);

export function useAPIPageContext() {
  const context = useContext(APIPageContext);
  if (!context) {
    throw new Error('useAPIPageContext must be used within APIPageWrapper');
  }
  return context;
}

type APIPageWrapperProps = {
  children: ReactNode,
}

export function APIPageWrapper({ children }: APIPageWrapperProps) {
  const [sharedHeaders, setSharedHeaders] = useState<Record<string, string>>(STACK_AUTH_HEADERS);
  const [isHeadersPanelOpen, setIsHeadersPanelOpen] = useState(false);
  const [lastError, setLastError] = useState<{ status: number, error: APIError } | null>(null);
  const [highlightMissingHeaders, setHighlightMissingHeaders] = useState(false);

  const updateSharedHeaders = (headers: Record<string, string>) => {
    setSharedHeaders(headers);
    // Clear error highlighting when headers are updated
    if (highlightMissingHeaders) {
      setHighlightMissingHeaders(false);
    }
  };

  const reportError = (status: number, error: APIError) => {
    setLastError({ status, error });

    // Auto-open panel and highlight missing headers on 400/401/403 errors
    if ([400, 401, 403].includes(status)) {
      setIsHeadersPanelOpen(true);
      setHighlightMissingHeaders(true);

      // Auto-hide highlighting after 10 seconds
      setTimeout(() => {
        setHighlightMissingHeaders(false);
      }, 10000);
    }
  };

  const stackAuthHeaders = [
    { key: 'Content-Type', label: 'Content Type', placeholder: 'application/json', required: true },
    { key: 'X-Stack-Access-Type', label: 'Access Type', placeholder: 'client or server', required: true },
    { key: 'X-Stack-Project-Id', label: 'Project ID', placeholder: 'your-project-uuid', required: true },
    { key: 'X-Stack-Publishable-Client-Key', label: 'Client Key', placeholder: 'pck_your_key_here', required: false },
    { key: 'X-Stack-Secret-Server-Key', label: 'Server Key', placeholder: 'ssk_your_key_here', required: false },
    { key: 'X-Stack-Access-Token', label: 'Access Token', placeholder: 'user_access_token', required: false },
  ];

  const missingRequiredHeaders = stackAuthHeaders.filter(
    header => header.required && !sharedHeaders[header.key].trim()
  );

  return (
    <APIPageContext.Provider value={{ sharedHeaders, updateSharedHeaders, reportError, isHeadersPanelOpen }}>
      <div className="relative flex">
        {/* Desktop Sidebar Headers Panel */}
        <div className={`hidden md:block fixed right-4 top-4 bottom-4 z-50 transition-all duration-300 ${
          isHeadersPanelOpen ? 'w-80' : 'w-auto'
        }`}>
          <div className="h-full flex flex-col">
            {/* Panel Toggle Button */}
            <div className="mb-4 flex justify-end">
              <Button
                onClick={() => setIsHeadersPanelOpen(!isHeadersPanelOpen)}
                className={`flex items-center justify-center gap-2 shadow-lg transition-all duration-300 w-24 ${
                  highlightMissingHeaders
                    ? 'bg-red-500 hover:bg-red-600 text-white animate-pulse'
                    : 'bg-fd-primary hover:bg-fd-primary/90'
                } ${isHeadersPanelOpen ? 'rounded-t-xl rounded-b-none' : 'rounded-t-xl rounded-b-none'}`}
              >
                <Key className="w-4 h-4 flex-shrink-0" />
                <span className="hidden sm:inline text-sm">
                  {isHeadersPanelOpen ? 'Hide' : 'Auth'}
                </span>
                {isHeadersPanelOpen ? (
                  <X className="w-4 h-4 flex-shrink-0" />
                ) : (
                  missingRequiredHeaders.length > 0 && (
                    <div className="w-2 h-2 bg-red-400 rounded-full animate-pulse flex-shrink-0" />
                  )
                )}
              </Button>
            </div>

            {/* Panel Content */}
            <div className={`flex-1 ${isHeadersPanelOpen ? '' : 'pointer-events-none'}`}>
              {isHeadersPanelOpen && (
                <div className="h-full bg-fd-card border border-fd-border rounded-xl shadow-xl overflow-hidden flex flex-col w-80">
                  {/* Panel Header */}
                  <div className="p-4 bg-fd-muted/30 border-b border-fd-border">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                        highlightMissingHeaders
                          ? 'bg-red-100 dark:bg-red-900/30'
                          : 'bg-blue-100 dark:bg-blue-900/30'
                      }`}>
                        {highlightMissingHeaders ? (
                          <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400" />
                        ) : (
                          <Key className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                        )}
                      </div>
                      <div>
                        <h3 className="font-semibold text-fd-foreground">
                          {highlightMissingHeaders ? 'Authentication Required' : 'Global Authentication'}
                        </h3>
                        <p className="text-sm text-fd-muted-foreground">
                          {highlightMissingHeaders
                            ? 'Please configure the required headers below'
                            : 'Configure headers for all API requests'
                          }
                        </p>
                      </div>
                    </div>

                    {/* Error Message */}
                    {highlightMissingHeaders && lastError && (
                      <div className="mt-3 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                        <div className="flex items-center gap-2 text-sm">
                          <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400" />
                          <span className="text-red-800 dark:text-red-300 font-medium">
                            {lastError.status} Error - Authentication required
                          </span>
                        </div>
                        {missingRequiredHeaders.length > 0 && (
                          <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                            Missing required headers: {missingRequiredHeaders.map(h => h.label).join(', ')}
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Panel Content - Scrollable */}
                  <div className="flex-1 overflow-y-auto p-4">
                    <div className="space-y-4">
                      {stackAuthHeaders.map((header) => {
                        const isMissing = highlightMissingHeaders && header.required && !sharedHeaders[header.key].trim();

                        return (
                          <div key={header.key} className={`space-y-2 p-3 rounded-lg transition-all duration-300 ${
                            isMissing
                              ? 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800'
                              : 'bg-fd-muted/20'
                          }`}>
                            <label className="text-sm font-medium text-fd-foreground flex items-center gap-2">
                              {header.label}
                              {header.required && (
                                <span className={`text-xs px-2 py-0.5 rounded-full ${
                                  isMissing
                                    ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 animate-pulse'
                                    : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                                }`}>
                                  required
                                </span>
                              )}
                              {isMissing && (
                                <AlertTriangle className="w-3 h-3 text-red-500 animate-pulse" />
                              )}
                            </label>
                            <input
                              type="text"
                              placeholder={header.placeholder}
                              value={sharedHeaders[header.key] || ''}
                              onChange={(e) => updateSharedHeaders({ ...sharedHeaders, [header.key]: e.target.value })}
                              className={`w-full px-3 py-2 border rounded-lg bg-fd-background text-fd-foreground text-sm focus:outline-none focus:ring-2 focus:border-transparent transition-all duration-200 ${
                                isMissing
                                  ? 'border-red-300 focus:ring-red-500 dark:border-red-700'
                                  : 'border-fd-border focus:ring-fd-primary'
                              }`}
                            />
                          </div>
                        );
                      })}
                    </div>

                    {/* Status Indicator */}
                    <div className="mt-4 pt-4 border-t border-fd-border">
                      <div className="flex items-center gap-2 text-sm">
                        <div className={`w-2 h-2 rounded-full ${
                          missingRequiredHeaders.length === 0
                            ? 'bg-green-500'
                            : 'bg-red-500'
                        }`} />
                        <span className="text-fd-muted-foreground">
                          {Object.values(sharedHeaders).filter(v => v.trim()).length} of {stackAuthHeaders.length} headers configured
                        </span>
                      </div>
                      {missingRequiredHeaders.length === 0 && Object.values(sharedHeaders).some(v => v.trim()) && (
                        <div className="flex items-center gap-2 text-sm mt-1">
                          <div className="w-2 h-2 rounded-full bg-green-500" />
                          <span className="text-green-600 dark:text-green-400 text-xs">
                            Ready to make authenticated requests
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Mobile Floating Button - only show when overlay is closed */}
        {!isHeadersPanelOpen && (
          <div className="md:hidden fixed bottom-6 right-6 z-[100]">
            <Button
              onClick={() => setIsHeadersPanelOpen(!isHeadersPanelOpen)}
              className={`flex items-center justify-center gap-2 shadow-2xl transition-all duration-300 w-14 h-14 rounded-full border-2 border-white/20 ${
                highlightMissingHeaders
                  ? 'bg-red-500 hover:bg-red-600 text-white animate-pulse'
                  : 'bg-fd-primary hover:bg-fd-primary/90 text-white'
              }`}
            >
              <Key className="w-5 h-5 flex-shrink-0" />
              {missingRequiredHeaders.length > 0 && (
                <div className="absolute -top-1 -right-1 w-3 h-3 bg-red-400 rounded-full animate-pulse flex-shrink-0" />
              )}
            </Button>
          </div>
        )}

        {/* Mobile Full-Screen Overlay */}
        {isHeadersPanelOpen && (
          <div className="md:hidden fixed inset-0 z-50 flex flex-col bg-fd-background">
            {/* Mobile Header */}
            <div className="flex items-center justify-between p-4 border-b border-fd-border bg-fd-card">
              <div className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                  highlightMissingHeaders
                    ? 'bg-red-100 dark:bg-red-900/30'
                    : 'bg-blue-100 dark:bg-blue-900/30'
                }`}>
                  {highlightMissingHeaders ? (
                    <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400" />
                  ) : (
                    <Key className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  )}
                </div>
                <div>
                  <h3 className="font-semibold text-fd-foreground">
                    {highlightMissingHeaders ? 'Authentication Required' : 'API Authentication'}
                  </h3>
                  <p className="text-sm text-fd-muted-foreground">
                    Configure headers for requests
                  </p>
                </div>
              </div>
              <Button
                onClick={() => setIsHeadersPanelOpen(false)}
              >
                <X className="w-5 h-5" />
              </Button>
            </div>

            {/* Error Message - Mobile */}
            {highlightMissingHeaders && lastError && (
              <div className="mx-4 mt-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                <div className="flex items-center gap-2 text-sm">
                  <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400" />
                  <span className="text-red-800 dark:text-red-300 font-medium">
                    {lastError.status} Error - Authentication required
                  </span>
                </div>
                {missingRequiredHeaders.length > 0 && (
                  <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                    Missing required headers: {missingRequiredHeaders.map(h => h.label).join(', ')}
                  </p>
                )}
              </div>
            )}

            {/* Mobile Content - Scrollable */}
            <div className="flex-1 overflow-y-auto p-4">
              <div className="space-y-4">
                {stackAuthHeaders.map((header) => {
                  const isMissing = highlightMissingHeaders && header.required && !sharedHeaders[header.key].trim();

                  return (
                    <div key={header.key} className={`space-y-2 p-4 rounded-lg transition-all duration-300 ${
                      isMissing
                        ? 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800'
                        : 'bg-fd-card border border-fd-border'
                    }`}>
                      <label className="text-sm font-medium text-fd-foreground flex items-center gap-2">
                        {header.label}
                        {header.required && (
                          <span className={`text-xs px-2 py-0.5 rounded-full ${
                            isMissing
                              ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 animate-pulse'
                              : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                          }`}>
                            required
                          </span>
                        )}
                        {isMissing && (
                          <AlertTriangle className="w-3 h-3 text-red-500 animate-pulse" />
                        )}
                      </label>
                      <input
                        type="text"
                        placeholder={header.placeholder}
                        value={sharedHeaders[header.key] || ''}
                        onChange={(e) => updateSharedHeaders({ ...sharedHeaders, [header.key]: e.target.value })}
                        className={`w-full px-4 py-3 border rounded-lg bg-fd-background text-fd-foreground text-base focus:outline-none focus:ring-2 focus:border-transparent transition-all duration-200 ${
                          isMissing
                            ? 'border-red-300 focus:ring-red-500 dark:border-red-700'
                            : 'border-fd-border focus:ring-fd-primary'
                        }`}
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Mobile Footer with Status */}
            <div className="border-t border-fd-border p-4 bg-fd-card">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm">
                  <div className={`w-2 h-2 rounded-full ${
                    missingRequiredHeaders.length === 0
                      ? 'bg-green-500'
                      : 'bg-red-500'
                  }`} />
                  <span className="text-fd-muted-foreground">
                    {Object.values(sharedHeaders).filter(v => v.trim()).length} of {stackAuthHeaders.length} configured
                  </span>
                </div>
                <Button
                  onClick={() => setIsHeadersPanelOpen(false)}
                >
                  Done
                </Button>
              </div>
              {missingRequiredHeaders.length === 0 && Object.values(sharedHeaders).some(v => v.trim()) && (
                <div className="flex items-center gap-2 text-sm mt-2">
                  <div className="w-2 h-2 rounded-full bg-green-500" />
                  <span className="text-green-600 dark:text-green-400 text-xs">
                    Ready to make authenticated requests
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Main Content - Desktop gets margin, Mobile stays full width */}
        <div className={`flex-1 transition-all duration-300 ${
          isHeadersPanelOpen ? 'md:mr-80' : 'mr-0'
        }`}>
          {children}
        </div>
      </div>
    </APIPageContext.Provider>
  );
}
