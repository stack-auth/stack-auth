import Link from 'next/link';
import { ComponentProps } from 'react';

type EmbeddedLinkProps = ComponentProps<'a'> & {
  isEmbedded?: boolean,
};

// Map regular doc routes to embedded routes
const getEmbeddedUrl = (href: string): string => {
  // Handle relative links
  if (href.startsWith('/')) {
    // Convert regular doc routes to embedded routes
    if (href.startsWith('/docs/')) {
      return href.replace('/docs/', '/docs-embed/');
    }
    if (href.startsWith('/api/')) {
      return href.replace('/api/', '/api-embed/');
    }
    if (href.startsWith('/dashboard/')) {
      return href.replace('/dashboard/', '/dashboard-embed/');
    }
  }

  // Return unchanged for external links or already embedded links
  return href;
};

export function EmbeddedLink({ href, isEmbedded, children, ...props }: EmbeddedLinkProps) {
  // If not embedded or no href, use regular link behavior
  if (!isEmbedded || !href) {
    return <a href={href} {...props}>{children}</a>;
  }

  const embeddedHref = getEmbeddedUrl(href);

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
