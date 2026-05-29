/**
 * PostHog-style `elements_chain` format — the single owner of both halves of the
 * contract. The event tracker {@link buildElementsChain serializes} a clicked
 * element (and its ancestors) into a string; the clickmap overlay
 * {@link parseElementsChain parses} that string back into structured segments so
 * it can re-locate the element in a live DOM.
 *
 * Encode and decode MUST round-trip exactly, which is why they live together:
 * the escaping applied here on the write side is reversed by the parser below,
 * and a single round-trip test in `elements-chain.test.tsx` guards the pair.
 *
 * Segment shape (leaf-first, joined by `;`):
 *   tag.class1.class2:nth-child="2":nth-of-type="1":text="Save":attr__id="x":href="..."
 */

export type ElementsChainSegment = {
  tag: string,
  classes: string[],
  attrs: Record<string, string>,
  text: string | null,
  nthChild: number | null,
  nthOfType: number | null,
  href: string | null,
};

export const ELEMENTS_CHAIN_MAX_DEPTH = 8;
export const ELEMENTS_CHAIN_TEXT_MAX = 80;
export const ELEMENTS_CHAIN_ATTR_MAX = 200;

// Attributes we serialise into elements_chain. Mirrors the set PostHog persists:
// stable identifiers (id, data-testid), semantics (role, type, name, aria-label),
// and a few we expect downstream tooling to want to match against.
export const ELEMENTS_CHAIN_ATTRS = [
  "id",
  "data-testid",
  "data-test-id",
  "data-hexclave-id",
  "name",
  "type",
  "role",
  "aria-label",
  "placeholder",
  "title",
] as const;

// ---------------------------------------------------------------------------
// Serialization (DOM element -> elements_chain string)
// ---------------------------------------------------------------------------

function escapeElementsChainValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

// Class tokens are written into the unquoted, dot-joined prefix of a segment, so
// any "." or ":" inside a class (e.g. Tailwind variants like `md:hover:bg-blue-500`
// or arbitrary values like `w-[1.5rem]`) must be escaped to round-trip through the
// parser, which splits the prefix on unescaped "." and the segment on unescaped ":".
function escapeElementsChainClass(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\./g, "\\.").replace(/:/g, "\\:");
}

function getElementClasses(element: Element): string[] {
  const className = (element as HTMLElement).className;
  if (typeof className !== "string" || className.trim() === "") {
    return [];
  }
  return className.trim().split(/\s+/).filter(Boolean).slice(0, 4);
}

function getNthChildIndex(element: Element): number | null {
  const parent = element.parentElement;
  if (parent == null) return null;
  const index = Array.prototype.indexOf.call(parent.children, element);
  return index >= 0 ? index + 1 : null;
}

function getNthOfTypeIndex(element: Element): number | null {
  const parent = element.parentElement;
  if (parent == null) return null;
  const tagName = element.tagName;
  const siblings = Array.from(parent.children).filter((child) => child.tagName === tagName);
  if (siblings.length <= 1) return null;
  const index = siblings.indexOf(element);
  return index >= 0 ? index + 1 : null;
}

function serializeElementsChainSegment(element: Element): string {
  const parts: string[] = [];
  parts.push(element.tagName.toLowerCase());
  const classes = getElementClasses(element);
  if (classes.length > 0) {
    parts.push(`.${classes.map(escapeElementsChainClass).join(".")}`);
  }
  const text = element.textContent.trim().replace(/\s+/g, " ").slice(0, ELEMENTS_CHAIN_TEXT_MAX);
  const nthChild = getNthChildIndex(element);
  const nthOfType = getNthOfTypeIndex(element);
  const attrPairs: string[] = [];
  if (nthChild != null) attrPairs.push(`nth-child="${nthChild}"`);
  if (nthOfType != null) attrPairs.push(`nth-of-type="${nthOfType}"`);
  if (text !== "") attrPairs.push(`text="${escapeElementsChainValue(text)}"`);
  for (const attrName of ELEMENTS_CHAIN_ATTRS) {
    const value = element.getAttribute(attrName);
    if (value == null || value === "") continue;
    attrPairs.push(`attr__${attrName}="${escapeElementsChainValue(value.slice(0, ELEMENTS_CHAIN_ATTR_MAX))}"`);
  }
  if (element.tagName === "A") {
    const href = element.getAttribute("href");
    if (href != null && href !== "") {
      attrPairs.push(`href="${escapeElementsChainValue(href.slice(0, ELEMENTS_CHAIN_ATTR_MAX))}"`);
    }
  }
  if (attrPairs.length > 0) {
    parts.push(`:${attrPairs.join(":")}`);
  }
  return parts.join("");
}

/**
 * Serialise a clicked element and up to {@link ELEMENTS_CHAIN_MAX_DEPTH}
 * ancestors (leaf-first) into an `elements_chain` string.
 */
export function buildElementsChain(element: Element): string {
  const segments: string[] = [];
  let current: Element | null = element;
  let depth = 0;
  while (current != null && depth < ELEMENTS_CHAIN_MAX_DEPTH && current !== document.documentElement) {
    segments.push(serializeElementsChainSegment(current));
    current = current.parentElement;
    depth += 1;
  }
  return segments.join(";");
}

// ---------------------------------------------------------------------------
// Parsing (elements_chain string -> structured segments)
// ---------------------------------------------------------------------------

// Split a string on unescaped occurrences of `.`, unescaping `\.`, `\:` and `\\`
// back to their literal characters. Reverses `escapeElementsChainClass`.
function splitEscapedDots(input: string): string[] {
  const out: string[] = [];
  let cur = '';
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === '\\' && i + 1 < input.length) {
      cur += input[i + 1];
      i += 1;
      continue;
    }
    if (ch === '.') {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

type ElementsChainAttrResult = {
  nthChild?: number,
  nthOfType?: number,
  text?: string,
  href?: string,
  attrKey?: string,
  attrValue?: string,
};

function applyElementsChainAttr(key: string, value: string): ElementsChainAttrResult {
  if (key === 'nth-child') {
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) ? { nthChild: n } : {};
  }
  if (key === 'nth-of-type') {
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) ? { nthOfType: n } : {};
  }
  if (key === 'text') {
    return { text: value };
  }
  if (key === 'href') {
    return { href: value, attrKey: key, attrValue: value };
  }
  if (key.startsWith('attr__')) {
    return { attrKey: key.slice('attr__'.length), attrValue: value };
  }
  return { attrKey: key, attrValue: value };
}

function parseElementsChainSegment(segment: string): ElementsChainSegment | null {
  const trimmed = segment.trim();
  if (trimmed === '') return null;

  // Find first ':' at top level — separates tag/classes prefix from attribute pairs.
  let prefixEnd = trimmed.length;
  let inQuotes = false;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === '\\' && i + 1 < trimmed.length) {
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === ':' && !inQuotes) {
      prefixEnd = i;
      break;
    }
  }

  const prefix = trimmed.slice(0, prefixEnd);
  const rest = trimmed.slice(prefixEnd);
  const prefixParts = splitEscapedDots(prefix);
  const tag = prefixParts[0].trim().toLowerCase();
  if (tag === '') return null;
  const classes = prefixParts.slice(1).map((c) => c.trim()).filter((c) => c !== '');

  const attrs: Record<string, string> = {};
  let nthChild: number | null = null;
  let nthOfType: number | null = null;
  let text: string | null = null;
  let href: string | null = null;

  // Parse :key="value" pairs from rest.
  let i = 0;
  while (i < rest.length) {
    if (rest[i] !== ':') {
      i += 1;
      continue;
    }
    i += 1; // skip ':'
    // read key up to '='
    let keyEnd = i;
    while (keyEnd < rest.length && rest[keyEnd] !== '=' && rest[keyEnd] !== ':') keyEnd += 1;
    const key = rest.slice(i, keyEnd).trim();
    if (keyEnd >= rest.length || rest[keyEnd] !== '=') {
      i = keyEnd;
      continue;
    }
    let valStart = keyEnd + 1;
    if (rest[valStart] !== '"') {
      // unquoted — read until next ':' at top level
      let end = valStart;
      while (end < rest.length && rest[end] !== ':') end += 1;
      const value = rest.slice(valStart, end);
      const result = applyElementsChainAttr(key, value);
      if (result.nthChild != null) nthChild = result.nthChild;
      if (result.nthOfType != null) nthOfType = result.nthOfType;
      if (result.text != null) text = result.text;
      if (result.href != null) href = result.href;
      if (result.attrKey != null) attrs[result.attrKey] = result.attrValue ?? '';
      i = end;
      continue;
    }
    // quoted value — find unescaped closing quote
    valStart += 1;
    let end = valStart;
    let value = '';
    while (end < rest.length) {
      const ch = rest[end];
      if (ch === '\\' && end + 1 < rest.length) {
        const next = rest[end + 1];
        if (next === '"' || next === '\\') {
          value += next;
          end += 2;
          continue;
        }
        value += ch;
        end += 1;
        continue;
      }
      if (ch === '"') break;
      value += ch;
      end += 1;
    }
    const result = applyElementsChainAttr(key, value);
    if (result.nthChild != null) nthChild = result.nthChild;
    if (result.nthOfType != null) nthOfType = result.nthOfType;
    if (result.text != null) text = result.text;
    if (result.href != null) href = result.href;
    if (result.attrKey != null) attrs[result.attrKey] = result.attrValue ?? '';
    i = end + 1; // skip closing quote
  }

  return { tag, classes, attrs, text, nthChild, nthOfType, href };
}

/** Parse an `elements_chain` string into structured, leaf-first segments. */
export function parseElementsChain(chain: string): ElementsChainSegment[] {
  // Split top-level by ';' respecting quoted strings.
  const segments: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < chain.length; i++) {
    const ch = chain[i];
    if (ch === '\\' && i + 1 < chain.length) {
      current += ch + chain[i + 1];
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
      continue;
    }
    if (ch === ';' && !inQuotes) {
      segments.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.length > 0) {
    segments.push(current);
  }
  return segments.map(parseElementsChainSegment).filter((segment): segment is ElementsChainSegment => segment != null);
}

import.meta.vitest?.test("parseElementsChain parses a simple leaf+ancestor chain", ({ expect }) => {
  const parsed = parseElementsChain('button.btn.btn-primary:nth-of-type="1":text="Save":attr__id="save-btn";div.container');
  expect(parsed).toEqual([
    { tag: "button", classes: ["btn", "btn-primary"], attrs: { id: "save-btn" }, text: "Save", nthChild: null, nthOfType: 1, href: null },
    { tag: "div", classes: ["container"], attrs: {}, text: null, nthChild: null, nthOfType: null, href: null },
  ]);
});

import.meta.vitest?.test("parseElementsChain reverses class escaping for Tailwind-style tokens", ({ expect }) => {
  // `md:hover:bg-blue-500` and `w-[1.5rem]` contain the prefix delimiters `:`/`.`,
  // so the serializer escapes them; the parser must recover the literal classes.
  const parsed = parseElementsChain('a.md\\:hover\\:bg-blue-500.w-\\[1\\.5rem\\]:href="/p?a=1"');
  expect(parsed).toEqual([
    { tag: "a", classes: ["md:hover:bg-blue-500", "w-[1.5rem]"], attrs: { href: "/p?a=1" }, text: null, nthChild: null, nthOfType: null, href: "/p?a=1" },
  ]);
});

import.meta.vitest?.test("parseElementsChain unescapes quotes/backslashes and ignores ';' inside quoted values", ({ expect }) => {
  const parsed = parseElementsChain('span:text="a \\"b\\"; c \\\\ d"');
  expect(parsed).toEqual([
    { tag: "span", classes: [], attrs: {}, text: 'a "b"; c \\ d', nthChild: null, nthOfType: null, href: null },
  ]);
});

import.meta.vitest?.test("parseElementsChain drops empty/tagless segments", ({ expect }) => {
  expect(parseElementsChain("")).toEqual([]);
  expect(parseElementsChain(";;")).toEqual([]);
});
