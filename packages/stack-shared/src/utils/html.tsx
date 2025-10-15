import { templateIdentity } from "./strings";

export function escapeHtml(unsafe: string): string {
  return `${unsafe}`
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
import.meta.vitest?.test("escapeHtml", ({ expect }) => {
  // Test with empty string
  expect(escapeHtml("")).toBe("");

  // Test with string without special characters
  expect(escapeHtml("hello world")).toBe("hello world");

  // Test with special characters
  expect(escapeHtml("<div>")).toBe("&lt;div&gt;");
  expect(escapeHtml("a & b")).toBe("a &amp; b");
  expect(escapeHtml('a "quoted" string')).toBe("a &quot;quoted&quot; string");
  expect(escapeHtml("it's a test")).toBe("it&#039;s a test");

  // Test with multiple special characters
  expect(escapeHtml("<a href=\"test\">It's a link</a>")).toBe(
    "&lt;a href=&quot;test&quot;&gt;It&#039;s a link&lt;/a&gt;"
  );
});

export function html(strings: TemplateStringsArray, ...values: any[]): string {
  return templateIdentity(strings, ...values.map(v => escapeHtml(`${v}`)));
}
import.meta.vitest?.test("html", ({ expect }) => {
  // Test with no interpolation
  expect(html`simple string`).toBe("simple string");

  // Test with string interpolation
  expect(html`Hello, ${"world"}!`).toBe("Hello, world!");

  // Test with number interpolation
  expect(html`Count: ${42}`).toBe("Count: 42");

  // Test with HTML special characters in interpolated values
  expect(html`<div>${"<script>"}</div>`).toBe("<div>&lt;script&gt;</div>");

  // Test with multiple interpolations
  expect(html`${1} + ${2} = ${"<3"}`).toBe("1 + 2 = &lt;3");

  // Test with object interpolation
  const obj = { toString: () => "<object>" };
  expect(html`Object: ${obj}`).toBe("Object: &lt;object&gt;");
});

export function htmlToText(untrustedHtml: string): string {

  const doc = new DOMParser().parseFromString(untrustedHtml, 'text/html');

  return doc.body.textContent ?? '';

}
