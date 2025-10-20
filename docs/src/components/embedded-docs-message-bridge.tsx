'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef } from 'react';

type HistoryStateMessage = {
  type: 'DOCS_HISTORY_STATE',
  canGoBack: boolean,
  pathname: string,
};

type ParentMessage =
  | { type: 'NAVIGATE_BACK' }
  | { type: string }; // Allow for future message types

const getAllowedParentOrigins = (): string[] => {
  if (process.env.NODE_ENV === 'development') {
    return ['http://localhost:8101'];
  }

  return ['https://app.stack-auth.com'];
};

const resolveParentOrigin = (allowedOrigins: string[]): string | null => {
  try {
    if (typeof document !== 'undefined' && document.referrer) {
      const origin = new URL(document.referrer).origin;
      if (allowedOrigins.includes(origin)) {
        return origin;
      }
    }
  } catch (error) {
    console.debug('Unable to derive parent origin from referrer', error);
  }

  return allowedOrigins[0] ?? null;
};

export function EmbeddedDocsMessageBridge() {
  const pathname = usePathname();
  const router = useRouter();

  const allowedOrigins = useMemo(getAllowedParentOrigins, []);
  const parentOrigin = useMemo(
    () => resolveParentOrigin(allowedOrigins),
    [allowedOrigins]
  );

  const historyRef = useRef<string[]>([]);
  const indexRef = useRef<number>(-1);

  const notifyParent = useCallback((canGoBack: boolean) => {
    if (typeof window === 'undefined') return;
    if (window.parent === window) return;
    if (!parentOrigin) return;

    const currentPath =
      historyRef.current[indexRef.current] ?? pathname;

    const message: HistoryStateMessage = {
      type: 'DOCS_HISTORY_STATE',
      canGoBack,
      pathname: currentPath,
    };

    try {
      window.parent.postMessage(message, parentOrigin);
    } catch (error) {
      console.debug('Failed to post history state to parent', error);
    }
  }, [parentOrigin, pathname]);

  // Track navigation within the embedded docs to maintain a local history stack
  useEffect(() => {
    const history = historyRef.current;

    if (indexRef.current === -1) {
      history.push(pathname);
      indexRef.current = history.length - 1;
      notifyParent(false);
      return;
    }

    const currentPath = history[indexRef.current];

    if (pathname === currentPath) {
      notifyParent(indexRef.current > 0);
      return;
    }

    if (indexRef.current < history.length - 1) {
      history.splice(indexRef.current + 1);
    }

    history.push(pathname);
    indexRef.current = history.length - 1;
    notifyParent(indexRef.current > 0);
  }, [notifyParent, pathname]);

  // Listen for commands from the parent (e.g., back navigation)
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleMessage = (event: MessageEvent) => {
      if (event.source !== window.parent) return;
      if (!allowedOrigins.includes(event.origin)) return;
      if (!event.data) return;
      if (typeof event.data !== 'object') return;

      const messageData = event.data as ParentMessage;
      if (messageData.type === 'NAVIGATE_BACK') {
        if (indexRef.current > 0) {
          indexRef.current -= 1;
          const targetPath = historyRef.current[indexRef.current];
          if (targetPath) {
          router.push(targetPath);
          } else {
          notifyParent(false);
          }
        } else {
        notifyParent(false);
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [allowedOrigins, notifyParent, router]);

  return null;
}
