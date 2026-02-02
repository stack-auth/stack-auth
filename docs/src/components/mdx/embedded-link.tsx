'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ComponentProps } from 'react';

type EmbeddedLinkProps = ComponentProps<'a'> & {
  isEmbedded?: boolean,
};

// Map regular doc routes to embedded routes
const getEmbeddedUrl = (href: string, currentPath?: string): string => {
  // Handle hash-only links (like #section)
  if (href.startsWith('#')) {
    return href;
  }

  // Handle external links (http://, https://, mailto:, etc.)
  if (href.includes('://') || href.startsWith('mailto:')) {
    return href;
  }

  // Handle absolute paths
  if (href.startsWith('/')) {
    // Already embedded - leave as is
    if (href.startsWith('/docs-embed/') || href.startsWith('/api-embed/')) {
      return href;
    }

    // Convert regular doc routes to embedded routes
    if (href.startsWith('/docs/')) {
      return href.replace('/docs/', '/docs-embed/');
    }
    if (href.startsWith('/api/')) {
      return href.replace('/api/', '/api-embed/');
    }

    // Other absolute paths - leave as is
    return href;
  }

  // Handle relative links (like ./setup.mdx or users.mdx)
  // These need to be resolved relative to the current embedded path
  if (currentPath && (currentPath.startsWith('/docs-embed/') || currentPath.startsWith('/api-embed/'))) {
    // Remove .mdx extension if present
    const cleanHref = href.replace(/\.mdx?$/, '');

    const hashIndex = cleanHref.indexOf('#');
    const queryIndex = cleanHref.indexOf('?');
    const splitIndex = hashIndex !== -1 && queryIndex !== -1
      ? Math.min(hashIndex, queryIndex)
      : (hashIndex !== -1 ? hashIndex : queryIndex);
    const pathPart = splitIndex !== -1 ? cleanHref.substring(0, splitIndex) : cleanHref;
    const suffix = splitIndex !== -1 ? cleanHref.substring(splitIndex) : '';

    // Get current directory
    const currentDir = currentPath.substring(0, currentPath.lastIndexOf('/'));

    // Resolve relative path
    let resolvedPath: string;
    if (pathPart.startsWith('./')) {
      resolvedPath = `${currentDir}/${pathPart.substring(2)}`;
    } else if (pathPart.startsWith('../')) {
      // Go up one directory
      const parentDir = currentDir.substring(0, currentDir.lastIndexOf('/'));
      resolvedPath = `${parentDir}/${pathPart.substring(3)}`;
    } else {
      // Same directory
      resolvedPath = `${currentDir}/${pathPart}`;
    }
    return resolvedPath + suffix;
  }

  // Fallback - return as is
  return href;
};

export function EmbeddedLink({ href, isEmbedded, children, ...restProps }: EmbeddedLinkProps) {
  const currentPath = usePathname();

  // Explicitly type props to exclude already-destructured properties
  const props = restProps as Omit<ComponentProps<'a'>, 'href' | 'children' | 'isEmbedded'>;

  // If not embedded or no href, use regular link behavior
  if (!isEmbedded || !href) {
    return <a href={href} {...props}>{children}</a>;
  }

  const embeddedHref = getEmbeddedUrl(href, currentPath);

  // For internal links, use Next.js Link for better performance
  if (embeddedHref.startsWith('/')) {
    return (
      <Link href={embeddedHref} {...props}>
        {children}
      </Link>
    );
  }

  // For external links, use regular anchor tag
  return <a href={embeddedHref} {...props}>{children}</a>;
}
