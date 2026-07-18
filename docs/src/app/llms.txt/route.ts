import { apiSource, source } from 'lib/source';

// cached forever
export const revalidate = false;

function formatPageListItem(page: {
  data: {
    title: string;
    description?: string;
  };
  url: string;
}) {
  const title = page.data.title
    .replace(/\\/g, '\\\\')
    .replace(/[\[\]]/g, (match) => `\\${match}`)
    .replace(/\n+/g, ' ');
  const description = page.data.description?.trim();
  const notes = description ? `: ${description.replace(/\n+/g, ' ')}` : '';
  return `- [${title}](https://docs.hexclave.com${page.url}.md)${notes}`;
}

export async function GET() {
  const docsPages = source.getPages();
  const apiPages = apiSource.getPages();

  const docs = docsPages.map(formatPageListItem).join('\n');
  const api = apiPages.map(formatPageListItem).join('\n');

  return new Response(`# Hexclave

> Hexclave is an authentication and user management platform for SaaS apps, with teams, RBAC, payments, and analytics. Formerly Stack Auth.

## Docs

${docs}

## API Reference

${api}`);
}
