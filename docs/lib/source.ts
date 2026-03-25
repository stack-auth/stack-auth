import { api, docs } from '@/.source';
import { loader } from 'fumadocs-core/source';
import { attachFile } from 'fumadocs-openapi/server';
import { icons } from 'lucide-react';
import { createElement } from 'react';

// Helper function to create icon resolver
function createIconResolver() {
  return function icon(iconName?: string) {
    if (!iconName) {
      return;
    }

    if (iconName in icons) {
      return createElement(icons[iconName as keyof typeof icons]);
    }

    return;
  };
}

// Main docs source for /docs routes - includes all root sections
export const source = loader({
  baseUrl: '/docs',
  source: docs.toFumadocsSource(),
  pageTree: {
    attachFile,
  },
  icon: createIconResolver(),
});

// API source for /api routes
export const apiSource = loader({
  baseUrl: '/api',
  source: api.toFumadocsSource(),
  pageTree: {
    attachFile,
  },
  icon: createIconResolver(),
});
