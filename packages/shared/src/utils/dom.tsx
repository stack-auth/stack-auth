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

  let escaped = "";
  for (let i = 0; i < value.length; i += 1) {
    const char = value.charAt(i);
    const codeUnit = value.charCodeAt(i);

    if (codeUnit === 0x0000) {
      escaped += "\uFFFD";
    } else if (
      (codeUnit >= 0x0001 && codeUnit <= 0x001f) ||
      codeUnit === 0x007f ||
      (i === 0 && codeUnit >= 0x0030 && codeUnit <= 0x0039) ||
      (i === 1 && codeUnit >= 0x0030 && codeUnit <= 0x0039 && value.charCodeAt(0) === 0x002d)
    ) {
      escaped += `\\${codeUnit.toString(16)} `;
    } else if (i === 0 && codeUnit === 0x002d && value.length === 1) {
      escaped += "\\-";
    } else if (
      codeUnit >= 0x0080 ||
      codeUnit === 0x002d ||
      codeUnit === 0x005f ||
      (codeUnit >= 0x0030 && codeUnit <= 0x0039) ||
      (codeUnit >= 0x0041 && codeUnit <= 0x005a) ||
      (codeUnit >= 0x0061 && codeUnit <= 0x007a)
    ) {
      escaped += char;
    } else {
      escaped += `\\${char}`;
    }
  }
  return escaped;
}
