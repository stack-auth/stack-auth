"use client";

import { DashboardRuntimeCodegen } from "@/lib/ai-dashboard/contracts";
import {
  getSandboxDependencyScripts,
  getSandboxEsmVersion,
  html,
  isSandboxDevMode as isDev,
  SANDBOX_BABEL_SCRIPT,
  SANDBOX_ERROR_LISTENER_SCRIPT,
  SANDBOX_TAILWIND_CONFIG_SCRIPT,
  SANDBOX_THEME_STYLES,
  encodeSourceForJsonScript,
  getEsmFallbackVersion,
} from "@/lib/ai-dashboard/sandbox-runtime";
import { useDashboardUser } from "@/lib/dashboard-user";
import { getPublicEnvVar } from "@/lib/env";
import { useTheme } from "@/lib/theme";
import { captureError } from "@hexclave/shared/dist/utils/errors";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import { memo, useEffect, useMemo, useRef } from "react";

// Re-exported because the dashboard pages that persist a source stamp it through this module.
export { stampEsmVersion } from "@/lib/ai-dashboard/sandbox-runtime";

type DashboardArtifact = {
  prompt: string,
  projectId: string,
  runtimeCodegen: DashboardRuntimeCodegen,
};

function getSandboxDocument(artifact: DashboardArtifact, baseUrl: string, dashboardUrl: string, initialTheme: "light" | "dark", showControls: boolean, initialChatOpen: boolean): string {
  const encodedSource = encodeSourceForJsonScript(artifact.runtimeCodegen.uiRuntimeSourceCode);
  const darkClass = initialTheme === "dark" ? "dark" : "";
  const esmVersion = getSandboxEsmVersion(artifact.runtimeCodegen.uiRuntimeSourceCode);
  const esmFallbackVersion = getEsmFallbackVersion(esmVersion);
  const devScriptSrc = isDev ? ` ${dashboardUrl}` : '';
  const devConnectSrc = isDev ? ` ${dashboardUrl}` : '';

  return html`<!doctype html>
<html class="${darkClass}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' https://unpkg.com https://cdn.jsdelivr.net https://cdn.tailwindcss.com https://esm.sh https://js.stripe.com${devScriptSrc}; style-src 'unsafe-inline' https://cdn.jsdelivr.net; img-src data: https:; connect-src ${baseUrl} https://unpkg.com https://cdn.jsdelivr.net https://esm.sh https://api.stripe.com https://m.stripe.com https://m.stripe.network${devConnectSrc}; font-src 'none'; frame-src https://js.stripe.com https://hooks.stripe.com https://m.stripe.network; worker-src 'none';" />

    ${SANDBOX_TAILWIND_CONFIG_SCRIPT}
    ${SANDBOX_THEME_STYLES}
    <style>
      /* Widget selection overlay — active only when chat panel is open */
      .widget-overlay {
        position: fixed;
        pointer-events: none;
        border: 2px dashed hsl(var(--primary) / 0.35);
        border-radius: 10px;
        z-index: 9999;
        transition: top 0.12s ease, left 0.12s ease, width 0.12s ease, height 0.12s ease;
        display: none;
        background: hsl(var(--primary) / 0.03);
      }
      .widget-overlay-btn {
        position: absolute;
        top: 6px;
        right: 6px;
        pointer-events: auto;
        width: 28px;
        height: 28px;
        border-radius: 8px;
        background: hsl(var(--primary));
        color: hsl(var(--primary-foreground));
        border: none;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0;
        transition: opacity 0.15s ease, transform 0.15s ease;
        box-shadow: 0 2px 8px rgba(0,0,0,0.18);
      }
      .widget-overlay-btn:hover { transform: scale(1.08); }
      .widget-overlay.active .widget-overlay-btn { opacity: 1; }
    </style>
  </head>
  <body>
    <div id="root"></div>
    ${SANDBOX_ERROR_LISTENER_SCRIPT}
    ${SANDBOX_BABEL_SCRIPT}

    ${getSandboxDependencyScripts({ esmVersion, esmFallbackVersion, dashboardUrl, includeStackSdk: true })}

    <script type="application/json" id="ai-dashboard-source">${encodedSource}</script>

    <script type="text/babel">
      // Navigation API for AI-generated code
      window.dashboardNavigate = function(path) {
        window.parent.postMessage({ type: 'dashboard-navigate', path: path }, '*');
      };
      window.dashboardBack = function() {
        window.parent.postMessage({ type: 'dashboard-back' }, '*');
      };
      window.dashboardEdit = function() {
        window.parent.postMessage({ type: 'dashboard-edit' }, '*');
      };
      // Controls visibility flag — only true in the full dashboard viewer (not cmd+K preview)
      window.__showControls = ${showControls};
      window.__chatOpen = ${initialChatOpen};

      // Theme syncing and chat state from parent window
      window.addEventListener('message', (event) => {
        if (event.data?.type === 'stack-theme-change') {
          const theme = event.data.theme;
          if (theme === 'dark') {
            document.documentElement.classList.add('dark');
          } else {
            document.documentElement.classList.remove('dark');
          }
        }
        if (event.data?.type === 'dashboard-controls-update') {
          window.__chatOpen = !!event.data.chatOpen;
          window.dispatchEvent(new Event('chat-state-change'));
        }
      });

      const STACK_CONFIG = {
        baseUrl: ${JSON.stringify(baseUrl)},
        projectId: ${JSON.stringify(artifact.projectId)},
      };

      async function waitForDeps() {
        if (!window.__depsReady) {
          await new Promise(resolve => {
            window.addEventListener('deps-ready', resolve, { once: true });
          });
        }
        if (window.__depsError) {
          const error = new Error(window.__depsError.message || 'There was a problem loading custom dashboards. Please refresh the page and try again.');
          if (window.__depsError.stack) {
            error.stack = window.__depsError.stack;
          }
          throw error;
        }
      }

      async function requestAccessToken() {
        return new Promise((resolve, reject) => {
          const requestId = window.generateUuid();
          const timeout = setTimeout(() => {
            window.removeEventListener('message', handler);
            reject(new Error('Token request timeout'));
          }, 5000);

          const handler = (event) => {
            if (event.data?.type === 'stack-access-token-response' && event.data?.requestId === requestId) {
              clearTimeout(timeout);
              window.removeEventListener('message', handler);

              if (event.data.accessToken) {
                resolve(event.data.accessToken);
              } else {
                reject(new Error('No access token received from parent'));
              }
            }
          };

          window.addEventListener('message', handler);
          window.parent.postMessage({
            type: 'stack-access-token-request',
            requestId
          }, '*');
        });
      }

      async function initializeStackApp() {
        await waitForDeps();

        if (!window.StackAdminApp) {
          throw new Error("Stack SDK failed to load. The SDK should expose window.StackAdminApp.");
        }

        const hexclaveServerApp = new window.StackAdminApp({
          projectId: STACK_CONFIG.projectId,
          baseUrl: STACK_CONFIG.baseUrl,
          projectOwnerSession: async () => {
            return await requestAccessToken();
          },
          automaticSideEffects: false,
          analytics: { enabled: false },
        });

        // Expose under both names. AI-generated dashboards (post-PR2 prompt)
        // reference hexclaveServerApp; pre-rebrand saved dashboards still
        // reference stackServerApp. Both must resolve at runtime.
        window.hexclaveServerApp = hexclaveServerApp;
        window.stackServerApp = hexclaveServerApp;

        return hexclaveServerApp;
      }

      // Uncaught runtime errors and unhandled rejections are forwarded by the
      // early global listener installed before Babel loads (see top of <head>).

      // Error Boundary Component
      class ErrorBoundary extends React.Component {
        constructor(props) {
          super(props);
          this.state = { hasError: false, error: null };
        }

        static getDerivedStateFromError(error) {
          return { hasError: true, error };
        }

        componentDidCatch(error, errorInfo) {
          window.parent.postMessage({
            type: 'dashboard-error-boundary',
            message: error?.message,
            stack: error?.stack,
            componentStack: errorInfo?.componentStack,
          }, '*');
        }

        render() {
          if (this.state.hasError) {
            return (
              <div className="p-6 text-red-500">
                <h2 className="text-xl font-bold mb-2">Dashboard Error</h2>
                <pre className="text-sm bg-red-950/20 p-4 rounded overflow-auto">
                  {this.state.error?.message || 'Unknown error'}
                </pre>
                {this.state.error?.stack && (
                  <pre className="text-xs bg-red-950/10 p-4 rounded overflow-auto mt-2">
                    {this.state.error.stack}
                  </pre>
                )}
              </div>
            );
          }
          return this.props.children;
        }
      }

      // Boot the dashboard
      const rootElement = document.getElementById('root');
      if (!rootElement) {
        throw new Error('Root element not found');
      }

      // Initialize deps and boot the dashboard
      initializeStackApp().then(() => {
        const DashboardUI = window.DashboardUI;
        const Recharts = window.Recharts;

        if (!DashboardUI) {
          throw new Error("Dashboard UI components failed to load in sandbox.");
        }
        if (!Recharts) {
          throw new Error("Recharts failed to load in sandbox.");
        }

        // Execute AI-generated code with DashboardUI and Recharts in scope.
        // We compile here (rather than via <script type="text/babel">) so that
        // a JSX SyntaxError in the AI output surfaces as a normal throw — the
        // window 'error' listener picks it up and forwards it to the parent
        // composer instead of leaving the iframe blank.
        const aiSourceEl = document.getElementById('ai-dashboard-source');
        if (!aiSourceEl || !aiSourceEl.textContent) {
          throw new Error('Failed to parse aiSource from aiSourceEl: #ai-dashboard-source script tag is missing or empty');
        }
        let aiSource;
        try {
          aiSource = JSON.parse(aiSourceEl.textContent);
        } catch (parseErr) {
          const original = parseErr && parseErr.message ? parseErr.message : String(parseErr);
          const preview = aiSourceEl.textContent.slice(0, 500);
          const wrapped = new Error('Failed to parse aiSource from aiSourceEl: ' + original + ' | textContent preview: ' + preview);
          if (parseErr && parseErr.stack) wrapped.stack = parseErr.stack;
          throw wrapped;
        }
        if (typeof aiSource !== 'string') {
          throw new Error('Failed to parse aiSource from aiSourceEl: expected JSON-encoded string, got ' + typeof aiSource);
        }
        let compiledSource;
        try {
          compiledSource = window.Babel.transform(aiSource, { presets: ['react'], sourceType: 'script' }).code;
        } catch (err) {
          const message = err && err.message ? 'Dashboard code failed to compile: ' + err.message : 'Dashboard code failed to compile';
          const stack = err && err.stack ? err.stack : undefined;
          window.__postDashboardError && window.__postDashboardError(message, stack);
          const root = ReactDOM.createRoot(rootElement);
          root.render(
            <div className="p-6 text-red-500">
              <h2 className="text-xl font-bold mb-2">Dashboard failed to compile</h2>
              <pre className="text-sm bg-red-950/20 p-4 rounded overflow-auto whitespace-pre-wrap">
                {message}
              </pre>
            </div>
          );
          return;
        }
        // eslint-disable-next-line no-new-func
        const Dashboard = new Function('React', 'ReactDOM', 'DashboardUI', 'Recharts', 'hexclaveServerApp', compiledSource + '\\nreturn Dashboard;')(
          React, ReactDOM, DashboardUI, Recharts, window.hexclaveServerApp,
        );
        
        if (typeof Dashboard !== 'function') {
          throw new Error('Dashboard component not found in generated code');
        }
        
        const root = ReactDOM.createRoot(rootElement);
        root.render(
          <ErrorBoundary>
            <Dashboard />
          </ErrorBoundary>
        );
        
        parent.postMessage({ type: "stack-ai-dashboard-ready" }, "*");
      }).catch(error => {
        const message = error instanceof Error ? error.message : "Failed to initialize dashboard";
        parent.postMessage({
          type: "stack-ai-dashboard-error",
          message: message,
          stack: error instanceof Error ? error.stack : undefined,
        }, "*");
        
        const root = ReactDOM.createRoot(rootElement);
        root.render(
          <div className="p-6 text-red-500">
            <h2 className="text-xl font-bold mb-2">Failed to load dashboard</h2>
            <pre className="text-sm bg-red-950/20 p-4 rounded">
              {message}
            </pre>
          </div>
        );
      });
    </script>

    <!-- Widget selection overlay — lets the user pick a widget and send it to the chat panel -->
    <script>
    (function () {
      var overlay = document.createElement('div');
      overlay.className = 'widget-overlay';
      var btn = document.createElement('button');
      btn.className = 'widget-overlay-btn';
      btn.setAttribute('aria-label', 'Add to chat');
      btn.title = 'Add to chat';
      btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor"><path d="M216,48H40A16,16,0,0,0,24,64V176a16,16,0,0,0,16,16H96l32,32a8,8,0,0,0,11.31,0L171.31,192H216a16,16,0,0,0,16-16V64A16,16,0,0,0,216,48ZM160,136H96a8,8,0,0,1,0-16h64a8,8,0,0,1,0,16Zm0-32H96a8,8,0,0,1,0-16h64a8,8,0,0,1,0,16Z"/></svg>';
      overlay.appendChild(btn);

      var currentWidget = null;
      var mounted = false;

      function mount() {
        if (mounted) return;
        document.body.appendChild(overlay);
        mounted = true;
      }

      /* ── Widget detection heuristic ── */
      function findWidget(el) {
        var current = el;
        var root = document.getElementById('root');
        while (current && current !== root && current !== document.body) {
          if (current === overlay || overlay.contains(current)) {
            current = current.parentElement;
            continue;
          }
          var rect = current.getBoundingClientRect();
          if (rect.width < 80 || rect.height < 50) { current = current.parentElement; continue; }
          if (rect.width > window.innerWidth * 0.85 && rect.height > window.innerHeight * 0.85) {
            current = current.parentElement; continue;
          }
          var hasContent = current.querySelector('svg, h1, h2, h3, h4, h5, h6, table, img, canvas');
          var cls = typeof current.className === 'string' ? current.className : '';
          var isCard = /rounded|shadow|border|card|bg-/.test(cls);
          var parent = current.parentElement;
          var isLayoutChild = false;
          if (parent && parent !== root) {
            var ps = getComputedStyle(parent).display;
            isLayoutChild = ps === 'grid' || ps === 'flex';
          }
          if (hasContent || isCard || isLayoutChild) return current;
          current = current.parentElement;
        }
        return null;
      }

      function showOverlay(widget) {
        mount();
        var rect = widget.getBoundingClientRect();
        overlay.style.display = 'block';
        overlay.style.top = rect.top - 2 + 'px';
        overlay.style.left = rect.left - 2 + 'px';
        overlay.style.width = rect.width + 4 + 'px';
        overlay.style.height = rect.height + 4 + 'px';
        overlay.classList.add('active');
        currentWidget = widget;
      }

      function hideOverlay() {
        overlay.style.display = 'none';
        overlay.classList.remove('active');
        currentWidget = null;
      }

      document.addEventListener('mousemove', function (e) {
        if (!window.__chatOpen) return;
        if (overlay.contains(e.target)) return;
        var widget = findWidget(e.target);
        if (widget && widget !== currentWidget) showOverlay(widget);
        else if (!widget) hideOverlay();
      });

      document.addEventListener('mouseleave', function () { hideOverlay(); });
      window.addEventListener('chat-state-change', function () { if (!window.__chatOpen) hideOverlay(); });

      /* ── Send DOM metadata to parent ── */
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        e.preventDefault();
        if (!currentWidget) return;

        var heading = currentWidget.querySelector('h1,h2,h3,h4,h5,h6');
        var widgetRect = currentWidget.getBoundingClientRect();
        var metadata = {
          heading: heading ? heading.textContent.trim() : null,
          tagName: currentWidget.tagName.toLowerCase(),
          classes: (typeof currentWidget.className === 'string' ? currentWidget.className : '').slice(0, 300),
          textPreview: (currentWidget.textContent || '').trim().slice(0, 500),
          rect: { width: Math.round(widgetRect.width), height: Math.round(widgetRect.height) },
        };

        window.parent.postMessage({ type: 'dashboard-widget-selected', metadata: metadata }, '*');
        hideOverlay();
      });
    })();
    </script>
  </body>
</html>`;
}

/**
 * Shape of a runtime error surfaced from the sandbox iframe. Covers three sources:
 *   1. React ErrorBoundary catches (componentStack is present)
 *   2. Uncaught window errors (sync throws outside render)
 *   3. Unhandled promise rejections (async failures inside effects/handlers)
 */
export type DashboardRuntimeError = {
  message: string,
  stack?: string,
  componentStack?: string,
};

/**
 * Payload sent when the user clicks "Add to chat" on a widget in the iframe.
 * `metadata` carries DOM info so the AI knows which part of the dashboard is targeted.
 */
export type WidgetSelection = {
  metadata: {
    heading: string | null,
    tagName: string,
    classes: string,
    textPreview: string,
    rect: { width: number, height: number },
  },
};

export const DashboardSandboxHost = memo(function DashboardSandboxHost({
  artifact,
  onBack,
  onEditToggle,
  onNavigate,
  onReady,
  onRuntimeError,
  onWidgetSelected,
  isChatOpen,
}: {
  artifact: DashboardArtifact,
  onBack?: () => void,
  onEditToggle?: () => void,
  onNavigate?: (path: string) => void,
  onReady?: () => void,
  /** Fires whenever the sandbox reports a runtime error. Parent uses this to auto-insert
      the crash into the assistant composer so the user can one-click fix it. */
  onRuntimeError?: (err: DashboardRuntimeError) => void,
  /** Fires when the user clicks "Add to chat" on a widget overlay in the iframe. */
  onWidgetSelected?: (selection: WidgetSelection) => void,
  isChatOpen?: boolean,
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  const onEditToggleRef = useRef(onEditToggle);
  onEditToggleRef.current = onEditToggle;
  const onNavigateRef = useRef(onNavigate);
  onNavigateRef.current = onNavigate;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const onRuntimeErrorRef = useRef(onRuntimeError);
  onRuntimeErrorRef.current = onRuntimeError;
  const onWidgetSelectedRef = useRef(onWidgetSelected);
  onWidgetSelectedRef.current = onWidgetSelected;
  const user = useDashboardUser();
  const { resolvedTheme } = useTheme();

  const baseUrl = useMemo(() => {
    const url = getPublicEnvVar("NEXT_PUBLIC_STACK_API_URL");
    if (!url) throw new Error("NEXT_PUBLIC_STACK_API_URL is not set");
    return url;
  }, []);

  const dashboardUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    return window.location.origin;
  }, []);

  const initialThemeRef = useRef<"light" | "dark">(resolvedTheme === "dark" ? "dark" : "light");
  const initialChatOpenRef = useRef(!!isChatOpen);
  const showControls = onBack != null || onEditToggle != null;
  const srcDoc = useMemo(() => getSandboxDocument(artifact, baseUrl, dashboardUrl, initialThemeRef.current, showControls, initialChatOpenRef.current), [artifact, baseUrl, dashboardUrl, showControls]);

  // Send theme changes to iframe dynamically (without full reload)
  useEffect(() => {
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage({
        type: 'stack-theme-change',
        theme: resolvedTheme,
      }, '*');
    }
  }, [resolvedTheme]);

  useEffect(() => {
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage({
        type: 'dashboard-controls-update',
        chatOpen: !!isChatOpen,
      }, '*');
    }
  }, [isChatOpen]);


  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (typeof event.data !== "object" || event.data === null) {
        return;
      }
      if (event.origin !== "null") {
        return;
      }
      if (!iframeRef.current?.contentWindow || event.source !== iframeRef.current.contentWindow) {
        return;
      }
      const type = event.data.type;

      if (type === "stack-access-token-request") {
        const requestId = event.data.requestId;
        runAsynchronously(async () => {
          const accessToken = await user.getAccessToken();
          if (!accessToken) {
            const err = new Error('[DashboardSandboxHost] Failed to get access token: access token is null');
            captureError('dashboard-sandbox-host', err);
            event.source?.postMessage({
              type: 'stack-access-token-response',
              requestId,
              accessToken: null,
              error: err.message,
            }, { targetOrigin: '*' });
            return;
          }

          event.source?.postMessage({
            type: 'stack-access-token-response',
            requestId,
            accessToken,
          }, { targetOrigin: '*' });
        });
        return;
      }

      if (type === "dashboard-navigate") {
        onNavigateRef.current?.(event.data.path);
        return;
      }

      if (type === "dashboard-back") {
        onBackRef.current?.();
        return;
      }

      if (type === "dashboard-edit") {
        onEditToggleRef.current?.();
        return;
      }

      if (type === "dashboard-sandbox-dependency-error") {
        const err = new Error(event.data.message ?? 'Unknown custom dashboard dependency error');
        if (event.data.stack) err.stack = event.data.stack;
        captureError('dashboard-sandbox-dependency-error', err);
        return;
      }

      if (type === "dashboard-error-boundary") {
        const err = new Error(event.data.message ?? 'Unknown dashboard error');
        if (event.data.stack) err.stack = event.data.stack;
        captureError('dashboard-sandbox-error-boundary', err);
        onRuntimeErrorRef.current?.({
          message: typeof event.data.message === "string" ? event.data.message : "Unknown dashboard error",
          stack: typeof event.data.stack === "string" ? event.data.stack : undefined,
          componentStack: typeof event.data.componentStack === "string" ? event.data.componentStack : undefined,
        });
        return;
      }

      if (type === "stack-ai-dashboard-error") {
        // Thrown during sandbox initialization (deps failed to load, Dashboard export missing, etc.)
        // Surface it via the same channel so the UX is consistent with runtime errors.
        onRuntimeErrorRef.current?.({
          message: typeof event.data.message === "string" ? event.data.message : "Failed to initialize dashboard",
          stack: typeof event.data.stack === "string" ? event.data.stack : undefined,
        });
        return;
      }

      if (type === "dashboard-widget-selected") {
        onWidgetSelectedRef.current?.({
          metadata: {
            heading: typeof event.data.metadata?.heading === "string" ? event.data.metadata.heading : null,
            tagName: typeof event.data.metadata?.tagName === "string" ? event.data.metadata.tagName : "div",
            classes: typeof event.data.metadata?.classes === "string" ? event.data.metadata.classes : "",
            textPreview: typeof event.data.metadata?.textPreview === "string" ? event.data.metadata.textPreview : "",
            rect: {
              width: typeof event.data.metadata?.rect?.width === "number" ? event.data.metadata.rect.width : 0,
              height: typeof event.data.metadata?.rect?.height === "number" ? event.data.metadata.rect.height : 0,
            },
          },
        });
        return;
      }

      if (type === "stack-ai-dashboard-ready") {
        onReadyRef.current?.();
        return;
      }
    };

    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
    };
  }, [user]);

  return (
    <iframe
      ref={iframeRef}
      title="AI Dashboard Preview"
      sandbox="allow-scripts"
      srcDoc={srcDoc}
      className="h-full w-full bg-transparent"

    />
  );
});
