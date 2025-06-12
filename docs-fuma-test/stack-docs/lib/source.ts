import { api, docs } from '@/.source';
import { loader } from 'fumadocs-core/source';
import { attachFile } from 'fumadocs-openapi/server';
import { icons } from 'lucide-react';
import { createElement } from 'react';

// Main docs source for /docs routes
export const source = loader({
  // it assigns a URL to your pages
  baseUrl: '/docs',
  source: docs.toFumadocsSource(),
  pageTree: {
    attachFile,
  },
  icon(icon) {
    if (!icon) {
      // You may set a default icon here if needed
      return;
    }

    if (icon in icons) {
      return createElement(icons[icon as keyof typeof icons]);
    }

    // Fallback to undefined if icon is not found
    return;
  },
});

// API source for /api routes
export const apiSource = loader({
  baseUrl: '/api',
  source: api.toFumadocsSource(),
  pageTree: {
    attachFile,
  },
  icon(icon) {
    if (!icon) {
      return;
    }

    if (icon in icons) {
      return createElement(icons[icon as keyof typeof icons]);
    }

    return;
  },
});
