import type { PageTree } from 'fumadocs-core/server';

export type DocsSection = 'guides' | 'sdk' | 'components';

const DOCS_ROOT = '/docs';

export function resolveDocsSection(pathname: string): DocsSection {
  if (pathname.startsWith(`${DOCS_ROOT}/sdk`)) {
    return 'sdk';
  }

  if (pathname.startsWith(`${DOCS_ROOT}/components`)) {
    return 'components';
  }

  return 'guides';
}

export function filterTreeForSection(tree: PageTree.Root, section: DocsSection): PageTree.Root {
  const filteredChildren = flattenRootChildren(
    pruneSeparators(
      tree.children
        .map(child => filterNode(child, section))
        .filter((node): node is PageTree.Node => node !== null),
    ),
  );

  return {
    ...tree,
    children: filteredChildren,
  };
}

function filterNode(node: PageTree.Node, section: DocsSection): PageTree.Node | null {
  if (node.type === 'separator') {
    return node;
  }

  if (node.type === 'page') {
    return matchesSection(node.url, section) ? node : null;
  }

  const {
    index: originalIndex,
    children: originalChildren,
    ...rest
  } = node;

  const filteredChildren = pruneSeparators(
    originalChildren
      .map(child => filterNode(child, section))
      .filter((child): child is PageTree.Node => child !== null),
  );

  const filteredIndex = originalIndex && matchesSection(originalIndex.url, section)
    ? originalIndex
    : undefined;

  if (filteredChildren.length === 0 && !filteredIndex) {
    return null;
  }

  const folder: PageTree.Folder = {
    ...rest,
    type: 'folder',
    children: filteredChildren,
  } as PageTree.Folder;

  if (filteredIndex) {
    folder.index = filteredIndex;
  }

  return folder;
}

function matchesSection(url: string, section: DocsSection): boolean {
  const cleaned = normalizeUrl(url);

  if (!cleaned.startsWith(DOCS_ROOT)) {
    return false;
  }

  if (section === 'sdk') {
    return cleaned === `${DOCS_ROOT}/sdk` || cleaned.startsWith(`${DOCS_ROOT}/sdk/`);
  }

  if (section === 'components') {
    return cleaned === `${DOCS_ROOT}/components` || cleaned.startsWith(`${DOCS_ROOT}/components/`);
  }

  if (cleaned.startsWith(`${DOCS_ROOT}/sdk`)) {
    return false;
  }

  if (cleaned.startsWith(`${DOCS_ROOT}/components`)) {
    return false;
  }

  return cleaned === DOCS_ROOT || cleaned.startsWith(`${DOCS_ROOT}/`);
}

function normalizeUrl(url: string): string {
  const withoutFragment = url.split('#')[0];
  return withoutFragment.replace(/\/$/, '');
}

function pruneSeparators(nodes: PageTree.Node[]): PageTree.Node[] {
  if (nodes.length === 0) {
    return nodes;
  }

  let start = 0;
  while (start < nodes.length && nodes[start]?.type === 'separator') {
    start += 1;
  }

  let end = nodes.length - 1;
  while (end >= start && nodes[end]?.type === 'separator') {
    end -= 1;
  }

  if (start > end) {
    return [];
  }

  const result: PageTree.Node[] = [];
  for (let i = start; i <= end; i += 1) {
    const current = nodes[i];

    if (current.type === 'separator' && result[result.length - 1]?.type === 'separator') {
      continue;
    }

    result.push(current);
  }

  return result;
}

function flattenRootChildren(nodes: PageTree.Node[]): PageTree.Node[] {
  if (nodes.length !== 1) {
    return nodes;
  }

  const soleNode = nodes[0] as PageTree.Node;
  if (soleNode.type !== 'folder') {
    return nodes;
  }

  const flattened: PageTree.Node[] = [];
  const seenUrls = new Set<string>();

  if (soleNode.index) {
    const normalized = normalizeUrl(soleNode.index.url);
    seenUrls.add(normalized);
    flattened.push(soleNode.index);
  }

  soleNode.children.forEach(child => {
    if (child.type === 'page') {
      const normalized = normalizeUrl(child.url);
      if (seenUrls.has(normalized)) {
        return;
      }
      seenUrls.add(normalized);
    }
    flattened.push(child);
  });

  return pruneSeparators(flattened);
}
