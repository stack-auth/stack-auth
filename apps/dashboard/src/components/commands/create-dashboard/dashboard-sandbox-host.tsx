"use client";

import { DashboardRuntimeCodegen } from "@/lib/ai-dashboard/contracts";
import { getPublicEnvVar } from "@/lib/env";
import { useUser } from "@stackframe/stack";
import { captureError } from "@stackframe/stack-shared/dist/utils/errors";
import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";
import { useTheme } from "@/lib/theme";
import { memo, useEffect, useMemo, useRef } from "react";
import packageJson from "../../../../package.json";

type DashboardArtifact = {
  prompt: string,
  projectId: string,
  runtimeCodegen: DashboardRuntimeCodegen,
};

function html(strings: TemplateStringsArray, ...values: unknown[]): string {
  return strings.reduce<string>((result, str, i) => result + str + (values[i] ?? ''), '');
}

const isDev = process.env.NODE_ENV === "development";

function getDependencyScripts(esmVersion: string, dashboardUrl: string): string {
  if (isDev) {
    return html`
      <script type="module">
        import React from 'https://esm.sh/react@18';
        import * as ReactDOM from 'https://esm.sh/react-dom@18?deps=react@18';
        import * as ReactDOMClient from 'https://esm.sh/react-dom@18/client?deps=react@18';
        import * as Recharts from 'https://esm.sh/recharts@2.15.4?deps=react@18,react-dom@18';
        import * as StackSDK from 'https://esm.sh/@stackframe/js@${esmVersion}';
        import { generateUuid } from 'https://esm.sh/@stackframe/stack-shared@${esmVersion}/dist/utils/uuids';

        window.React = React;
        window.ReactDOM = { ...ReactDOM, ...ReactDOMClient };
        window.Recharts = Recharts;
        window.StackAdminApp = StackSDK.StackAdminApp;
        window.StackServerApp = StackSDK.StackServerApp;
        window.StackSDK = StackSDK;
        window.generateUuid = generateUuid;

        // Load local IIFE for dashboard-ui-components (after globals are set)
        const script = document.createElement('script');
        script.src = '${dashboardUrl}/dashboard-ui-components.iife.js';
        script.onload = () => {
          window.__depsReady = true;
          window.dispatchEvent(new Event('deps-ready'));
        };
        script.onerror = (e) => {
          console.error('Failed to load dashboard-ui-components IIFE bundle', e);
        };
        document.head.appendChild(script);
      </script>`;
  }

  return html`
    <script type="module">
      import React from 'https://esm.sh/react@18';
      import * as ReactDOM from 'https://esm.sh/react-dom@18?deps=react@18';
      import * as ReactDOMClient from 'https://esm.sh/react-dom@18/client?deps=react@18';
      import * as Recharts from 'https://esm.sh/recharts@2.15.4?deps=react@18,react-dom@18';
      import * as DashboardUIComponents from 'https://esm.sh/@stackframe/dashboard-ui-components@${esmVersion}?deps=react@18,react-dom@18';
      import * as StackSDK from 'https://esm.sh/@stackframe/js@${esmVersion}';
      import { generateUuid } from 'https://esm.sh/@stackframe/stack-shared@${esmVersion}/dist/utils/uuids';
      
      window.React = React;
      window.ReactDOM = { ...ReactDOM, ...ReactDOMClient };
      window.Recharts = Recharts;
      window.DashboardUI = DashboardUIComponents;
      window.StackAdminApp = StackSDK.StackAdminApp;
      window.StackServerApp = StackSDK.StackServerApp;
      window.StackSDK = StackSDK;
      window.generateUuid = generateUuid;
      
      window.__depsReady = true;
      window.dispatchEvent(new Event('deps-ready'));
    </script>`;
}

function getSandboxDocument(artifact: DashboardArtifact, baseUrl: string, dashboardUrl: string, initialTheme: "light" | "dark", showControls: boolean, initialChatOpen: boolean, savedGridState?: unknown): string {
  const sourceCode = artifact.runtimeCodegen.uiRuntimeSourceCode;
  const darkClass = initialTheme === "dark" ? "dark" : "";
  const esmVersion = packageJson.version;
  const devScriptSrc = isDev ? ` ${dashboardUrl}` : '';
  const devConnectSrc = isDev ? ` ${dashboardUrl} http://127.0.0.1:7322` : '';

  return html`<!doctype html>
<html class="${darkClass}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' https://unpkg.com https://cdn.jsdelivr.net https://cdn.tailwindcss.com https://esm.sh https://js.stripe.com${devScriptSrc}; style-src 'unsafe-inline' https://cdn.jsdelivr.net; img-src data: https:; connect-src ${baseUrl} https://unpkg.com https://cdn.jsdelivr.net https://esm.sh https://api.stripe.com https://m.stripe.com https://m.stripe.network${devConnectSrc}; font-src 'none'; frame-src https://js.stripe.com https://hooks.stripe.com https://m.stripe.network; worker-src 'none';" />
    
    <!-- Tailwind CSS Play CDN (for on-the-fly processing) -->
    <script src="https://cdn.tailwindcss.com"></script>
    <script>
      tailwind.config = {
        darkMode: 'class',
        theme: {
          extend: {
            colors: {
              border: 'hsl(var(--border))',
              input: 'hsl(var(--input))',
              ring: 'hsl(var(--ring))',
              background: 'hsl(var(--background))',
              foreground: 'hsl(var(--foreground))',
              primary: {
                DEFAULT: 'hsl(var(--primary))',
                foreground: 'hsl(var(--primary-foreground))',
              },
              secondary: {
                DEFAULT: 'hsl(var(--secondary))',
                foreground: 'hsl(var(--secondary-foreground))',
              },
              destructive: {
                DEFAULT: 'hsl(var(--destructive))',
                foreground: 'hsl(var(--destructive-foreground))',
              },
              muted: {
                DEFAULT: 'hsl(var(--muted))',
                foreground: 'hsl(var(--muted-foreground))',
              },
              accent: {
                DEFAULT: 'hsl(var(--accent))',
                foreground: 'hsl(var(--accent-foreground))',
              },
              card: {
                DEFAULT: 'hsl(var(--card))',
                foreground: 'hsl(var(--card-foreground))',
              },
            },
          }
        }
      }
    </script>
    
    <style>
      :root {
        --background: 0 0% 100%;
        --foreground: 240 10% 3.9%;
        --card: 0 0% 100%;
        --card-foreground: 240 10% 3.9%;
        --primary: 240 5.9% 10%;
        --primary-foreground: 0 0% 98%;
        --secondary: 240 4.8% 95.9%;
        --secondary-foreground: 240 5.9% 10%;
        --muted: 240 4.8% 95.9%;
        --muted-foreground: 240 3.8% 46.1%;
        --accent: 240 4.8% 95.9%;
        --accent-foreground: 240 5.9% 10%;
        --destructive: 0 84.2% 60.2%;
        --destructive-foreground: 0 0% 98%;
        --border: 240 5.9% 90%;
        --input: 240 5.9% 90%;
        --ring: 240 10% 3.9%;
      }
      .dark {
        --background: 240 10% 3.9%;
        --foreground: 0 0% 98%;
        --card: 240 10% 9.4%;
        --card-foreground: 0 0% 98%;
        --primary: 0 0% 98%;
        --primary-foreground: 240 5.9% 10%;
        --secondary: 240 3.7% 15.9%;
        --secondary-foreground: 0 0% 98%;
        --muted: 240 3.7% 15.9%;
        --muted-foreground: 240 5% 64.9%;
        --accent: 240 3.7% 15.9%;
        --accent-foreground: 0 0% 98%;
        --destructive: 0 62.8% 50%;
        --destructive-foreground: 0 0% 98%;
        --border: 240 3.7% 35.9%;
        --input: 240 3.7% 25.9%;
        --ring: 240 4.9% 83.9%;
      }
      :root, .dark { --page-background: transparent; }
      html, body {
        margin: 0;
        padding: 0;
        width: 100%;
        height: 100%;
        overflow-x: hidden;
        font-family: Inter, system-ui, -apple-system, Segoe UI, sans-serif;
        background: var(--page-background);
        color: hsl(var(--foreground));
      }
      #root { width: 100%; height: 100%; overflow-x: hidden; }
      * { box-sizing: border-box; }
      .dark { color-scheme: dark; }
      html, body, #root { scrollbar-width: none; }
      html::-webkit-scrollbar, body::-webkit-scrollbar, #root::-webkit-scrollbar { display: none; }
    </style>
  </head>
  <body>
    <div id="root"></div>
    
    <!-- Babel (for JSX transpilation) -->
    <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
    
    ${getDependencyScripts(esmVersion, dashboardUrl)}
    
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
      window.dashboardDoneEditing = function() {
        window.parent.postMessage({ type: 'dashboard-done-editing' }, '*');
      };
      window.addEventListener('keydown', function(e) {
        if (e.key === 'Alt') {
          e.preventDefault();
          window.parent.postMessage({ type: 'dashboard-alt-key-down' }, '*');
        }
      });
      window.addEventListener('keyup', function(e) {
        if (e.key === 'Alt') {
          window.parent.postMessage({ type: 'dashboard-alt-key-up' }, '*');
        }
      });

      // Controls visibility flag — only true in the full dashboard viewer (not cmd+K preview)
      window.__showControls = ${showControls};
      window.__chatOpen = false;
      window.__editPanelOpen = false;
      window.__layoutEditing = false;
      window.__selectingForEdit = false;
      window.__savedGridState = ${savedGridState != null ? JSON.stringify(savedGridState) : 'null'};

      // Theme syncing, chat state, and layout edit from parent window
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
          window.__editPanelOpen = !!event.data.editPanelOpen;
          window.dispatchEvent(new Event('chat-state-change'));
        }
        if (event.data?.type === 'dashboard-layout-edit-update') {
          window.__layoutEditing = !!event.data.editing;
          window.dispatchEvent(new Event('layout-edit-change'));
        }
        if (event.data?.type === 'dashboard-selecting-for-edit-update') {
          window.__selectingForEdit = !!event.data.selecting;
          window.dispatchEvent(new Event('selecting-for-edit-change'));
        }
      });

      // Auto-update Edit button label based on editPanelOpen state
      // This works for ALL dashboards (old and new) by directly finding and patching the button text
      function patchEditButtonLabel() {
        // Find buttons that contain "Edit" text (the edit/done button)
        var buttons = document.querySelectorAll('button');
        for (var i = 0; i < buttons.length; i++) {
          var btn = buttons[i];
          var text = btn.textContent.trim();
          if (text === 'Edit ✎' && window.__editPanelOpen) {
            btn.textContent = 'Edit Layout ✎';
          } else if (text === 'Edit Layout ✎' && !window.__editPanelOpen) {
            btn.textContent = 'Edit ✎';
          }
        }
      }
      window.addEventListener('chat-state-change', patchEditButtonLabel);
      // Also run periodically to catch React re-renders that reset the text
      setInterval(patchEditButtonLabel, 200);

      // Forward widget edit requests from DashboardUI components to parent
      window.addEventListener('widget-edit-request', function(e) {
        window.parent.postMessage({ type: 'dashboard-edit-widget', widgetId: e.detail.widgetId, widgetLabel: e.detail.widgetLabel }, '*');
      });

      // Forward widget add requests from DashboardUI components to parent
      window.addEventListener('widget-add-request', function(e) {
        window.parent.postMessage({
          type: 'dashboard-add-widget',
          x: e.detail.x,
          y: e.detail.y,
          width: e.detail.width,
          height: e.detail.height
        }, '*');
      });

      // Forward grid state changes from DashboardUI grid to parent
      window.addEventListener('grid-state-change', function(e) {
        window.parent.postMessage({
          type: 'dashboard-grid-state-change',
          serializedGrid: e.detail.serializedGrid
        }, '*');
      });

      // Listen for saved grid state from parent (sent before AI code runs)
      window.addEventListener('message', function(e) {
        if (e.data && e.data.type === 'dashboard-saved-grid-state') {
          window.__savedGridState = e.data.serializedGrid;
        }
      });

      const STACK_CONFIG = {
        baseUrl: ${JSON.stringify(baseUrl)},
        projectId: ${JSON.stringify(artifact.projectId)},
      };
      
      async function waitForDeps() {
        if (window.__depsReady) return;
        await new Promise(resolve => {
          window.addEventListener('deps-ready', resolve, { once: true });
        });
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
        
        const stackServerApp = new window.StackAdminApp({
          projectId: STACK_CONFIG.projectId,
          baseUrl: STACK_CONFIG.baseUrl,
          projectOwnerSession: async () => {
            return await requestAccessToken();
          },
        });
        
        window.stackServerApp = stackServerApp;
        
        return stackServerApp;
      }
      
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
          console.error('[ErrorBoundary] Caught error:', error, errorInfo);
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
        
        // Monkey-patch to restore saved grid state.
        // Handles both AI code patterns:
        //   1. fromWidgetInstances([...widgets], opts) — patched directly
        //   2. fromWidgetInstances([], opts) + .withAddedElementInstance() chain — patched via withAddedElementInstance
        const _origFromWidgetInstances = DashboardUI.WidgetInstanceGrid.fromWidgetInstances;
        DashboardUI.WidgetInstanceGrid.fromWidgetInstances = function(instances, options) {
          if (window.__savedGridState && instances.length > 0) {
            const saved = window.__savedGridState;
            window.__savedGridState = null;
            try {
              const widgets = instances.map(function(i) { return i.widget; });
              return DashboardUI.WidgetInstanceGrid.fromSerialized(widgets, saved);
            } catch (e) {
              console.warn('[Dashboard] Failed to restore saved grid state, using defaults', e);
            }
          }
          return _origFromWidgetInstances.call(this, instances, options);
        };

        // For the withAddedElementInstance chain pattern: after the last call,
        // the grid has all widgets. We try restoring on each call — fromSerialized
        // will only succeed when all saved widgetIds are present.
        const _origWithAddedElementInstance = DashboardUI.WidgetInstanceGrid.prototype.withAddedElementInstance;
        DashboardUI.WidgetInstanceGrid.prototype.withAddedElementInstance = function() {
          var newGrid = _origWithAddedElementInstance.apply(this, arguments);
          if (window.__savedGridState) {
            try {
              var elements = newGrid.elements();
              var widgets = elements
                .filter(function(el) { return el.instance != null; })
                .map(function(el) { return el.instance.widget; });
              var saved = JSON.parse(JSON.stringify(window.__savedGridState));
              var widgetIds = new Set(widgets.map(function(w) { return w.id; }));
              var allFound = saved.nonEmptyElements.every(function(el) {
                return !el.instance || widgetIds.has(el.instance.widgetId);
              });
              if (allFound && widgets.length > 0) {
                window.__savedGridState = null;
                return DashboardUI.WidgetInstanceGrid.fromSerialized(widgets, saved);
              }
            } catch (e) {
              // Not all widgets added yet — keep waiting
            }
          }
          return newGrid;
        };

        // Execute AI-generated code with DashboardUI and Recharts in scope
        const Dashboard = (() => {
          ${sourceCode}
          return Dashboard;
        })();
        
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
  </body>
</html>`;
}

export const DashboardSandboxHost = memo(function DashboardSandboxHost({
  artifact,
  onBack,
  onEditToggle,
  onDoneEditing,
  onAltKeyDown,
  onAltKeyUp,
  onNavigate,
  onWidgetEditRequest,
  onWidgetAddRequest,
  onGridStateChange,
  savedGridState,
  isChatOpen,
  layoutEditing,
  selectingForEdit,
}: {
  artifact: DashboardArtifact,
  onBack?: () => void,
  onEditToggle?: () => void,
  onDoneEditing?: () => void,
  onAltKeyDown?: () => void,
  onAltKeyUp?: () => void,
  onNavigate?: (path: string) => void,
  onWidgetEditRequest?: (widgetId: string, widgetLabel: string) => void,
  onWidgetAddRequest?: (x: number, y: number, width: number, height: number) => void,
  onGridStateChange?: (serializedGrid: unknown) => void,
  savedGridState?: unknown,
  isChatOpen?: boolean,
  layoutEditing?: boolean,
  selectingForEdit?: boolean,
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  const onEditToggleRef = useRef(onEditToggle);
  onEditToggleRef.current = onEditToggle;
  const onDoneEditingRef = useRef(onDoneEditing);
  onDoneEditingRef.current = onDoneEditing;
  const onAltKeyDownRef = useRef(onAltKeyDown);
  onAltKeyDownRef.current = onAltKeyDown;
  const onAltKeyUpRef = useRef(onAltKeyUp);
  onAltKeyUpRef.current = onAltKeyUp;
  const onNavigateRef = useRef(onNavigate);
  onNavigateRef.current = onNavigate;
  const onWidgetEditRequestRef = useRef(onWidgetEditRequest);
  onWidgetEditRequestRef.current = onWidgetEditRequest;
  const onWidgetAddRequestRef = useRef(onWidgetAddRequest);
  onWidgetAddRequestRef.current = onWidgetAddRequest;
  const onGridStateChangeRef = useRef(onGridStateChange);
  onGridStateChangeRef.current = onGridStateChange;
  const savedGridStateRef = useRef(savedGridState);
  savedGridStateRef.current = savedGridState;
  const user = useUser({ or: "redirect" });
  const { resolvedTheme } = useTheme();

  const baseUrl = useMemo(() => {
    return getPublicEnvVar("NEXT_PUBLIC_STACK_API_URL") ?? 'http://localhost:8102';
  }, []);

  const dashboardUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    return window.location.origin;
  }, []);

  const initialThemeRef = useRef<"light" | "dark">(resolvedTheme === "dark" ? "dark" : "light");
  const initialChatOpenRef = useRef(!!isChatOpen);
  const showControls = onBack != null || onEditToggle != null;
  const srcDoc = useMemo(() => getSandboxDocument(artifact, baseUrl, dashboardUrl, initialThemeRef.current, showControls, initialChatOpenRef.current, savedGridStateRef.current), [artifact, baseUrl, dashboardUrl, showControls]);

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
        chatOpen: false,
        editPanelOpen: !!isChatOpen,
      }, '*');
    }
  }, [isChatOpen]);

  useEffect(() => {
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage({
        type: 'dashboard-layout-edit-update',
        editing: !!layoutEditing,
      }, '*');
    }
  }, [layoutEditing]);

  useEffect(() => {
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage({
        type: 'dashboard-selecting-for-edit-update',
        selecting: !!selectingForEdit,
      }, '*');
    }
  }, [selectingForEdit]);

  useEffect(() => {
    if (iframeRef.current?.contentWindow && savedGridState) {
      iframeRef.current.contentWindow.postMessage({
        type: 'dashboard-saved-grid-state',
        serializedGrid: savedGridState,
      }, '*');
    }
  }, [savedGridState]);

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

      if (type === "dashboard-done-editing") {
        onDoneEditingRef.current?.();
        return;
      }

      if (type === "dashboard-alt-key-down") {
        onAltKeyDownRef.current?.();
        return;
      }

      if (type === "dashboard-alt-key-up") {
        onAltKeyUpRef.current?.();
        return;
      }

      if (type === "dashboard-edit-widget") {
        onWidgetEditRequestRef.current?.(event.data.widgetId, event.data.widgetLabel ?? event.data.widgetId);
        return;
      }

      if (type === "dashboard-add-widget") {
        onWidgetAddRequestRef.current?.(event.data.x, event.data.y, event.data.width, event.data.height);
        return;
      }

      if (type === "dashboard-grid-state-change") {
        onGridStateChangeRef.current?.(event.data.serializedGrid);
        return;
      }

      if (type === "stack-ai-dashboard-ready" || type === "stack-ai-dashboard-error") {
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
