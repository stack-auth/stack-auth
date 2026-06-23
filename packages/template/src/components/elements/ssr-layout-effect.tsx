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
  // client" warning. The browser still executes the script during SSR HTML parsing.
  // suppressHydrationWarning hides the SSR-vs-client innerHTML difference (server has the
  // script tag, client has empty string).
  const isServer = typeof window === 'undefined';
  const nonceAttr = props.nonce ? ` nonce="${escapeHtmlAttr(props.nonce)}"` : '';

  return (
    <span
      suppressHydrationWarning
      dangerouslySetInnerHTML={{
        __html: isServer
          ? `<script${nonceAttr}>${props.script}</script>`
          : '',
      }}
    />
  );
}
