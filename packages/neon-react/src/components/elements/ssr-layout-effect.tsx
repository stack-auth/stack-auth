"use client";


//===========================================
// THIS FILE IS AUTO-GENERATED FROM TEMPLATE. DO NOT EDIT IT DIRECTLY
//===========================================
import { useLayoutEffect } from "react";

export function SsrScript(props: { script: string, nonce?: string }) {
  useLayoutEffect(() => {
    // TODO fix workaround: React has a bug where it doesn't run the script on the first CSR render if SSR has been skipped due to suspense
    // As a workaround, we run the script in the <script> tag again after the first render
    // Note that we do an indirect eval as described here: https://esbuild.github.io/content-types/#direct-eval
    (0, eval)(props.script);
  }, []);

  return (
    <script
      suppressHydrationWarning  // the transpiler is setup differently for client/server targets, so if `script` was generated with Function.toString they will differ
      nonce={props.nonce}
      dangerouslySetInnerHTML={{ __html: props.script }}
    />
  );
}
