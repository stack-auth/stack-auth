"use client";
import { useLayoutEffect } from "react";

function escapeHtmlAttr(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function SsrScript(props: { script: string, nonce?: string }) {
  useLayoutEffect(() => {
    // TODO fix workaround: React has a bug where it doesn't run the script on the first CSR render if SSR has been skipped due to suspense
    // As a workaround, we run the script in the <script> tag again after the first render
    // Note that we do an indirect eval as described here: https://esbuild.github.io/content-types/#direct-eval
    (0, eval)(props.script);
  }, []);

  // Embed the <script> in a span's innerHTML rather than as a React <script> JSX element to
  // avoid React 19's "Scripts inside React components are never executed when rendering on the
  // client" warning. The browser still executes the script during SSR HTML parsing, and on the
  // client React sets innerHTML but the browser won't re-execute the script (innerHTML scripts
  // don't run). Using the same HTML on both sides avoids hydration mismatches.
  const nonceAttr = props.nonce ? ` nonce="${escapeHtmlAttr(props.nonce)}"` : '';

  return (
    <span
      suppressHydrationWarning  // the transpiler is setup differently for client/server targets, so if `script` was generated with Function.toString they will differ
      dangerouslySetInnerHTML={{
        __html: `<script${nonceAttr}>${props.script}</script>`,
      }}
    />
  );
}
