"use client";

import React, { useId } from "react";
import { SsrScript } from "./ssr-layout-effect";

export function MaybeFullPage({
  children,
  fullPage,
}: {
  children: React.ReactNode,
  fullPage: boolean,
  size?: number,
  containerClassName?: string,
}) {
  const uniqueId = useId();
  const id = `stack-full-page-container-${uniqueId}`;

  const scriptString = `(([id]) => {
    const el = document.getElementById(id);
    if (!el) {
      // component is not full page
      return;
    }
    const offset = el.getBoundingClientRect().top + document.documentElement.scrollTop;
    el.style.minHeight = \`calc(100vh - \${offset}px)\`;
  })(${JSON.stringify([id])})`;

  if (fullPage) {
    return (
      <>
        <div
          suppressHydrationWarning
          id={id}
          style={{
            minHeight: '100vh',
            alignSelf: 'stretch',
            flexGrow: 1,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
          }}
          className="stack-scope"
        >
          {children}
        </div>
        <SsrScript script={scriptString} />
      </>
    );
  } else {
    return <>
      {children}
    </>;
  }

}
