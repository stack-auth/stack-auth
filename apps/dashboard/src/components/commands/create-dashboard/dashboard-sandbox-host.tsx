"use client";

import { DashboardRuntimeCodegen } from "@/lib/ai-dashboard/contracts";
import { getPublicEnvVar } from "@/lib/env";
import { useUser } from "@stackframe/stack";
import { captureError } from "@stackframe/stack-shared/dist/utils/errors";
import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";
import { useTheme } from "next-themes";
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

function getDependencyScripts(esmVersion: string): string {
  return html`
    <script type="module">
      import React from 'https://esm.sh/react@18';
      import * as ReactDOMClient from 'https://esm.sh/react-dom@18/client?deps=react@18';
      import * as Recharts from 'https://esm.sh/recharts@2.15.4?deps=react@18,react-dom@18';
      import * as DashboardUIComponents from 'https://esm.sh/@stackframe/dashboard-ui-components@${esmVersion}?deps=react@18,react-dom@18';
      import * as StackSDK from 'https://esm.sh/@stackframe/js@${esmVersion}';
      import { generateUuid } from 'https://esm.sh/@stackframe/stack-shared@${esmVersion}/dist/utils/uuids';
      
      window.React = React;
      window.ReactDOM = ReactDOMClient;
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

function getSandboxDocument(artifact: DashboardArtifact, baseUrl: string, initialTheme: "light" | "dark", showControls: boolean, initialChatOpen: boolean): string {
  const sourceCode = artifact.runtimeCodegen.uiRuntimeSourceCode;
  const darkClass = initialTheme === "dark" ? "dark" : "";
  const esmVersion = packageJson.version;

  return html`<!doctype html>
<html class="${darkClass}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' https://unpkg.com https://cdn.jsdelivr.net https://cdn.tailwindcss.com https://esm.sh https://js.stripe.com; style-src 'unsafe-inline' https://cdn.jsdelivr.net; img-src data:; connect-src ${baseUrl} https://unpkg.com https://cdn.jsdelivr.net https://esm.sh https://api.stripe.com https://m.stripe.com https://m.stripe.network; font-src 'none'; frame-src https://js.stripe.com https://hooks.stripe.com https://m.stripe.network; worker-src 'none';" />
    
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
        --background: 230 45% 86%;
        --foreground: 240 10% 3.9%;
        --card: 0 0% 100%;
        --card-foreground: 240 10% 3.9%;
        --primary: 240 5.9% 10%;
        --primary-foreground: 0 0% 98%;
        --secondary: 245 30% 90%;
        --secondary-foreground: 240 5.9% 10%;
        --muted: 250 35% 92%;
        --muted-foreground: 232 12% 38%;
        --accent: 248 32% 91%;
        --accent-foreground: 240 5.9% 10%;
        --destructive: 0 84.2% 60.2%;
        --destructive-foreground: 0 0% 98%;
        --border: 230 25% 78%;
        --input: 230 20% 72%;
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
      html, body {
        margin: 0;
        padding: 0;
        width: 100%;
        height: 100%;
        overflow-x: hidden;
        font-family: Inter, system-ui, -apple-system, Segoe UI, sans-serif;
        background: hsl(var(--background));
        color: hsl(var(--foreground));
      }
      #root { width: 100%; height: 100%; overflow-x: hidden; }
      * { box-sizing: border-box; }
      .dark { color-scheme: dark; }
      ::-webkit-scrollbar { width: 8px; height: 8px; }
      ::-webkit-scrollbar-track { background: transparent; }
      ::-webkit-scrollbar-thumb { background: hsl(var(--border)); border-radius: 4px; }
      ::-webkit-scrollbar-thumb:hover { background: hsl(var(--muted-foreground)); }
      ::-webkit-scrollbar-corner { background: transparent; }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <div id="dashboard-controls" style="display:none;">
      <button id="ctrl-back" class="fixed top-4 left-4 z-50 flex items-center gap-1.5 px-3 py-2 rounded-xl bg-background/70 dark:bg-background/50 backdrop-blur-xl shadow-lg ring-1 ring-foreground/[0.08] text-foreground/80 hover:text-foreground hover:bg-background/90 dark:hover:bg-background/70 transition-colors duration-150 hover:transition-none cursor-pointer text-sm font-medium" onclick="window.parent.postMessage({type:'dashboard-back'},'*')">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 256 256" fill="currentColor"><path d="M224,128a8,8,0,0,1-8,8H59.31l58.35,58.34a8,8,0,0,1-11.32,11.32l-72-72a8,8,0,0,1,0-11.32l72-72a8,8,0,0,1,11.32,11.32L59.31,120H216A8,8,0,0,1,224,128Z"/></svg>
        Back
      </button>
      <button id="ctrl-edit" class="fixed top-4 right-6 z-50 flex items-center gap-1.5 px-3 py-2 rounded-xl bg-background/70 dark:bg-background/50 backdrop-blur-xl shadow-lg ring-1 ring-foreground/[0.08] text-foreground/80 hover:text-foreground hover:bg-background/90 dark:hover:bg-background/70 transition-colors duration-150 hover:transition-none cursor-pointer text-sm font-medium" onclick="window.parent.postMessage({type:'dashboard-edit'},'*')">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 256 256" fill="currentColor"><path d="M227.31,73.37,182.63,28.68a16,16,0,0,0-22.63,0L36.69,152A15.86,15.86,0,0,0,32,163.31V208a16,16,0,0,0,16,16H92.69A15.86,15.86,0,0,0,104,219.31L227.31,96a16,16,0,0,0,0-22.63ZM92.69,208H48V163.31l88-88L180.69,120Z"/></svg>
        Edit
      </button>
    </div>
    
    <script>
      ${showControls ? `
        document.getElementById('dashboard-controls').style.display = 'block';
        ${initialChatOpen ? `
          document.getElementById('ctrl-back').style.display = 'none';
          document.getElementById('ctrl-edit').style.display = 'none';
        ` : ''}
      ` : ''}
    </script>
    
    <!-- Babel (for JSX transpilation) -->
    <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
    
    ${getDependencyScripts(esmVersion)}
    
    <script type="text/babel">
      // Theme syncing from parent window
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
          var backBtn = document.getElementById('ctrl-back');
          if (backBtn) {
            backBtn.style.display = event.data.hideBack ? 'none' : '';
          }
          var editBtn = document.getElementById('ctrl-edit');
          if (editBtn) {
            editBtn.style.display = event.data.hideEdit ? 'none' : '';
          }
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
  isChatOpen,
}: {
  artifact: DashboardArtifact,
  onBack?: () => void,
  onEditToggle?: () => void,
  isChatOpen?: boolean,
}) {
  const showControls = onBack != null || onEditToggle != null;
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  const onEditToggleRef = useRef(onEditToggle);
  onEditToggleRef.current = onEditToggle;
  const user = useUser({ or: "redirect" });
  const { resolvedTheme } = useTheme();

  const baseUrl = useMemo(() => {
    return getPublicEnvVar("NEXT_PUBLIC_STACK_API_URL") ?? 'http://localhost:8102';
  }, []);

  const initialThemeRef = useRef<"light" | "dark">(resolvedTheme === "dark" ? "dark" : "light");
  const initialChatOpenRef = useRef(!!isChatOpen);
  const srcDoc = useMemo(() => getSandboxDocument(artifact, baseUrl, initialThemeRef.current, showControls, initialChatOpenRef.current), [artifact, baseUrl, showControls]);

  // Send theme changes to iframe dynamically (without full reload)
  useEffect(() => {
    if (iframeRef.current?.contentWindow && resolvedTheme) {
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
        hideBack: !!isChatOpen,
        hideEdit: !!isChatOpen,
      }, '*');
    }
  }, [isChatOpen]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (typeof event.data !== "object" || event.data === null) {
        return;
      }
      if (!iframeRef.current?.contentWindow || event.source !== iframeRef.current.contentWindow) {
        console.warn("Unknown iframe source; rejecting message", event);
        return;
      }
      if (event.origin !== "null") {
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

      if (type === "dashboard-back") {
        onBackRef.current?.();
        return;
      }

      if (type === "dashboard-edit") {
        onEditToggleRef.current?.();
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
      className="h-full w-full bg-background"
    />
  );
});
