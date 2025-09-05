'use client';

import { useEffect } from 'react';

// Map regular doc routes to embedded routes and resolve relative paths
const getEmbeddedUrl = (href: string, currentPath: string): string => {
  // Ignore absolute-URL schemes (http:, https:, mailto:, tel:, javascript:, etc.)
  if (/^[a-zA-Z][a-zA-Z+\-.]*:/.test(href)) return href;

  // Preserve query/hash
  const [pathAndQuery, hash = ''] = href.split('#', 2);
  const [rawPath, query = ''] = pathAndQuery.split('?', 2);
  let cleanPath = rawPath;

  // Strip .md/.mdx
  if (cleanPath.endsWith('.md')) cleanPath = cleanPath.slice(0, -3);
  else if (cleanPath.endsWith('.mdx')) cleanPath = cleanPath.slice(0, -4);

  // Remove leading ./ (relative indicator)
  if (cleanPath.startsWith('./')) cleanPath = cleanPath.slice(2);

  // Already an embedded URL?
  if (
    cleanPath.startsWith('/docs-embed') ||
    cleanPath.startsWith('/api-embed') ||
    cleanPath.startsWith('/dashboard-embed')
  ) {
    return withSuffix(cleanPath);
  }

  // Absolute roots -> embedded roots
  if (cleanPath === '/docs' || cleanPath.startsWith('/docs/')) {
    return withSuffix(cleanPath.replace(/^\/docs(?=\/|$)/, '/docs-embed'));
  }
  if (cleanPath === '/api' || cleanPath.startsWith('/api/')) {
    return withSuffix(cleanPath.replace(/^\/api(?=\/|$)/, '/api-embed'));
  }
  if (cleanPath === '/dashboard' || cleanPath.startsWith('/dashboard/')) {
    return withSuffix(cleanPath.replace(/^\/dashboard(?=\/|$)/, '/dashboard-embed'));
  }

  // Relative paths -> resolve against current embedded section (if present)
  if (!cleanPath.startsWith('/') && !cleanPath.startsWith('#')) {
    const parts = currentPath.split('/').filter(Boolean);
    if (parts.length >= 1 && parts[0].endsWith('-embed')) {
      const embedType = parts[0];
      const section = parts[1] ?? '';
      const base = section ? `/${embedType}/${section}/` : `/${embedType}/`;
      return withSuffix(normalizePath(base + cleanPath));
    }
  }

  // Other absolute paths -> treat as relative to current embedded section
  if (cleanPath.startsWith('/')) {
    const parts = currentPath.split('/').filter(Boolean);
    if (parts.length >= 1 && parts[0].endsWith('-embed')) {
      const embedType = parts[0];
      const section = parts[1] ?? '';
      const base = section ? `/${embedType}/${section}/` : `/${embedType}/`;
      return withSuffix(normalizePath(base + (cleanPath.startsWith('/') ? cleanPath.slice(1) : cleanPath)));
    }
  }

  return withSuffix(cleanPath);

  function withSuffix(p: string) {
    const q = query ? `?${query}` : '';
    const h = hash ? `#${hash}` : '';
    return `${p}${q}${h}`;
  }
  function normalizePath(p: string) {
    const segs = p.split('/').filter(Boolean);
    const out: string[] = [];
    for (const s of segs) {
      if (s === '.') continue;
      if (s === '..') {
        out.pop();
        continue;
      }
      out.push(s);
    }
    return '/' + out.join('/');
  }
};

export function EmbeddedLinkInterceptor() {

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
      if (event.defaultPrevented || event.button !==0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }

      const target = event.target as HTMLElement;

      // Find the closest anchor tag
      const anchor = target.closest('a');
      if (!anchor) return;

      const href = anchor.getAttribute('href');
      if (!href) return;

      if (anchor.target === "_blank" || anchor.hasAttribute('download')) {
        return;
      }

      if (href.startsWith('javascript:') || href.startsWith('data:') || href.startsWith('blob:')) {
        return;
      }

      // Intercept internal links that need to be rewritten OR relative links
      if (href.startsWith('/docs/') || href.startsWith('/api/') || href.startsWith('/dashboard/') ||
+          (!/^[a-zA-Z][a-zA-Z+\-.]*:/.test(href) && !href.startsWith('#'))) {
        event.preventDefault();

        const currentPath = window.location.pathname;
        const embeddedHref = getEmbeddedUrl(href, currentPath);

        // Check if the URL exists before navigating (async operation)
        checkUrlExists(embeddedHref).then((urlExists) => {
          if (urlExists) {
            // Navigate to the embedded version
            window.location.href = embeddedHref;
          }
        }).catch(() => {
          // Network error or other issue - silently ignore
        });
      }
    };

    // Add click listener to document
    document.addEventListener('click', handleClick);

    // Cleanup
    return () => {
      document.removeEventListener('click', handleClick);
    };
  }, []);

  return null;
}
