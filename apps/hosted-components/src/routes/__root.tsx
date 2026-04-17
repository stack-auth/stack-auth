/// <reference types="vite/client" />
import { StackClientApp, StackProvider, StackTheme } from '@stackframe/react';
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
  useNavigate
} from '@tanstack/react-router';
import type { ErrorInfo, ReactNode } from 'react';
import { Component, useEffect, useMemo, useState } from 'react';


export function getProjectId(): string | null {
  // Extract from subdomain: <projectId>.built-with-stack-auth.com
  // Also works with <projectId>.localhost for local dev
  const hostname = window.location.hostname;
  const parts = hostname.split('.');
  if (parts.length >= 2) {
    return parts[0];
  }

  return null;
}

function FullPageError({ title, message }: { title: string, message: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
      <div style={{ textAlign: 'center', maxWidth: 480, padding: 24 }}>
        <h1 style={{ fontSize: 24, marginBottom: 8 }}>{title}</h1>
        <p style={{ color: '#666' }}>{message}</p>
      </div>
    </div>
  );
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Hosted components error:', error, errorInfo);
  }

  render() {
    if (this.state.error) {
      return <FullPageError title="Something went wrong" message={this.state.error.message} />;
    }

    return this.props.children;
  }
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
    ],
  }),
  shellComponent: RootDocument,
  component: RootComponent,
});

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html>
      <head>
        <HeadContent />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body style={{ fontFamily: "'Inter', sans-serif", margin: 0 }}>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const [projectId, setProjectId] = useState<string | null | undefined>("internal");

  useEffect(() => {
    setProjectId(getProjectId());
  }, []);

  const isValidProjectId = projectId ? (projectId === "internal" || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectId)) : false;

  const stackApp = useMemo(() => {
    if (!projectId || !isValidProjectId) return null;
    return new StackClientApp({
      projectId,
      tokenStore: "cookie",
      baseUrl: import.meta.env.VITE_STACK_API_URL || undefined,
      urls: {
        handler: "/handler",
        signIn: "/handler/sign-in",
        signUp: "/handler/sign-up",
        afterSignIn: "/",
        afterSignUp: "/",
        afterSignOut: "/handler/sign-in",
      },
      redirectMethod: { useNavigate: useNavigate as any }
    });
  }, [projectId]);

  if (projectId === undefined) {
    return <></>;
  }

  if (!projectId) {
    return <FullPageError title="Invalid URL" message={`Could not determine project ID from subdomain. Visit <projectId>.${window.location.host}.`} />;
  }

  if (!isValidProjectId) {
    return <FullPageError title="Something went wrong" message={`Invalid project ID: ${projectId}. Project IDs must be UUIDs.`} />;
  }

  return (
    <ErrorBoundary>
      <StackProvider app={stackApp!}>
        <StackTheme>
          <Outlet />
        </StackTheme>
      </StackProvider>
    </ErrorBoundary>
  );
}

