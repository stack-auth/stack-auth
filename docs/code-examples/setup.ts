import { CodeExample } from '../lib/code-examples';

const rawServerEnv = `STACK_PROJECT_ID=<your-project-id>
STACK_PUBLISHABLE_CLIENT_KEY=<your-publishable-client-key>
STACK_SECRET_SERVER_KEY=<your-secret-server-key>`;

const viteEnv = `VITE_STACK_PROJECT_ID=<your-project-id>
VITE_STACK_PUBLISHABLE_CLIENT_KEY=<your-publishable-client-key>`;

const nextJsEnv = `NEXT_PUBLIC_STACK_PROJECT_ID=<your-project-id>
NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY=<your-publishable-client-key>
STACK_SECRET_SERVER_KEY=<your-secret-server-key>`;

const nuxtEnv = `NUXT_PUBLIC_STACK_PROJECT_ID=<your-project-id>
NUXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY=<your-publishable-client-key>
STACK_SECRET_SERVER_KEY=<your-secret-server-key>`;

const svelteKitEnv = `PUBLIC_STACK_PROJECT_ID=<your-project-id>
PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY=<your-publishable-client-key>
STACK_SECRET_SERVER_KEY=<your-secret-server-key>`;

function noteExample(framework: string, code: string): CodeExample {
  return {
    language: 'JavaScript',
    framework,
    code,
    highlightLanguage: 'typescript',
    filename: 'Note',
  };
}

const reactRouterInstallExample: CodeExample = { language: 'JavaScript', framework: 'React Router', code: 'npm install @stackframe/react', highlightLanguage: 'bash', filename: 'Terminal' };
const tanStackStartInstallExample: CodeExample = { language: 'JavaScript', framework: 'TanStack Start', code: 'npm install @stackframe/react', highlightLanguage: 'bash', filename: 'Terminal' };
const nuxtInstallExample: CodeExample = { language: 'JavaScript', framework: 'Nuxt', code: 'npm install @stackframe/js', highlightLanguage: 'bash', filename: 'Terminal' };
const svelteKitInstallExample: CodeExample = { language: 'JavaScript', framework: 'SvelteKit', code: 'npm install @stackframe/js', highlightLanguage: 'bash', filename: 'Terminal' };
const nestJsInstallExample: CodeExample = { language: 'JavaScript', framework: 'NestJS', code: 'npm install @stackframe/js', highlightLanguage: 'bash', filename: 'Terminal' };
const honoInstallExample: CodeExample = { language: 'JavaScript', framework: 'Hono', code: 'npm install @stackframe/js', highlightLanguage: 'bash', filename: 'Terminal' };
const cloudflareWorkersInstallExample: CodeExample = { language: 'JavaScript', framework: 'Cloudflare Workers', code: 'npm install @stackframe/js', highlightLanguage: 'bash', filename: 'Terminal' };

export const setupExamples = {
  'overview': {
    'install': [
      {
        language: 'JavaScript',
        framework: 'Next.js',
        code: `npx @stackframe/stack-cli@latest init`,
        highlightLanguage: 'bash',
        filename: 'Terminal'
      }
    ] as CodeExample[],
    'use-auth': [
      {
        language: 'JavaScript',
        framework: 'Next.js',
        code: `const user = useUser({ or: "redirect" });
return <div>Hi, {user.displayName}</div>;`,
        highlightLanguage: 'tsx',
        filename: 'page.tsx'
      }
    ] as CodeExample[],
  },
  'setup': {
    'env-wizard': [
      {
        language: 'JavaScript',
        framework: 'Next.js',
        code: nextJsEnv,
        highlightLanguage: 'bash',
        filename: '.env.local'
      },
      noteExample('React Router', `// The initializer does not scaffold React Router-specific files yet.
// Use the manual setup tab with the React Router recipe below.`),
      noteExample('TanStack Start', `// The initializer does not scaffold TanStack Start-specific files yet.
// Use the manual setup tab with the TanStack Start recipe below.`),
      noteExample('Nuxt', `// Nuxt support in this slice is guidance-first.
// Use the manual setup tab with the Nuxt recipe below.`),
      noteExample('SvelteKit', `// SvelteKit support in this slice is guidance-first.
// Use the manual setup tab with the SvelteKit recipe below.`),
      {
        language: 'JavaScript',
        framework: 'React',
        code: `// Update the values in stack/client.ts created by the wizard
export const stackClientApp = new StackClientApp({
  projectId: "your-project-id",
  publishableClientKey: "your-publishable-client-key",
  tokenStore: "cookie",
});`,
        highlightLanguage: 'typescript',
        filename: 'stack/client.ts'
      },
      noteExample('NestJS', `// The initializer does not scaffold NestJS-specific files yet.
// Use the manual setup tab with the NestJS recipe below.`),
      noteExample('Express', `// The initializer can help with generic JS setup, but Express support is still recipe-based.
// Use the manual setup tab for the explicit Express example below.`),
      noteExample('Hono', `// The initializer does not scaffold Hono-specific files yet.
// Use the manual setup tab with the Hono recipe below.`),
      noteExample('Cloudflare Workers', `// The initializer does not scaffold Worker bindings yet.
// Use the manual setup tab with the Cloudflare Workers recipe below.`),
      {
        language: 'JavaScript',
        framework: 'Vanilla JavaScript',
        code: rawServerEnv,
        highlightLanguage: 'bash',
        filename: '.env'
      }
    ] as CodeExample[],

    'install-package': [
      { language: 'JavaScript', framework: 'Next.js', code: 'npm install @stackframe/stack', highlightLanguage: 'bash', filename: 'Terminal' },
      reactRouterInstallExample,
      tanStackStartInstallExample,
      nuxtInstallExample,
      svelteKitInstallExample,
      nestJsInstallExample,
      { language: 'JavaScript', framework: 'React', code: 'npm install @stackframe/react', highlightLanguage: 'bash', filename: 'Terminal' },
      { language: 'JavaScript', framework: 'Express', code: 'npm install @stackframe/js', highlightLanguage: 'bash', filename: 'Terminal' },
      honoInstallExample,
      cloudflareWorkersInstallExample,
      { language: 'JavaScript', framework: 'Node.js', code: 'npm install @stackframe/js', highlightLanguage: 'bash', filename: 'Terminal' },
      { language: 'Python', framework: 'Django', code: 'pip install requests', highlightLanguage: 'bash', filename: 'Terminal' },
      { language: 'Python', framework: 'FastAPI', code: 'pip install requests', highlightLanguage: 'bash', filename: 'Terminal' },
      { language: 'Python', framework: 'Flask', code: 'pip install requests', highlightLanguage: 'bash', filename: 'Terminal' },
    ] as CodeExample[],

    'env-config': [
      {
        language: 'JavaScript',
        framework: 'Next.js',
        code: nextJsEnv,
        highlightLanguage: 'bash',
        filename: '.env.local'
      },
      {
        language: 'JavaScript',
        framework: 'React Router',
        code: viteEnv,
        highlightLanguage: 'bash',
        filename: '.env'
      },
      {
        language: 'JavaScript',
        framework: 'TanStack Start',
        code: viteEnv,
        highlightLanguage: 'bash',
        filename: '.env'
      },
      {
        language: 'JavaScript',
        framework: 'Nuxt',
        code: nuxtEnv,
        highlightLanguage: 'bash',
        filename: '.env'
      },
      {
        language: 'JavaScript',
        framework: 'SvelteKit',
        code: svelteKitEnv,
        highlightLanguage: 'bash',
        filename: '.env'
      },
      {
        language: 'JavaScript',
        framework: 'React',
        code: `# Store these in environment variables or directly in the client file during development
${viteEnv}`,
        highlightLanguage: 'bash',
        filename: '.env'
      },
      {
        language: 'JavaScript',
        framework: 'NestJS',
        code: rawServerEnv,
        highlightLanguage: 'bash',
        filename: '.env'
      },
      {
        language: 'JavaScript',
        framework: 'Express',
        code: rawServerEnv,
        highlightLanguage: 'bash',
        filename: '.env'
      },
      {
        language: 'JavaScript',
        framework: 'Hono',
        code: `# Add these as environment variables or runtime bindings
${rawServerEnv}`,
        highlightLanguage: 'bash',
        filename: '.env / runtime bindings'
      },
      {
        language: 'JavaScript',
        framework: 'Cloudflare Workers',
        code: `# Add these as Worker vars/secrets in wrangler or the Cloudflare dashboard
${rawServerEnv}`,
        highlightLanguage: 'bash',
        filename: 'wrangler.toml / dashboard'
      },
      {
        language: 'JavaScript',
        framework: 'Node.js',
        code: rawServerEnv,
        highlightLanguage: 'bash',
        filename: '.env'
      },
      {
        language: 'Python',
        framework: 'Django',
        code: `import os

stack_project_id = os.getenv("STACK_PROJECT_ID")
stack_publishable_client_key = os.getenv("STACK_PUBLISHABLE_CLIENT_KEY")
stack_secret_server_key = os.getenv("STACK_SECRET_SERVER_KEY")`,
        highlightLanguage: 'python',
        filename: 'settings.py'
      },
      {
        language: 'Python',        framework: 'FastAPI',
        code: `import os

stack_project_id = os.getenv("STACK_PROJECT_ID")
stack_publishable_client_key = os.getenv("STACK_PUBLISHABLE_CLIENT_KEY")
stack_secret_server_key = os.getenv("STACK_SECRET_SERVER_KEY")`,
        highlightLanguage: 'python',
        filename: 'main.py'
      },
      {
        language: 'Python',
        framework: 'Flask',
        code: `import os

stack_project_id = os.getenv("STACK_PROJECT_ID")
stack_publishable_client_key = os.getenv("STACK_PUBLISHABLE_CLIENT_KEY")
stack_secret_server_key = os.getenv("STACK_SECRET_SERVER_KEY")`,
        highlightLanguage: 'python',
        filename: 'app.py'
      }
    ] as CodeExample[],

    'stack-config': [
      {
        language: 'JavaScript',
        framework: 'Next.js',
        variant: 'server',
        code: `import "server-only";
import { StackServerApp } from "@stackframe/stack";

export const stackServerApp = new StackServerApp({
  tokenStore: "nextjs-cookie", // storing auth tokens in cookies
});`,
        highlightLanguage: 'typescript',
        filename: 'stack/server.ts'
      },
      {
        language: 'JavaScript',
        framework: 'Next.js',
        variant: 'client',
        code: `import { StackClientApp } from "@stackframe/stack";

export const stackClientApp = new StackClientApp({
  // Environment variables are automatically read
});`,
        highlightLanguage: 'typescript',
        filename: 'stack/client.ts'
      },
      {
        language: 'JavaScript',
        framework: 'React Router',
        code: `import { StackClientApp } from "@stackframe/react";
import { useNavigate } from "react-router-dom";

export const stackClientApp = new StackClientApp({
  projectId: import.meta.env.VITE_STACK_PROJECT_ID,
  publishableClientKey: import.meta.env.VITE_STACK_PUBLISHABLE_CLIENT_KEY,
  tokenStore: "cookie",
  redirectMethod: {
    useNavigate,
  },
});`,
        highlightLanguage: 'typescript',
        filename: 'src/stack/client.ts'
      },
      {
        language: 'JavaScript',
        framework: 'TanStack Start',
        code: `import { StackClientApp } from "@stackframe/react";
import { useNavigate } from "@tanstack/react-router";

export const stackClientApp = new StackClientApp({
  projectId: import.meta.env.VITE_STACK_PROJECT_ID,
  publishableClientKey: import.meta.env.VITE_STACK_PUBLISHABLE_CLIENT_KEY,
  tokenStore: "cookie",
  redirectMethod: {
    useNavigate,
  },
});`,
        highlightLanguage: 'typescript',
        filename: 'src/stack/client.ts'
      },
      {
        language: 'JavaScript',
        framework: 'Nuxt',
        variant: 'server',
        code: `import { StackServerApp } from "@stackframe/js";

export const stackServerApp = new StackServerApp({
  projectId: process.env.NUXT_PUBLIC_STACK_PROJECT_ID,
  publishableClientKey: process.env.NUXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY,
  secretServerKey: process.env.STACK_SECRET_SERVER_KEY,
  tokenStore: "memory",
});`,
        highlightLanguage: 'typescript',
        filename: 'server/utils/stack.ts'
      },
      {
        language: 'JavaScript',
        framework: 'Nuxt',
        variant: 'client',
        code: `import { StackClientApp } from "@stackframe/js";

export const stackClientApp = new StackClientApp({
  projectId: process.env.NUXT_PUBLIC_STACK_PROJECT_ID,
  publishableClientKey: process.env.NUXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY,
  tokenStore: "cookie",
});`,
        highlightLanguage: 'typescript',
        filename: 'app/utils/stack.ts'
      },
      {
        language: 'JavaScript',
        framework: 'SvelteKit',
        variant: 'server',
        code: `import { StackServerApp } from "@stackframe/js";
import { STACK_SECRET_SERVER_KEY } from "$env/static/private";
import { PUBLIC_STACK_PROJECT_ID, PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY } from "$env/static/public";

export const stackServerApp = new StackServerApp({
  projectId: PUBLIC_STACK_PROJECT_ID,
  publishableClientKey: PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY,
  secretServerKey: STACK_SECRET_SERVER_KEY,
  tokenStore: "memory",
});`,
        highlightLanguage: 'typescript',
        filename: 'src/lib/stack/server.ts'
      },
      {
        language: 'JavaScript',
        framework: 'SvelteKit',
        variant: 'client',
        code: `import { StackClientApp } from "@stackframe/js";
import { PUBLIC_STACK_PROJECT_ID, PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY } from "$env/static/public";

export const stackClientApp = new StackClientApp({
  projectId: PUBLIC_STACK_PROJECT_ID,
  publishableClientKey: PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY,
  tokenStore: "cookie",
});`,
        highlightLanguage: 'typescript',
        filename: 'src/lib/stack/client.ts'
      },
      {
        language: 'JavaScript',
        framework: 'React',
        code: `import { StackClientApp } from "@stackframe/react";
// If you use a router, uncomment the appropriate import and the redirectMethod below
// import { useNavigate } from "react-router-dom"; // React Router
// import { useNavigate } from "@tanstack/react-router"; // TanStack Router

export const stackClientApp = new StackClientApp({
  projectId: process.env.VITE_STACK_PROJECT_ID || "your-project-id",
  publishableClientKey: process.env.VITE_STACK_PUBLISHABLE_CLIENT_KEY || "your-publishable-client-key",
  tokenStore: "cookie",
  // redirectMethod: { useNavigate }, // Set this for non-Next.js frameworks
});`,
        highlightLanguage: 'typescript',
        filename: 'stack/client.ts'
      },
      {
        language: 'JavaScript',
        framework: 'NestJS',
        code: `import { StackServerApp } from "@stackframe/js";

export const stackServerApp = new StackServerApp({
  projectId: process.env.STACK_PROJECT_ID,
  publishableClientKey: process.env.STACK_PUBLISHABLE_CLIENT_KEY,
  secretServerKey: process.env.STACK_SECRET_SERVER_KEY,
  tokenStore: "memory",
});`,
        highlightLanguage: 'typescript',
        filename: 'src/stack/server.ts'
      },
      {
        language: 'JavaScript',
        framework: 'Express',
        variant: 'server',
        code: `import { StackServerApp } from "@stackframe/js";

export const stackServerApp = new StackServerApp({
  projectId: process.env.STACK_PROJECT_ID,
  publishableClientKey: process.env.STACK_PUBLISHABLE_CLIENT_KEY,
  secretServerKey: process.env.STACK_SECRET_SERVER_KEY,
  tokenStore: "memory",
});`,
        highlightLanguage: 'typescript',
        filename: 'stack/server.ts'
      },
      {
        language: 'JavaScript',
        framework: 'Express',
        variant: 'client',
        code: `import { StackClientApp } from "@stackframe/js";

export const stackClientApp = new StackClientApp({
  projectId: process.env.STACK_PROJECT_ID,
  publishableClientKey: process.env.STACK_PUBLISHABLE_CLIENT_KEY,
  tokenStore: "cookie",
});`,
        highlightLanguage: 'typescript',
        filename: 'stack/client.ts'
      },
      {
        language: 'JavaScript',
        framework: 'Hono',
        code: `import { StackServerApp } from "@stackframe/js";

export const stackServerApp = new StackServerApp({
  projectId: process.env.STACK_PROJECT_ID,
  publishableClientKey: process.env.STACK_PUBLISHABLE_CLIENT_KEY,
  secretServerKey: process.env.STACK_SECRET_SERVER_KEY,
  tokenStore: "memory",
});`,
        highlightLanguage: 'typescript',
        filename: 'src/stack/server.ts'
      },
      {
        language: 'JavaScript',
        framework: 'Cloudflare Workers',
        code: `import { StackServerApp } from "@stackframe/js";

export function createStackServerApp(env: Env) {
  return new StackServerApp({
    projectId: env.STACK_PROJECT_ID,
    publishableClientKey: env.STACK_PUBLISHABLE_CLIENT_KEY,
    secretServerKey: env.STACK_SECRET_SERVER_KEY,
    tokenStore: "memory",
  });
}`,
        highlightLanguage: 'typescript',
        filename: 'src/stack/server.ts'
      },
      {
        language: 'JavaScript',
        framework: 'Node.js',
        variant: 'server',
        code: `import { StackServerApp } from "@stackframe/js";

export const stackServerApp = new StackServerApp({
  projectId: process.env.STACK_PROJECT_ID,
  publishableClientKey: process.env.STACK_PUBLISHABLE_CLIENT_KEY,
  secretServerKey: process.env.STACK_SECRET_SERVER_KEY,
  tokenStore: "memory",
});`,
        highlightLanguage: 'javascript',
        filename: 'stack/server.js'
      },
      {
        language: 'JavaScript',
        framework: 'Node.js',
        variant: 'client',
        code: `import { StackClientApp } from "@stackframe/js";

export const stackClientApp = new StackClientApp({
  projectId: process.env.STACK_PROJECT_ID,
  publishableClientKey: process.env.STACK_PUBLISHABLE_CLIENT_KEY,
  tokenStore: "cookie",
});`,
        highlightLanguage: 'javascript',
        filename: 'stack/client.js'
      },
      {
        language: 'Python',
        framework: 'Django',
        code: `import requests

def stack_auth_request(method, endpoint, **kwargs):
    res = requests.request(
        method,
        f'https://api.stack-auth.com/{endpoint}',
        headers={
            'x-stack-access-type': 'server',  # or 'client' if you're only accessing the client API
            'x-stack-project-id': stack_project_id,
            'x-stack-publishable-client-key': stack_publishable_client_key,
            'x-stack-secret-server-key': stack_secret_server_key,  # not necessary if access type is 'client'
            **kwargs.pop('headers', {}),
        },
        **kwargs,
    )
    if res.status_code >= 400:
        raise Exception(f"Stack Auth API request failed with {res.status_code}: {res.text}")
    return res.json()`,
        highlightLanguage: 'python',
        filename: 'views.py'
      },
      {
        language: 'Python',
        framework: 'FastAPI',
        code: `import requests

def stack_auth_request(method, endpoint, **kwargs):
    res = requests.request(
        method,
        f'https://api.stack-auth.com/{endpoint}',
        headers={
            'x-stack-access-type': 'server',  # or 'client' if you're only accessing the client API
            'x-stack-project-id': stack_project_id,
            'x-stack-publishable-client-key': stack_publishable_client_key,
            'x-stack-secret-server-key': stack_secret_server_key,  # not necessary if access type is 'client'
            **kwargs.pop('headers', {}),
        },
        **kwargs,
    )
    if res.status_code >= 400:
        raise Exception(f"Stack Auth API request failed with {res.status_code}: {res.text}")
    return res.json()`,
        highlightLanguage: 'python',
        filename: 'main.py'
      },
      {
        language: 'Python',
        framework: 'Flask',
        code: `import requests

def stack_auth_request(method, endpoint, **kwargs):
    res = requests.request(
        method,
        f'https://api.stack-auth.com/{endpoint}',
        headers={
            'x-stack-access-type': 'server',  # or 'client' if you're only accessing the client API
            'x-stack-project-id': stack_project_id,
            'x-stack-publishable-client-key': stack_publishable_client_key,
            'x-stack-secret-server-key': stack_secret_server_key,  # not necessary if access type is 'client'
            **kwargs.pop('headers', {}),
        },
        **kwargs,
    )
    if res.status_code >= 400:
        raise Exception(f"Stack Auth API request failed with {res.status_code}: {res.text}")
    return res.json()`,
        highlightLanguage: 'python',
        filename: 'app.py'
      }
    ] as CodeExample[],

    'auth-handlers': [
      {
        language: 'JavaScript',
        framework: 'Next.js',
        code: `import { StackHandler } from "@stackframe/stack";
import { stackServerApp } from "@/stack/server";

export default function Handler(props: unknown) {
  return <StackHandler fullPage app={stackServerApp} routeProps={props} />;
}`,
        highlightLanguage: 'typescript',
        filename: 'app/handler/[...stack]/page.tsx'
      },
      {
        language: 'JavaScript',
        framework: 'React Router',
        code: `import { StackHandler, StackProvider, StackTheme } from "@stackframe/react";
import { Suspense } from "react";
import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom";
import { stackClientApp } from "./stack/client";

function HandlerRoutes() {
  const location = useLocation();
  return <StackHandler app={stackClientApp} location={location.pathname} fullPage />;
}

export default function App() {
  return (
    <Suspense fallback={null}>
      <BrowserRouter>
        <StackProvider app={stackClientApp}>
          <StackTheme>
            <Routes>
              <Route path="/handler/*" element={<HandlerRoutes />} />
              <Route path="/" element={<div>hello world</div>} />
            </Routes>
          </StackTheme>
        </StackProvider>
      </BrowserRouter>
    </Suspense>
  );
}`,
        highlightLanguage: 'typescript',
        filename: 'src/App.tsx'
      },
      {
        language: 'JavaScript',
        framework: 'TanStack Start',
        code: `import { StackHandler } from "@stackframe/react";
import { createFileRoute, useRouterState } from "@tanstack/react-router";
import { stackClientApp } from "../stack/client";

export const Route = createFileRoute("/handler/$")({
  component: HandlerRoute,
});

function HandlerRoute() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return <StackHandler app={stackClientApp} location={pathname} fullPage />;
}`,
        highlightLanguage: 'typescript',
        filename: 'src/routes/handler.$.tsx'
      },
      {
        language: 'JavaScript',
        framework: 'React',
        code: `import { StackHandler, StackProvider, StackTheme } from "@stackframe/react";
import { Suspense } from "react";
import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom";
import { stackClientApp } from "./stack/client";

function HandlerRoutes() {
  const location = useLocation();
  return (
    <StackHandler app={stackClientApp} location={location.pathname} fullPage />
  );
}

export default function App() {
  return (
    <Suspense fallback={null}>
      <BrowserRouter>
        <StackProvider app={stackClientApp}>
          <StackTheme>
            <Routes>
              <Route path="/handler/*" element={<HandlerRoutes />} />
              <Route path="/" element={<div>hello world</div>} />
            </Routes>
          </StackTheme>
        </StackProvider>
      </BrowserRouter>
    </Suspense>
  );
}`,
        highlightLanguage: 'typescript',
        filename: 'App.tsx'
      },
      noteExample('Nuxt', `// Nuxt does not use StackHandler today.
// Create your own pages or API routes and call stackClientApp / stackServerApp directly.`),
      noteExample('SvelteKit', `// SvelteKit does not use StackHandler today.
// Use your own +page.svelte or +server.ts files and call stackClientApp / stackServerApp directly.`),
      noteExample('NestJS', `// NestJS is a server framework.
// Pair it with your frontend of choice and authenticate requests with tokenStoreFromHeaders(req.headers).`),
      noteExample('Express', `// Express does not use built-in Stack handlers.
// Pair it with your frontend of choice and authenticate requests with tokenStoreFromHeaders(req.headers).`),
      noteExample('Hono', `// Hono does not use built-in Stack handlers.
// Use c.req.raw as the tokenStore in request handlers.`),
      noteExample('Cloudflare Workers', `// Cloudflare Workers do not use StackHandler.
// Pass the incoming Request object directly as tokenStore in your fetch handler.`),
      {
        language: 'JavaScript',
        framework: 'Node.js',
        code: `// Node.js doesn't use built-in handlers
// Use the REST API or integrate with your frontend`,
        highlightLanguage: 'javascript',
        filename: 'Note'
      }
    ] as CodeExample[],

    'app-providers': [
      {
        language: 'JavaScript',
        framework: 'Next.js',
        code: `import React from "react";
import { StackProvider, StackTheme } from "@stackframe/stack";
import { stackServerApp } from "@/stack/server";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <StackProvider app={stackServerApp}>
          <StackTheme>
            {children}
          </StackTheme>
        </StackProvider>
      </body>
    </html>
  );
}`,
        highlightLanguage: 'typescript',
        filename: 'app/layout.tsx'
      },
      noteExample('React Router', `// Already shown in the App.tsx example above.
// Wrap your router tree with StackProvider and StackTheme.`),
      noteExample('TanStack Start', `// Wrap your root route with StackProvider and StackTheme.
// Keep StackProvider above any components that call useUser(), useStackApp(), or useAnalytics().`),
      {
        language: 'JavaScript',
        framework: 'React',
        code: `// Already shown in the App.tsx example above
// Make sure to wrap your app with StackProvider and StackTheme`,
        highlightLanguage: 'typescript',
        filename: 'Note'
      },
      noteExample('Nuxt', `// @stackframe/js does not require a StackProvider.
// Import and use stackClientApp / stackServerApp directly in your pages, composables, or routes.`),
      noteExample('SvelteKit', `// @stackframe/js does not require a StackProvider.
// Import and use stackClientApp / stackServerApp directly in your load functions and routes.`),
      noteExample('NestJS', `// NestJS is server-only here, so no StackProvider is required.`),
      noteExample('Express', `// Express is server-only here, so no StackProvider is required.`),
      noteExample('Hono', `// Hono is server-only here, so no StackProvider is required.`),
      noteExample('Cloudflare Workers', `// Cloudflare Workers are server-only here, so no StackProvider is required.`),
    ] as CodeExample[],

    'loading-boundary': [
      {
        language: 'JavaScript',
        framework: 'Next.js',
        code: `export default function Loading() {
  // You can use any loading indicator here
  return <>
    Loading...
  </>;
}`,
        highlightLanguage: 'typescript',
        filename: 'app/loading.tsx'
      },
      noteExample('React Router', `// Use your router's normal loading UI. Stack does not require a special loading file here.`),
      noteExample('TanStack Start', `// Use your route pending components as usual. No Stack-specific loading file is required.`),
      noteExample('Nuxt', `// Nuxt does not require a Stack-specific loading boundary for @stackframe/js.`),
      noteExample('SvelteKit', `// SvelteKit does not require a Stack-specific loading boundary for @stackframe/js.`),
      noteExample('NestJS', `// NestJS does not need a loading boundary.`),
      noteExample('Express', `// Express does not need a loading boundary.`),
      noteExample('Hono', `// Hono does not need a loading boundary.`),
      noteExample('Cloudflare Workers', `// Cloudflare Workers do not need a loading boundary.`),
    ] as CodeExample[],

    'suspense-boundary': [
      noteExample('Next.js', `// Next.js uses app/loading.tsx instead of a separate Suspense wrapper for Stack setup.`),
      noteExample('React Router', `import { Suspense } from "react";
import { StackProvider } from "@stackframe/react";
import { stackClientApp } from "./stack/client";

export default function App() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <StackProvider app={stackClientApp}>
        {/* Your app content */}
      </StackProvider>
    </Suspense>
  );
}`),
      noteExample('TanStack Start', `import { Suspense } from "react";
import { StackProvider } from "@stackframe/react";
import { stackClientApp } from "./stack/client";

export function Root({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <StackProvider app={stackClientApp}>{children}</StackProvider>
    </Suspense>
  );
}`),
      {
        language: 'JavaScript',
        framework: 'React',
        code: `import { Suspense } from "react";
import { StackProvider } from "@stackframe/react";
import { stackClientApp } from "./stack/client";

export default function App() {
  return (
    // Wrap your StackProvider with Suspense for async hooks to work
    <Suspense fallback={<div>Loading...</div>}>
      <StackProvider app={stackClientApp}>
        {/* Your app content */}
      </StackProvider>
    </Suspense>
  );
}`,
        highlightLanguage: 'typescript',
        filename: 'App.tsx'
      },
      noteExample('Nuxt', `// Nuxt does not require a React Suspense boundary.`),
      noteExample('SvelteKit', `// SvelteKit does not require a React Suspense boundary.`),
      noteExample('NestJS', `// NestJS does not require a React Suspense boundary.`),
      noteExample('Express', `// Express does not require a React Suspense boundary.`),
      noteExample('Hono', `// Hono does not require a React Suspense boundary.`),
      noteExample('Cloudflare Workers', `// Cloudflare Workers do not require a React Suspense boundary.`),
    ] as CodeExample[],

    'test-setup': [
      {
        language: 'JavaScript',
        framework: 'Next.js',
        code: `# Start your Next.js app
npm run dev

# Navigate to the sign-up page
# http://localhost:3000/handler/sign-up`,
        highlightLanguage: 'bash',
        filename: 'Terminal'
      },
      {
        language: 'JavaScript',
        framework: 'React Router',
        code: `# Start your React Router app
npm run dev

# Navigate to the sign-up page
# http://localhost:5173/handler/sign-up`,
        highlightLanguage: 'bash',
        filename: 'Terminal'
      },
      {
        language: 'JavaScript',
        framework: 'TanStack Start',
        code: `# Start your TanStack Start app
npm run dev

# Navigate to the sign-up page route you mounted
# Example: http://localhost:3000/handler/sign-up`,
        highlightLanguage: 'bash',
        filename: 'Terminal'
      },
      {
        language: 'JavaScript',
        framework: 'React',
        code: `# Start your React app
npm run dev

# Navigate to the sign-up page
# http://localhost:5173/handler/sign-up`,
        highlightLanguage: 'bash',
        filename: 'Terminal'
      },
      {
        language: 'JavaScript',
        framework: 'Nuxt',
        code: `# Start your Nuxt app
npm run dev

# Visit your own pages or API routes that call stackClientApp / stackServerApp`,
        highlightLanguage: 'bash',
        filename: 'Terminal'
      },
      {
        language: 'JavaScript',
        framework: 'SvelteKit',
        code: `# Start your SvelteKit app
npm run dev

# Visit your own pages or endpoints that call stackClientApp / stackServerApp`,
        highlightLanguage: 'bash',
        filename: 'Terminal'
      },
      {
        language: 'JavaScript',
        framework: 'NestJS',
        code: `# Start your NestJS server
npm run start:dev

# Verify a controller can call stackServerApp.getUser() or stackServerApp.track()`,
        highlightLanguage: 'bash',
        filename: 'Terminal'
      },
      {
        language: 'JavaScript',
        framework: 'Express',
        code: `# Start your Express server
npm start

# Verify one route can call stackServerApp.getUser() or stackServerApp.track()`,
        highlightLanguage: 'bash',
        filename: 'Terminal'
      },
      {
        language: 'JavaScript',
        framework: 'Hono',
        code: `# Start your Hono server
npm run dev

# Verify one handler can call stackServerApp.getUser({ tokenStore: c.req.raw })`,
        highlightLanguage: 'bash',
        filename: 'Terminal'
      },
      {
        language: 'JavaScript',
        framework: 'Cloudflare Workers',
        code: `# Start your Worker locally
npm run dev

# Verify one fetch handler can call stackServerApp.getUser({ tokenStore: request })`,
        highlightLanguage: 'bash',
        filename: 'Terminal'
      },
      {
        language: 'JavaScript',
        framework: 'Node.js',
        code: `# Start your Node.js app
node index.js

# Use the REST API or integrate with your frontend
# Check the REST API documentation for endpoints`,
        highlightLanguage: 'bash',
        filename: 'Terminal'
      },
      {
        language: 'Python',
        framework: 'Django',
        code: `# Test the Stack Auth API connection
print(stack_auth_request('GET', '/api/v1/projects/current'))

# Start your Django server
python manage.py runserver`,
        highlightLanguage: 'python',
        filename: 'Terminal'
      },
      {
        language: 'Python',
        framework: 'FastAPI',
        code: `# Test the Stack Auth API connection
print(stack_auth_request('GET', '/api/v1/projects/current'))

# Start your FastAPI server
uvicorn main:app --reload`,
        highlightLanguage: 'python',
        filename: 'Terminal'
      },
      {
        language: 'Python',
        framework: 'Flask',
        code: `# Test the Stack Auth API connection
print(stack_auth_request('GET', '/api/v1/projects/current'))

# Start your Flask server
flask run`,
        highlightLanguage: 'python',
        filename: 'Terminal'
      }
    ] as CodeExample[],

    'basic-usage': [
      {
        language: 'JavaScript',
        framework: 'Next.js',
        variant: 'server',
        code: `import { stackServerApp } from "@/stack/server";

// In a Server Component or API route
const user = await stackServerApp.getUser();
await stackServerApp.track("page.viewed", { surface: "server-component" });
if (user) {
  console.log("User is signed in:", user.displayName);
} else {
  console.log("User is not signed in");
}`,
        highlightLanguage: 'typescript',
        filename: 'Server Component'
      },
      {
        language: 'JavaScript',
        framework: 'Next.js',
        variant: 'client',
        code: `'use client';
import { useAnalytics, useUser } from "@stackframe/stack";

export default function MyComponent() {
  const user = useUser();
  const { track } = useAnalytics();
  
  if (user) {
    return <button onClick={() => track("profile.viewed", { surface: "client-component" })}>Hello, {user.displayName}!</button>;
  } else {
    return <div>Please sign in</div>;
  }
}`,
        highlightLanguage: 'typescript',
        filename: 'Client Component'
      },
      {
        language: 'JavaScript',
        framework: 'React Router',
        code: `import { useAnalytics, useUser } from "@stackframe/react";

export default function Dashboard() {
  const user = useUser();
  const { track } = useAnalytics();

  if (!user) {
    return <div>Please sign in</div>;
  }

  return (
    <button onClick={() => track("dashboard.viewed", { framework: "react-router" })}>
      Hello, {user.displayName}!
    </button>
  );
}`,
        highlightLanguage: 'typescript',
        filename: 'src/routes/index.tsx'
      },
      {
        language: 'JavaScript',
        framework: 'TanStack Start',
        code: `import { useAnalytics, useUser } from "@stackframe/react";

export default function HomeRoute() {
  const user = useUser();
  const { track } = useAnalytics();

  if (!user) {
    return <div>Please sign in</div>;
  }

  return (
    <button onClick={() => track("dashboard.viewed", { framework: "tanstack-start" })}>
      Hello, {user.displayName}!
    </button>
  );
}`,
        highlightLanguage: 'typescript',
        filename: 'src/routes/index.tsx'
      },
      {
        language: 'JavaScript',
        framework: 'React',
        code: `import { useAnalytics, useUser } from "@stackframe/react";

export default function MyComponent() {
  const user = useUser();
  const { track } = useAnalytics();
  
  if (user) {
    return <button onClick={() => track("profile.viewed", { framework: "react" })}>Hello, {user.displayName}!</button>;
  } else {
    return <div>Please sign in</div>;
  }
}`,
        highlightLanguage: 'typescript',
        filename: 'Component'
      },
      {
        language: 'JavaScript',
        framework: 'Nuxt',
        code: `import { tokenStoreFromHeaders } from "@stackframe/js";
import { stackServerApp } from "~/server/utils/stack";

export default defineEventHandler(async (event) => {
  const tokenStore = tokenStoreFromHeaders(event.node.req.headers);
  const user = await stackServerApp.getUser({ tokenStore });
  await stackServerApp.track("profile.viewed", { framework: "nuxt" }, { tokenStore });

  return { userId: user?.id ?? null };
});`,
        highlightLanguage: 'typescript',
        filename: 'server/api/profile.get.ts'
      },
      {
        language: 'JavaScript',
        framework: 'SvelteKit',
        code: `import { stackServerApp } from "$lib/stack/server";

export async function load({ request }) {
  const user = await stackServerApp.getUser({ tokenStore: request });
  await stackServerApp.track("profile.viewed", { framework: "sveltekit" }, { tokenStore: request });

  return { userId: user?.id ?? null };
}`,
        highlightLanguage: 'typescript',
        filename: 'src/routes/+page.server.ts'
      },
      {
        language: 'JavaScript',
        framework: 'NestJS',
        code: `import { Controller, Get, Req } from "@nestjs/common";
import { tokenStoreFromHeaders } from "@stackframe/js";
import { stackServerApp } from "./stack/server";

@Controller("profile")
export class ProfileController {
  @Get()
  async read(@Req() req: { headers: Record<string, string | string[] | undefined> }) {
    const tokenStore = tokenStoreFromHeaders(req.headers);
    const user = await stackServerApp.getUser({ tokenStore });
    await stackServerApp.track("profile.viewed", { framework: "nestjs" }, { tokenStore });
    return { userId: user?.id ?? null };
  }
}`,
        highlightLanguage: 'typescript',
        filename: 'src/profile.controller.ts'
      },
      {
        language: 'JavaScript',
        framework: 'Express',
        code: `import { tokenStoreFromHeaders } from "@stackframe/js";
import { stackServerApp } from "./stack/server.js";

app.get('/profile', async (req, res) => {
  try {
    const tokenStore = tokenStoreFromHeaders(req.headers);
    const user = await stackServerApp.getUser({ tokenStore });
    await stackServerApp.track("profile.viewed", { framework: "express" }, { tokenStore });
    
    if (user) {
      res.json({ message: \`Hello, \${user.displayName}!\`, userId: user.id });
    } else {
      res.status(401).json({ error: 'Not authenticated' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});`,
        highlightLanguage: 'typescript',
        filename: 'server.ts'
      },
      {
        language: 'JavaScript',
        framework: 'Hono',
        code: `import { stackServerApp } from "./stack/server";

app.get("/profile", async (c) => {
  const user = await stackServerApp.getUser({ tokenStore: c.req.raw });
  await stackServerApp.track("profile.viewed", { framework: "hono" }, { tokenStore: c.req.raw });
  return c.json({ userId: user?.id ?? null });
});`,
        highlightLanguage: 'typescript',
        filename: 'src/index.ts'
      },
      {
        language: 'JavaScript',
        framework: 'Cloudflare Workers',
        code: `import { createStackServerApp } from "./stack/server";

export default {
  async fetch(request: Request, env: Env) {
    const stackServerApp = createStackServerApp(env);
    const user = await stackServerApp.getUser({ tokenStore: request });
    await stackServerApp.track("profile.viewed", { framework: "cloudflare-workers" }, { tokenStore: request });
    return Response.json({ userId: user?.id ?? null });
  },
};`,
        highlightLanguage: 'typescript',
        filename: 'src/index.ts'
      },
      {
        language: 'JavaScript',
        framework: 'Node.js',
        code: `import { stackServerApp } from "./stack/server.js";

async function checkUser(accessToken) {
  try {
    const user = await stackServerApp.getUser({ accessToken });
    
    if (user) {
      console.log(\`Hello, \${user.displayName}!\`);
    } else {
      console.log('User not authenticated');
    }
  } catch (error) {
    console.error('Error:', error);
  }
}`,
        highlightLanguage: 'javascript',
        filename: 'index.js'
      },
      {
        language: 'Python',
        framework: 'Django',
        code: `# In your views.py
def profile_view(request):
    # Get access token from request headers
    access_token = request.headers.get('X-Stack-Access-Token')
    
    try:
        user_data = stack_auth_request('GET', '/api/v1/users/me', headers={
            'x-stack-access-token': access_token,
        })
        return JsonResponse({'message': f"Hello, {user_data['displayName']}!"})
    except Exception as e:
        return JsonResponse({'error': 'Not authenticated'}, status=401)`,
        highlightLanguage: 'python',
        filename: 'views.py'
      },
      {
        language: 'Python',
        framework: 'FastAPI',
        code: `from fastapi import FastAPI, Header, HTTPException

app = FastAPI()

@app.get("/profile")
async def get_profile(x_stack_access_token: str = Header(None)):
    if not x_stack_access_token:
        raise HTTPException(status_code=401, detail="Access token required")
    
    try:
        user_data = stack_auth_request('GET', '/api/v1/users/me', headers={
            'x-stack-access-token': x_stack_access_token,
        })
        return {"message": f"Hello, {user_data['displayName']}!"}
    except Exception as e:
        raise HTTPException(status_code=401, detail="Not authenticated")`,
        highlightLanguage: 'python',
        filename: 'main.py'
      },
      {
        language: 'Python',
        framework: 'Flask',
        code: `from flask import Flask, request, jsonify

app = Flask(__name__)

@app.route('/profile')
def profile():
    access_token = request.headers.get('X-Stack-Access-Token')
    
    if not access_token:
        return jsonify({'error': 'Access token required'}), 401
    
    try:
        user_data = stack_auth_request('GET', '/api/v1/users/me', headers={
    'x-stack-access-token': access_token,
        })
        return jsonify({'message': f"Hello, {user_data['displayName']}!"})
    except Exception as e:
        return jsonify({'error': 'Not authenticated'}), 401`,
        highlightLanguage: 'python',
        filename: 'app.py'
      }
    ] as CodeExample[]
  }
};
