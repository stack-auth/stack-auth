export function hasClickableParent(element: HTMLElement): boolean {
  const parent = element.parentElement;
  if (!parent) return false;
  if (parent.dataset.n2Clickable) return true;

  return hasClickableParent(element.parentElement);
}

/**
 * Escape a string so it is safe to use as a CSS identifier (id/class) inside a selector.
 * Prefers the native `CSS.escape` when available, falling back to a conservative
 * backslash-escape for non-DOM environments (SSR, tests, older runtimes).
 */
export function cssEscapeIdent(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`);
}
