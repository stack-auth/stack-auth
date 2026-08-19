"use client";

import {
  encodeSourceForJsonScript,
  getEsmFallbackVersion,
  getSandboxDependencyScripts,
  getSandboxEsmVersion,
  html,
  isSandboxDevMode,
  SANDBOX_BABEL_SCRIPT,
  SANDBOX_ERROR_LISTENER_SCRIPT,
  SANDBOX_TAILWIND_CONFIG_SCRIPT,
  SANDBOX_THEME_STYLES,
} from "@/lib/ai-dashboard/sandbox-runtime";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { captureError } from "@hexclave/shared/dist/utils/errors";
import { memo, useEffect, useMemo, useRef, useState } from "react";

/**
 * Renders a staff-authored Growth report presentation.
 *
 * The presentation is the only thing a customer reads of their growth report: staff generate the
 * component with AI from the internal analysis (report, notes, actions) and publish it, and this
 * frame is where it runs. It reuses the custom-dashboard sandbox runtime, with two deliberate
 * differences:
 *
 *   1. No SDK and no access token. A presentation is a frozen document — every number in it was
 *      baked in when staff authored it — so the frame has no reason to reach our API, and
 *      `connect-src` plus the missing SDK make sure it cannot. That matters more here than for
 *      custom dashboards, where the viewer authors the code they run: here WE author code that
 *      runs in the customer's browser, and it should be able to do nothing but paint.
 *   2. Auto-height. A report is read by scrolling the page it sits on, not inside a fixed
 *      viewport, so the frame measures its content and the parent grows to match.
 */

const MIN_PRESENTATION_HEIGHT_PX = 320;

function getPresentationDocumentId(tsxSource: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < tsxSource.length; index += 1) {
    hash = Math.imul(hash ^ tsxSource.charCodeAt(index), 16_777_619);
  }
  return `${(hash >>> 0).toString(16)}-${tsxSource.length}`;
}

export type GrowthPresentationRuntimeError = {
  message: string,
  stack?: string,
  componentStack?: string,
};

function getPresentationDocument(options: {
  tsxSource: string,
  dashboardUrl: string,
  initialTheme: "light" | "dark",
  documentId: string,
}): string {
  const { tsxSource, dashboardUrl, initialTheme, documentId } = options;
  const esmVersion = getSandboxEsmVersion(tsxSource);
  const devSrc = isSandboxDevMode ? ` ${dashboardUrl}` : '';

  return html`<!doctype html>
<html class="${initialTheme === "dark" ? "dark" : ""}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <!-- No connect-src entry for our API: a presentation paints, it never fetches. -->
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; form-action 'none'; script-src 'unsafe-inline' 'unsafe-eval' https://unpkg.com https://cdn.jsdelivr.net https://cdn.tailwindcss.com https://esm.sh${devSrc}; style-src 'unsafe-inline' https://cdn.jsdelivr.net; img-src data: https:; connect-src https://unpkg.com https://cdn.jsdelivr.net https://esm.sh${devSrc}; font-src 'none'; frame-src 'none'; worker-src 'none';" />
    ${SANDBOX_TAILWIND_CONFIG_SCRIPT}
    ${SANDBOX_THEME_STYLES}
    <style>
      /* The shared styles pin the document to the viewport height, which is right for a dashboard
         and wrong for a document that the parent page scrolls. */
      html, body, #root { height: auto; min-height: 0; overflow-y: visible; }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script>window.__sandboxDocumentId = ${JSON.stringify(documentId)};</script>
    ${SANDBOX_ERROR_LISTENER_SCRIPT}
    ${SANDBOX_BABEL_SCRIPT}
    ${getSandboxDependencyScripts({ esmVersion, esmFallbackVersion: getEsmFallbackVersion(esmVersion), dashboardUrl, includeStackSdk: false })}

    <script type="application/json" id="growth-presentation-source">${encodeSourceForJsonScript(tsxSource)}</script>

    <script type="text/babel">
      window.addEventListener('message', (event) => {
        if (event.data?.type === 'stack-theme-change') {
          document.documentElement.classList.toggle('dark', event.data.theme === 'dark');
        }
      });

      // The parent sizes the frame from this, so it has to fire for anything that changes the
      // document height: fonts landing, charts measuring themselves, images decoding.
      function reportHeight() {
        const root = document.getElementById('root');
        const height = Math.max(
          root ? root.scrollHeight : 0,
          document.body.scrollHeight,
          document.documentElement.scrollHeight,
        );
        window.parent.postMessage({ type: 'growth-presentation-height', height: height, document_id: window.__sandboxDocumentId }, '*');
      }

      async function waitForDeps() {
        if (!window.__depsReady) {
          await new Promise((resolve) => window.addEventListener('deps-ready', resolve, { once: true }));
        }
        if (window.__depsError) {
          const error = new Error(window.__depsError.message || 'This report could not be loaded. Please refresh the page and try again.');
          if (window.__depsError.stack) error.stack = window.__depsError.stack;
          throw error;
        }
      }

      const rootElement = document.getElementById('root');
      if (!rootElement) {
        throw new Error('Presentation root element not found');
      }

      waitForDeps().then(() => {
        // Declared in here, not at the top of this script: Babel runs the script as soon as the
        // document parses, while window.React only exists once the dependency module's awaited
        // imports resolve, so referencing React any earlier throws before the presentation boots.
        class ErrorBoundary extends React.Component {
          constructor(props) {
            super(props);
            this.state = { hasError: false };
          }
          static getDerivedStateFromError() {
            return { hasError: true };
          }
          componentDidCatch(error, errorInfo) {
            window.parent.postMessage({
              type: 'growth-presentation-error',
              message: error?.message,
              stack: error?.stack,
              componentStack: errorInfo?.componentStack,
              document_id: window.__sandboxDocumentId,
            }, '*');
          }
          render() {
            // Staff see the message on the admin preview; the customer gets the neutral copy the
            // parent renders around this frame, so there is nothing to show in place of the report.
            return this.state.hasError ? null : this.props.children;
          }
        }

        // Ready is reported from inside the tree so that it can only follow a commit that actually
        // painted: render() returns before React renders, so posting it right after would beat a
        // first-render throw to the parent and let staff publish a presentation that never paints.
        function ReadyMarker() {
          React.useEffect(() => {
            window.parent.postMessage({ type: 'growth-presentation-ready', document_id: window.__sandboxDocumentId }, '*');
          }, []);
          return null;
        }

        const DashboardUI = window.DashboardUI;
        const Recharts = window.Recharts;
        if (!DashboardUI) throw new Error('Dashboard UI components failed to load in the presentation sandbox.');
        if (!Recharts) throw new Error('Recharts failed to load in the presentation sandbox.');

        const sourceEl = document.getElementById('growth-presentation-source');
        if (!sourceEl || !sourceEl.textContent) {
          throw new Error('Presentation source script tag is missing or empty');
        }
        const source = JSON.parse(sourceEl.textContent);
        if (typeof source !== 'string') {
          throw new Error('Presentation source must be a JSON-encoded string, got ' + typeof source);
        }

        // Compiled here rather than via <script type="text/babel"> so a JSX syntax error surfaces
        // as a throw the global listener forwards to the parent, instead of a blank frame.
        const compiled = window.Babel.transform(source, { presets: ['react'], sourceType: 'script' }).code;
        // eslint-disable-next-line no-new-func
        const Dashboard = new Function('React', 'ReactDOM', 'DashboardUI', 'Recharts', compiled + '\\nreturn Dashboard;')(
          React, ReactDOM, DashboardUI, Recharts,
        );
        if (typeof Dashboard !== 'function') {
          throw new Error('The presentation source does not define a Dashboard component.');
        }

        ReactDOM.createRoot(rootElement).render(
          <ErrorBoundary>
            <Dashboard />
            <ReadyMarker />
          </ErrorBoundary>
        );

        new ResizeObserver(reportHeight).observe(rootElement);
        window.addEventListener('load', reportHeight);
        reportHeight();
      }).catch((error) => {
        window.parent.postMessage({
          type: 'growth-presentation-error',
          message: error instanceof Error ? error.message : 'Failed to load the report presentation',
          stack: error instanceof Error ? error.stack : undefined,
          document_id: window.__sandboxDocumentId,
        }, '*');
      });
    </script>
  </body>
</html>`;
}

export const GrowthPresentationSandbox = memo(function GrowthPresentationSandbox(props: {
  tsxSource: string,
  className?: string,
  onReady?: () => void,
  /** Staff-facing hosts use this to show the crash; the customer host only needs the fallback copy. */
  onRuntimeError?: (error: GrowthPresentationRuntimeError) => void,
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const onReadyRef = useRef(props.onReady);
  onReadyRef.current = props.onReady;
  const onRuntimeErrorRef = useRef(props.onRuntimeError);
  onRuntimeErrorRef.current = props.onRuntimeError;
  const { resolvedTheme } = useTheme();
  const [height, setHeight] = useState(MIN_PRESENTATION_HEIGHT_PX);

  const dashboardUrl = useMemo(() => typeof window === "undefined" ? "" : window.location.origin, []);
  const initialThemeRef = useRef<"light" | "dark">(resolvedTheme === "dark" ? "dark" : "light");
  const documentId = useMemo(() => getPresentationDocumentId(props.tsxSource), [props.tsxSource]);
  const documentIdRef = useRef(documentId);
  documentIdRef.current = documentId;
  // Deliberately not keyed on the theme: re-rendering the document would remount the presentation
  // on every theme flip, so the theme travels by message instead.
  const srcDoc = useMemo(
    () => getPresentationDocument({ tsxSource: props.tsxSource, dashboardUrl, initialTheme: initialThemeRef.current, documentId }),
    [props.tsxSource, dashboardUrl, documentId],
  );

  useEffect(() => {
    iframeRef.current?.contentWindow?.postMessage({ type: "stack-theme-change", theme: resolvedTheme }, "*");
  }, [resolvedTheme]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      // `srcDoc` in a sandboxed frame is an opaque origin, so "null" is the only origin a message
      // from our own presentation can have; the source check pins it to this frame.
      if (typeof event.data !== "object" || event.data === null) return;
      if (event.origin !== "null") return;
      if (!iframeRef.current?.contentWindow || event.source !== iframeRef.current.contentWindow) return;
      if (event.data.document_id !== documentIdRef.current) return;

      if (event.data.type === "growth-presentation-height" && typeof event.data.height === "number") {
        setHeight(Math.max(MIN_PRESENTATION_HEIGHT_PX, Math.ceil(event.data.height)));
        return;
      }
      if (event.data.type === "growth-presentation-ready") {
        onReadyRef.current?.();
        return;
      }
      if (event.data.type === "growth-presentation-error" || event.data.type === "dashboard-error-boundary" || event.data.type === "dashboard-sandbox-dependency-error") {
        const error = new Error(typeof event.data.message === "string" ? event.data.message : "Unknown growth presentation error");
        if (typeof event.data.stack === "string") error.stack = event.data.stack;
        captureError("growth-presentation-sandbox", error);
        onRuntimeErrorRef.current?.({
          message: error.message,
          stack: typeof event.data.stack === "string" ? event.data.stack : undefined,
          componentStack: typeof event.data.componentStack === "string" ? event.data.componentStack : undefined,
        });
        return;
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <iframe
      ref={iframeRef}
      title="Growth report"
      sandbox="allow-scripts"
      srcDoc={srcDoc}
      style={{ height: `${height}px` }}
      className={cn("w-full bg-transparent", props.className)}
    />
  );
});
