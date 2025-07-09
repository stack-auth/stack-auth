'use client';

import { createContext, ReactNode, useContext, useState } from 'react';
import { useSidebar } from '../layouts/sidebar-context';

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
  lastError: { status: number, error: APIError } | null,
  highlightMissingHeaders: boolean,
}

const APIPageContext = createContext<APIPageContextType | null>(null);

// Hook to access API page context - returns null when not used within APIPageWrapper
export function useAPIPageContext() {
  const context = useContext(APIPageContext);
  // Return null instead of throwing error when context is not available
  // This makes it safe to use in components that might be rendered outside of APIPageContextProvider
  return context;
}

type APIPageWrapperProps = {
  children: ReactNode,
}

export function APIPageWrapper({ children }: APIPageWrapperProps) {
  const sidebarContext = useSidebar();
  const [sharedHeaders, setSharedHeaders] = useState<Record<string, string>>(STACK_AUTH_HEADERS);
  const [lastError, setLastError] = useState<{ status: number, error: APIError } | null>(null);
  const [highlightMissingHeaders, setHighlightMissingHeaders] = useState(false);

  // Use default functions if sidebar context is not available
  const { isAuthOpen, toggleAuth } = sidebarContext || {
    isAuthOpen: false,
    toggleAuth: () => {}
  };

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
      if (!isAuthOpen) {
        toggleAuth();
      }
      setHighlightMissingHeaders(true);

      // Auto-hide highlighting after 10 seconds
      setTimeout(() => {
        setHighlightMissingHeaders(false);
      }, 10000);
    }
  };

  return (
    <APIPageContext.Provider value={{ sharedHeaders, updateSharedHeaders, reportError, lastError, highlightMissingHeaders }}>
      {children}
    </APIPageContext.Provider>
  );
}
