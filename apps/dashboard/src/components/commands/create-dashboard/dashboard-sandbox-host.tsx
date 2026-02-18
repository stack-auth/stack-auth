"use client";

import { DashboardRuntimeCodegen } from "@/lib/ai-dashboard/contracts";
import { getPublicEnvVar } from "@/lib/env";
import { useUser } from "@stackframe/stack";
import { captureError } from "@stackframe/stack-shared/dist/utils/errors";
import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import packageJson from "../../../../package.json";

type DashboardArtifact = {
  prompt: string,
  projectId: string,
  runtimeCodegen: DashboardRuntimeCodegen,
};

function html(strings: TemplateStringsArray, ...values: unknown[]): string {
  return strings.reduce<string>((result, str, i) => result + str + (values[i] ?? ''), '');
}

function getSandboxDocument(artifact: DashboardArtifact, baseUrl: string): string {
  const sourceCode = artifact.runtimeCodegen.uiRuntimeSourceCode;

  return html`<!doctype html>
<html>
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
              border: 'hsl(240 3.7% 15.9%)',
              input: 'hsl(240 3.7% 15.9%)',
              ring: 'hsl(240 4.9% 83.9%)',
              background: 'hsl(240 10% 3.9%)',
              foreground: 'hsl(0 0% 98%)',
              primary: {
                DEFAULT: 'hsl(0 0% 98%)',
                foreground: 'hsl(240 5.9% 10%)',
              },
              secondary: {
                DEFAULT: 'hsl(240 3.7% 15.9%)',
                foreground: 'hsl(0 0% 98%)',
              },
              destructive: {
                DEFAULT: 'hsl(0 62.8% 30.6%)',
                foreground: 'hsl(0 0% 98%)',
              },
              muted: {
                DEFAULT: 'hsl(240 3.7% 15.9%)',
                foreground: 'hsl(240 5% 64.9%)',
              },
              accent: {
                DEFAULT: 'hsl(240 3.7% 15.9%)',
                foreground: 'hsl(0 0% 98%)',
              },
              card: {
                DEFAULT: 'hsl(240 10% 3.9%)',
                foreground: 'hsl(0 0% 98%)',
              },
            },
          }
        }
      }
    </script>
    
    <style>
      html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow-x: hidden; font-family: Inter, system-ui, -apple-system, Segoe UI, sans-serif; background: #0b0b0f; color: #f3f4f6; }
      #root { width: 100%; height: 100%; overflow-x: hidden; }
      * { box-sizing: border-box; }
    </style>
  </head>
  <body>
    <div id="root"></div>
    
    <!-- React, ReactDOM, and Babel -->
    <script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
    <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
    <script crossorigin src="https://unpkg.com/prop-types@15.8.1/prop-types.min.js"></script>
    <script crossorigin src="https://unpkg.com/react-is@18/umd/react-is.production.min.js"></script>
    <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
    
    <!-- Recharts (via CDN) -->
    <script src="https://cdn.jsdelivr.net/npm/recharts@2.15.4/umd/Recharts.js"></script>
    
    <!-- Stack SDK (via esm.sh CDN) -->
    <script type="module">
      import * as StackSDK from 'https://esm.sh/@stackframe/js@${packageJson.version}';
      
      // Expose Stack SDK globally for the Babel-transpiled code
      window.StackAdminApp = StackSDK.StackAdminApp;
      window.StackServerApp = StackSDK.StackServerApp;
      window.StackSDK = StackSDK;
      
      // Signal that SDK is loaded
      window.__stackSdkReady = true;
      window.dispatchEvent(new Event('stack-sdk-ready'));
    </script>
    
    <!-- UUID utility (via esm.sh CDN) -->
    <script type="module">
      import { generateUuid } from 'https://esm.sh/@stackframe/stack-shared@${packageJson.version}/dist/utils/uuids';
      window.generateUuid = generateUuid;
    </script>
    
    <script type="text/babel">
      // Stack Server App config (no embedded token - fetched via postMessage)
      const STACK_CONFIG = {
        baseUrl: ${JSON.stringify(baseUrl)},
        projectId: ${JSON.stringify(artifact.projectId)},
      };

      const Recharts = window.Recharts;
      if (!Recharts) {
        throw new Error("Recharts failed to load in sandbox. Check CDN dependencies.");
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
        if (!window.__stackSdkReady) {
          await new Promise(resolve => {
            window.addEventListener('stack-sdk-ready', resolve, { once: true });
          });
        }
        
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
        
        // Make it globally available for AI-generated code
        // Note: Variable name remains stackServerApp as we may change StackAdminApp in the future while StackServerApp is stable, even though it's a StackAdminApp instance
        window.stackServerApp = stackServerApp;
        
        return stackServerApp;
      }
      
      // Shadcn-style components
      const Card = ({ children, className = "", ...props }) => (
        <div className={\`rounded-lg border bg-card text-card-foreground shadow-sm \${className}\`} {...props}>
          {children}
        </div>
      );
      
      const CardHeader = ({ children, className = "", ...props }) => (
        <div className={\`flex flex-col space-y-1.5 p-6 \${className}\`} {...props}>
          {children}
        </div>
      );
      
      const CardTitle = ({ children, className = "", ...props }) => (
        <h3 className={\`text-2xl font-semibold leading-none tracking-tight \${className}\`} {...props}>
          {children}
        </h3>
      );
      
      const CardDescription = ({ children, className = "", ...props }) => (
        <p className={\`text-sm text-muted-foreground \${className}\`} {...props}>
          {children}
        </p>
      );
      
      const CardContent = ({ children, className = "", ...props }) => (
        <div className={\`p-6 pt-0 \${className}\`} {...props}>
          {children}
        </div>
      );
      
      const CardFooter = ({ children, className = "", ...props }) => (
        <div className={\`flex items-center p-6 pt-0 \${className}\`} {...props}>
          {children}
        </div>
      );
      
      const Button = ({ children, className = "", variant = "default", size = "default", ...props }) => {
        const variants = {
          default: "bg-primary text-primary-foreground hover:bg-primary/90",
          destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
          outline: "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
          secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
          ghost: "hover:bg-accent hover:text-accent-foreground",
          link: "text-primary underline-offset-4 hover:underline",
        };
        const sizes = {
          default: "h-10 px-4 py-2",
          sm: "h-9 rounded-md px-3",
          lg: "h-11 rounded-md px-8",
          icon: "h-10 w-10",
        };
        return (
          <button
            className={\`inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 \${variants[variant]} \${sizes[size]} \${className}\`}
            {...props}
          >
            {children}
          </button>
        );
      };
      
      const Table = ({ children, className = "", ...props }) => (
        <div className="relative w-full overflow-auto">
          <table className={\`w-full caption-bottom text-sm \${className}\`} {...props}>
            {children}
          </table>
        </div>
      );
      
      const TableHeader = ({ children, className = "", ...props }) => (
        <thead className={\`[&_tr]:border-b \${className}\`} {...props}>
          {children}
        </thead>
      );
      
      const TableBody = ({ children, className = "", ...props }) => (
        <tbody className={\`[&_tr:last-child]:border-0 \${className}\`} {...props}>
          {children}
        </tbody>
      );
      
      const TableRow = ({ children, className = "", ...props }) => (
        <tr className={\`border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted \${className}\`} {...props}>
          {children}
        </tr>
      );
      
      const TableHead = ({ children, className = "", ...props }) => (
        <th className={\`h-12 px-4 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0 \${className}\`} {...props}>
          {children}
        </th>
      );
      
      const TableCell = ({ children, className = "", ...props }) => (
        <td className={\`p-4 align-middle [&:has([role=checkbox])]:pr-0 \${className}\`} {...props}>
          {children}
        </td>
      );
      
      const Badge = ({ children, className = "", variant = "default", ...props }) => {
        const variants = {
          default: "border-transparent bg-primary text-primary-foreground hover:bg-primary/80",
          secondary: "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
          destructive: "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80",
          outline: "text-foreground",
        };
        return (
          <div className={\`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 \${variants[variant]} \${className}\`} {...props}>
            {children}
          </div>
        );
      };
      
      const Skeleton = ({ className = "", ...props }) => (
        <div className={\`animate-pulse rounded-md bg-muted \${className}\`} {...props} />
      );
      
      const Separator = ({ className = "", orientation = "horizontal", ...props }) => (
        <div
          className={\`shrink-0 bg-border \${orientation === "horizontal" ? "h-[1px] w-full" : "h-full w-[1px]"} \${className}\`}
          {...props}
        />
      );
      
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
        
      window.Dashboard = (() => {
        ${sourceCode}
        return Dashboard;
      })();
      
      // Boot the dashboard
      const rootElement = document.getElementById('root');
      if (!rootElement) {
        throw new Error('Root element not found');
      }
      
      const root = ReactDOM.createRoot(rootElement);
      
      // Initialize Stack SDK and boot the dashboard
      initializeStackApp().then(() => {
        try {
          // Dashboard should be defined by the AI-generated code
          const Dashboard = window.Dashboard;
          if (typeof Dashboard !== 'function') {
            throw new Error('Dashboard component not found in generated code');
          }
          
          root.render(
            <ErrorBoundary>
              <Dashboard />
            </ErrorBoundary>
          );
          
          // Notify parent that sandbox is ready
          parent.postMessage({ type: "stack-ai-dashboard-ready" }, "*");
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown sandbox error";
          parent.postMessage({
            type: "stack-ai-dashboard-error",
            message: message,
            stack: error instanceof Error ? error.stack : undefined,
          }, "*");
          
          // Render error in UI
          root.render(
            <div className="p-6 text-red-500">
              <h2 className="text-xl font-bold mb-2">Failed to load dashboard</h2>
              <pre className="text-sm bg-red-950/20 p-4 rounded">
                {message}
              </pre>
            </div>
          );
        }
      }).catch(error => {
        const message = error instanceof Error ? error.message : "Failed to initialize Stack SDK";
        parent.postMessage({
          type: "stack-ai-dashboard-error",
          message: message,
          stack: error instanceof Error ? error.stack : undefined,
        }, "*");
        
        root.render(
          <div className="p-6 text-red-500">
            <h2 className="text-xl font-bold mb-2">Failed to initialize SDK</h2>
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
}: {
  artifact: DashboardArtifact,
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [sandboxMessage, setSandboxMessage] = useState<string>("Waiting for sandbox...");
  const user = useUser({ or: "redirect" });

  // Get base URL from environment (same as used by stackServerApp)
  const baseUrl = useMemo(() => {
    return getPublicEnvVar("NEXT_PUBLIC_STACK_API_URL") ?? 'http://localhost:8102';
  }, []);

  const srcDoc = useMemo(() => getSandboxDocument(artifact, baseUrl), [artifact, baseUrl]);

  useEffect(() => {
    setSandboxMessage("Waiting for sandbox...");
    const timeoutId = setTimeout(() => {
      setSandboxMessage("Sandbox loading...");
    }, 10000);
    return () => clearTimeout(timeoutId);
  }, [artifact.prompt]);

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

      // Handle sandbox ready/error messages
      if (type === "stack-ai-dashboard-ready") {
        setSandboxMessage("Sandbox ready");
        return;
      }

      if (type === "stack-ai-dashboard-error") {
        const message = typeof event.data.message === "string" ? event.data.message : "Unknown sandbox error";
        setSandboxMessage(`Sandbox error: ${message}`);
        return;
      }
    };

    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
    };
  }, [user]);

  return (
    <div className="flex flex-col h-full w-full gap-2">
      <div className="text-[10px] text-muted-foreground/70">{sandboxMessage}</div>
      <iframe
        ref={iframeRef}
        title="AI Dashboard Preview"
        sandbox="allow-scripts"
        srcDoc={srcDoc}
        className="h-full w-full rounded-lg border border-foreground/[0.08] bg-[#0b0b0f]"
      />
    </div>
  );
});
