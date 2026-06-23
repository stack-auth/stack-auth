"use client";
import { useLayoutEffect } from "react";

export function SsrScript(props: { script: string, nonce?: string }) {
  useLayoutEffect(() => {
    // TODO fix workaround: React has a bug where it doesn't run the script on the first CSR render if SSR has been skipped due to suspense
    // As a workaround, we run the script in the <script> tag again after the first render
    // Note that we do an indirect eval as described here: https://esbuild.github.io/content-types/#direct-eval
    (0, eval)(props.script);
  }, []);

  // Only render the <script> tag during SSR — the browser executes it immediately when parsing
  // the server HTML. On the client, useLayoutEffect handles execution instead. React 19 warns
  // about <script> tags rendered on the client ("Scripts inside React components are never
  // executed when rendering on the client"), and hydration skips <script> tags so omitting it
  // here doesn't cause a mismatch.
  if (typeof window !== 'undefined') {
    return null;
  }

  return (
    <script
      suppressHydrationWarning  // the transpiler is setup differently for client/server targets, so if `script` was generated with Function.toString they will differ
      nonce={props.nonce}
      dangerouslySetInnerHTML={{ __html: props.script }}
    />
  );
}
