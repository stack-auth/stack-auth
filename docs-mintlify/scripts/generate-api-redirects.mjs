#!/usr/bin/env node
// Generates the legacy `/api/*` -> Mintlify `/api/*` redirects in docs.json.
//
// The old Fumadocs site and the new Mintlify site both derive their REST-reference
// URLs deterministically from the same OpenAPI specs, but with different slug rules:
//
//   old (fumadocs): /api/{group}/{tag}/{path-segments}/{method}
//   new (mintlify): /api/{group}/{kebab(tag)}/{kebab(summary)}   (client/server)
//                   /api/webhooks/{tag}/{event-name minus dots}  (webhooks)
//
// We join the two on the operation key. The new slug is recomputed from the live
// specs on every run, so redirect *targets* stay correct as the specs evolve.
//
// `legacy-api-redirects.snapshot.json` is a FROZEN list of the old Fumadocs `/api/*`
// URLs + their operation keys. The legacy docs app has been retired, so this list
// never changes again and is treated as a permanent artifact. It was produced once
// from the old app (now removed) via, from the repo root:
//   pnpm --filter @hexclave/docs run generate-openapi-docs   # writes docs/content/api/**
// then extracting `{ old, group, method, route }` from each generated page's
// `_openapi` frontmatter (admin endpoints excluded — they are covered by the
// `/api/admin/:slug*` wildcard in docs.json). Recover from git history if ever needed.
//
// Admin endpoints are intentionally hidden in the new docs (no pages exist), so they
// are covered by a single hand-written `/api/admin/:slug*` wildcard in docs.json and
// are NOT emitted here.
//
// Usage: node docs-mintlify/scripts/generate-api-redirects.mjs
//        (add --check to fail instead of writing when docs.json is out of date)

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const docsDir = join(here, '..');
const DOCS_JSON = join(docsDir, 'docs.json');
const SNAPSHOT = join(here, 'legacy-api-redirects.snapshot.json');
const OVERVIEW = '/api/overview';

// `/api/(client|server|webhooks)/...` redirects are owned by this generator.
const MANAGED = /^\/api\/(client|server|webhooks)\//;

const kebab = (s) => (s ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
// Webhook event slug: drop dots, keep alphanumerics + underscores
// (e.g. team_membership.created -> team_membershipcreated). NOTE: this is NOT the
// kebab() rule used for client/server — Mintlify slugifies webhook pages differently.
// Verified against a live `mint dev` server: `/api/webhooks/users/usercreated` -> 200
// while the kebab form `/api/webhooks/users/user-created` -> 404.
const webhookLeaf = (s) => s.toLowerCase().replace(/[^a-z0-9_]+/g, '');

// Build (group, METHOD, route) -> new mintlify slug, from the live specs.
function newSlugIndex() {
  const index = new Map();
  for (const group of ['client', 'server']) {
    const specPath = join(docsDir, 'openapi', `${group}.json`);
    let spec;
    try {
      spec = JSON.parse(readFileSync(specPath, 'utf8'));
    } catch (cause) {
      throw new Error(`could not read OpenAPI spec openapi/${group}.json (run docs codegen first)`, { cause });
    }
    for (const [path, methods] of Object.entries(spec.paths ?? {})) {
      for (const [method, op] of Object.entries(methods)) {
        if (!['get', 'post', 'put', 'delete', 'patch'].includes(method)) { continue; }
        if (!op || typeof op !== 'object') { continue; }
        const tagSlug = kebab(op.tags?.[0] ?? 'Other');
        const leaf = kebab(op.summary || op.operationId || '');
        // Without a usable tag + summary the slug would be malformed (empty
        // segment); skip indexing so the snapshot lookup misses and falls back.
        if (!tagSlug || !leaf) { continue; }
        index.set(`${group} ${method.toUpperCase()} ${path}`, `/api/${group}/${tagSlug}/${leaf}`);
      }
    }
  }
  return index;
}

function generate() {
  const snapshot = JSON.parse(readFileSync(SNAPSHOT, 'utf8'));
  const index = newSlugIndex();
  const redirects = [];
  const fellBack = [];

  for (const entry of snapshot) {
    let destination;
    if (entry.group === 'webhooks') {
      // NOTE: unlike client/server, webhook destinations are derived from the (frozen)
      // legacy URL, not re-derived from the live spec — so they do NOT auto-track a
      // future change in how Mintlify slugifies webhook pages. There are only 10; if
      // Mintlify's webhook slug rule changes, re-verify against `mint dev` and update
      // webhookLeaf. `mint broken-links` would also catch a regression.
      const slash = entry.old.lastIndexOf('/');
      destination = `${entry.old.slice(0, slash)}/${webhookLeaf(entry.old.slice(slash + 1))}`;
    } else {
      destination = index.get(`${entry.group} ${entry.method} ${entry.route}`);
      // A miss means the snapshot (frozen) references an operation the live specs no
      // longer expose. Fall back to the API overview, but surface it loudly.
      if (!destination) { destination = OVERVIEW; fellBack.push(`${entry.method} ${entry.route} (${entry.group})`); }
    }
    redirects.push({ source: entry.old, destination });
  }

  redirects.sort((a, b) => a.source.localeCompare(b.source));
  return { redirects, fellBack };
}

// Replace the contents of the top-level "redirects" array in docs.json text,
// leaving the rest of the file byte-for-byte unchanged.
function spliceRedirects(text, managedEntries) {
  const current = JSON.parse(text).redirects ?? [];
  const kept = current.filter((r) => !MANAGED.test(r.source));
  const all = [...kept, ...managedEntries];

  const body = all.map((r) => `    { "source": ${JSON.stringify(r.source)}, "destination": ${JSON.stringify(r.destination)} }`).join(',\n');
  const block = `"redirects": [\n${body}\n  ]`;

  // Anchor on the top-level, line-indented `"redirects": [` so we never match the
  // string *value* "redirects" appearing elsewhere in the document.
  const m = /\n[ \t]*"redirects"[ \t]*:[ \t]*\[/.exec(text);
  if (!m) { throw new Error('no top-level "redirects" array in docs.json'); }
  const key = m.index + m[0].indexOf('"');
  const open = m.index + m[0].length - 1;
  let depth = 0, end = -1, inStr = false, esc = false;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) { esc = false; } else if (c === '\\') { esc = true; } else if (c === '"') { inStr = false; }
      continue;
    }
    if (c === '"') { inStr = true; } else if (c === '[') { depth++; } else if (c === ']') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end === -1) { throw new Error('unterminated "redirects" array'); }
  return text.slice(0, key) + block + text.slice(end + 1);
}

const check = process.argv.includes('--check');
const { redirects, fellBack } = generate();
const before = readFileSync(DOCS_JSON, 'utf8');
const after = spliceRedirects(before, redirects);

if (fellBack.length) {
  console.warn(`Warning: ${fellBack.length} snapshot operation(s) not found in the live specs; redirected to ${OVERVIEW}:`);
  for (const f of fellBack) { console.warn(`  - ${f}`); }
}

if (check) {
  if (fellBack.length) {
    console.error(`${fellBack.length} snapshot operation(s) degrade to ${OVERVIEW}; refusing --check while redirects are not endpoint-accurate.`);
    process.exit(1);
  }
  if (before !== after) {
    console.error('docs.json /api redirects are out of date. Run: node docs-mintlify/scripts/generate-api-redirects.mjs');
    process.exit(1);
  }
  console.log(`docs.json up to date (${redirects.length} /api redirects).`);
} else {
  writeFileSync(DOCS_JSON, after);
  console.log(`Wrote ${redirects.length} /api/* redirects to docs.json`);
}
