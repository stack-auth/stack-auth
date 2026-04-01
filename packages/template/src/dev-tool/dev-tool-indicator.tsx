"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useUser } from "../lib/hooks";
import { DevToolProvider, useDevToolContext, type ApiLogEntry, type EventLogEntry } from "./dev-tool-context";
import { DevToolPanel } from "./dev-tool-panel";
import { devToolCSS } from "./dev-tool-styles";
import { DevToolTrigger } from "./dev-tool-trigger";

// IF_PLATFORM react-like

let idCounter = 0;
function nextId() {
  return `sdt-${++idCounter}-${Date.now()}`;
}

/**
 * Intercepts window.fetch to capture Stack Auth API calls.
 * Only intercepts requests that include the `X-Stack-Project-Id` header.
 */
function useFetchInterceptor(addApiLog: (entry: ApiLogEntry) => void, addEventLog: (entry: EventLogEntry) => void) {
  const addApiLogRef = useRef(addApiLog);
  addApiLogRef.current = addApiLog;
  const addEventLogRef = useRef(addEventLog);
  addEventLogRef.current = addEventLog;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    // Avoid double-patching (e.g. during HMR remounts)
    // Cast to any: adding a runtime-only property (__stackDevToolPatched) to window.fetch which isn't in DOM types
    if ((window.fetch as any).__stackDevToolPatched) return;

    const originalFetch = window.fetch;

    const patchedFetch = async function (input: RequestInfo | URL, init?: RequestInit) {
      // Determine if this is a Stack Auth API call by checking for the header.
      // When input is a Request, its headers/method may carry the info even if
      // init is absent, so we merge both sources (init takes precedence).
      let resolvedHeaders: HeadersInit | undefined = init?.headers;
      let method = init?.method ?? (input instanceof Request ? input.method : 'GET');

      if (!resolvedHeaders && input instanceof Request) {
        resolvedHeaders = input.headers;
      }

      let isStackCall = false;
      if (resolvedHeaders) {
        if (resolvedHeaders instanceof Headers) {
          isStackCall = resolvedHeaders.has('X-Stack-Project-Id');
        } else if (Array.isArray(resolvedHeaders)) {
          isStackCall = resolvedHeaders.some(([key]) => key === 'X-Stack-Project-Id');
        } else {
          isStackCall = 'X-Stack-Project-Id' in resolvedHeaders;
        }
      }

      if (!isStackCall) {
        return await originalFetch.call(window, input, init);
      }

      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      // Strip query params with nonces for cleaner display
      let displayUrl = url;
      try {
        const u = new URL(url);
        u.searchParams.delete('X-Stack-Random-Nonce');
        // Show path only for cleaner logs
        displayUrl = u.pathname + (u.search || '');
      } catch {
        // keep full url
      }

      const timestamp = Date.now();
      const startMono = performance.now();

      try {
        const response = await originalFetch.call(window, input, init);

        const duration = Math.round(performance.now() - startMono);
        addApiLogRef.current({
          id: nextId(),
          timestamp,
          method: method.toUpperCase(),
          url: displayUrl,
          status: response.status,
          duration,
        });

        // Detect auth-related events from the response path
        if (displayUrl.includes('/auth/')) {
          if (displayUrl.includes('/auth/oauth/token') && response.ok) {
            addEventLogRef.current({
              id: nextId(),
              timestamp: Date.now(),
              type: 'token-refresh',
              message: 'Token refreshed',
            });
          }
          if (displayUrl.includes('/auth/sessions') && init?.method === 'DELETE' && response.ok) {
            addEventLogRef.current({
              id: nextId(),
              timestamp: Date.now(),
              type: 'sign-out',
              message: 'User signed out (session deleted)',
            });
          }
        }

        if (!response.ok && response.status >= 400) {
          addEventLogRef.current({
            id: nextId(),
            timestamp: Date.now(),
            type: 'error',
            message: `API error ${response.status} on ${method.toUpperCase()} ${displayUrl}`,
          });
        }

        return response;
      } catch (err) {
        const duration = Math.round(performance.now() - startMono);
        addApiLogRef.current({
          id: nextId(),
          timestamp,
          method: method.toUpperCase(),
          url: displayUrl,
          duration,
          error: err instanceof Error ? err.message : 'Network error',
        });

        addEventLogRef.current({
          id: nextId(),
          timestamp: Date.now(),
          type: 'error',
          message: `Network error on ${method.toUpperCase()} ${displayUrl}: ${err instanceof Error ? err.message : 'Unknown'}`,
        });

        throw err;
      }
    };
    window.fetch = patchedFetch;
    (window.fetch as any).__stackDevToolPatched = true;

    return () => {
      // Only restore if our patch is still the active one
      if (window.fetch === patchedFetch) {
        window.fetch = originalFetch;
      }
    };
  }, []);
}

/**
 * Watches user state changes to log auth events.
 */
function useAuthEventTracker(addEventLog: (entry: EventLogEntry) => void) {
  const user = useUser();
  const prevUserRef = useRef<typeof user | undefined>(undefined);
  const addEventLogRef = useRef(addEventLog);
  addEventLogRef.current = addEventLog;

  useEffect(() => {
    const prevUser = prevUserRef.current;
    // Skip initial mount (prevUser is undefined)
    if (prevUser === undefined) {
      prevUserRef.current = user;
      if (user) {
        addEventLogRef.current({
          id: nextId(),
          timestamp: Date.now(),
          type: 'info',
          message: `Session started: ${user.displayName || user.primaryEmail || user.id}`,
        });
      }
      return;
    }

    if (!prevUser && user) {
      addEventLogRef.current({
        id: nextId(),
        timestamp: Date.now(),
        type: 'sign-in',
        message: `User signed in: ${user.displayName || user.primaryEmail || user.id}`,
      });
    } else if (prevUser && !user) {
      addEventLogRef.current({
        id: nextId(),
        timestamp: Date.now(),
        type: 'sign-out',
        message: 'User signed out',
      });
    }

    prevUserRef.current = user;
  }, [user]);
}

function DevToolIndicatorInner() {
  const { state, setState, addApiLog, addEventLog } = useDevToolContext();
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);

  // Wire up fetch interceptor and auth event tracking
  useFetchInterceptor(addApiLog, addEventLog);
  useAuthEventTracker(addEventLog);

  useEffect(() => {
    // Create a portal container attached to document.body
    const container = document.createElement('div');
    container.id = '__stack-dev-tool-root';
    document.body.appendChild(container);
    setPortalContainer(container);

    return () => {
      document.body.removeChild(container);
    };
  }, []);

  // Keyboard shortcut: Ctrl+Shift+S / Cmd+Shift+S
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'S') {
        e.preventDefault();
        setState((prev) => ({ ...prev, isOpen: !prev.isOpen }));
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [setState]);

  const togglePanel = useCallback(() => {
    setState((prev) => ({ ...prev, isOpen: !prev.isOpen }));
  }, [setState]);

  const closePanel = useCallback(() => {
    setState((prev) => ({ ...prev, isOpen: false }));
  }, [setState]);

  if (portalContainer == null) return null;

  return createPortal(
    <div className="stack-devtool">
      <style dangerouslySetInnerHTML={{ __html: devToolCSS }} />
      <DevToolTrigger onClick={togglePanel} />
      {state.isOpen && <DevToolPanel onClose={closePanel} />}
    </div>,
    portalContainer,
  );
}

export function DevToolIndicator() {
  return (
    <DevToolProvider>
      <DevToolIndicatorInner />
    </DevToolProvider>
  );
}

// END_PLATFORM
