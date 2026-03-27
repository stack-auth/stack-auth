"use client";

import React, { Suspense, useMemo, useState } from "react";
import { TooltipProvider } from "@stackframe/stack-ui";
import { CATALOG_NAMES, COMPONENT_CATALOG } from "../component-catalog";
import { DevToolComponentPreviewProvider } from "../hooks/use-component-registry";
import { useStackApp } from "../../lib/hooks";
import type { HandlerUrls } from "../../lib/stack-app/common";

// IF_PLATFORM react-like

/**
 * Pages that should appear in the "Pages" section of the left sidebar.
 * Maps HandlerUrls keys to display labels.
 */
const PAGE_ENTRIES: { key: keyof HandlerUrls; label: string }[] = [
  { key: "signIn", label: "Sign-in" },
  { key: "signUp", label: "Sign-up" },
  { key: "forgotPassword", label: "Forgot password" },
  { key: "passwordReset", label: "Password reset" },
  { key: "emailVerification", label: "Email verification" },
  { key: "accountSettings", label: "Account settings" },
  { key: "teamInvitation", label: "Team invitation" },
  { key: "mfa", label: "MFA" },
  { key: "onboarding", label: "Onboarding" },
  { key: "error", label: "Error" },
];

/**
 * Components that are page-level (rendered full-screen via StackHandler).
 * These are shown in the Pages section, not the Components section.
 */
const PAGE_COMPONENT_NAMES = new Set([
  "AccountSettings",
  "AuthPage",
  "EmailVerification",
  "ForgotPassword",
  "PasswordReset",
  "SignIn",
  "SignUp",
]);

function isHostedUrl(url: string, handlerBase: string): boolean {
  return url === handlerBase || url.startsWith(handlerBase + "/");
}

type PageInfo = {
  key: keyof HandlerUrls;
  label: string;
  url: string;
  hosted: boolean;
};

function sanitizeForPreview(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (typeof value === "function") {
    return async () => {};
  }
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value !== "object") {
    return value;
  }
  if (React.isValidElement(value)) {
    return value;
  }
  if (value instanceof Date) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForPreview(item, seen));
  }
  if (seen.has(value)) {
    return value;
  }
  seen.add(value);
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === "children") {
      continue;
    }
    result[key] = sanitizeForPreview(entry, seen);
  }
  return result;
}

function sanitizeForPrompt(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === "function") {
    return "[function]";
  }
  if (typeof value !== "object") {
    return value;
  }
  if (React.isValidElement(value)) {
    return "[ReactElement]";
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForPrompt(item, seen));
  }
  if (seen.has(value)) {
    return "[Circular]";
  }
  seen.add(value);
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === "children") {
      continue;
    }
    result[key] = sanitizeForPrompt(entry, seen);
  }
  return result;
}

function formatJsxPropValue(value: unknown): string | null {
  if (value === undefined) {
    return null;
  }
  if (value === null) {
    return "{null}";
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return `{${String(value)}}`;
  }
  if (Array.isArray(value) || typeof value === "object") {
    return `{${JSON.stringify(value, null, 2)}}`;
  }
  return null;
}

function formatJsxSnippet(name: string, propsSnapshot: Record<string, unknown>): string {
  const propLines = Object.entries(sanitizeForPrompt(propsSnapshot) as Record<string, unknown>)
    .map(([key, value]) => {
      const formatted = formatJsxPropValue(value);
      if (formatted === null) {
        return null;
      }
      return `  ${key}=${formatted}`;
    })
    .filter((line): line is string => line !== null);

  if (propLines.length === 0) {
    return `<${name} />`;
  }

  return [
    `<${name}`,
    ...propLines,
    `/>`,
  ].join("\n");
}

function getBuiltInPrompt(name: string, propsSnapshot: Record<string, unknown>): string {
  const entry = COMPONENT_CATALOG[name];
  const promptLines = [
    `Implement the Stack Auth \`${name}\` component shown in the dev tool preview.`,
    "",
    "Requirements:",
    "- Use the project's existing Stack Auth provider/setup.",
    "- Import the component from the same Stack Auth SDK package this app already uses, for example `@stackframe/react` or `@stackframe/stack`.",
    "- Prefer the built-in Stack Auth component instead of reimplementing the auth flow manually.",
  ];

  for (const note of entry.promptNotes ?? []) {
    promptLines.push(`- ${note}`);
  }

  promptLines.push(
    "",
    "Start from this JSX usage:",
    "```tsx",
    `import { ${name} } from "@stackframe/react";`,
    "",
    formatJsxSnippet(name, propsSnapshot),
    "```"
  );

  const sanitized = sanitizeForPrompt(propsSnapshot) as Record<string, unknown>;
  if (Object.keys(sanitized).length > 0) {
    promptLines.push(
      "",
      "Current prop snapshot from the dev tool:",
      "```json",
      JSON.stringify(sanitized, null, 2),
      "```"
    );
  }

  return promptLines.join("\n");
}

function getImplementationPrompt(name: string, propsSnapshot: Record<string, unknown>): string {
  if (name in COMPONENT_CATALOG) {
    return getBuiltInPrompt(name, propsSnapshot);
  }
  return "";
}

type PreviewErrorBoundaryState = { error: Error | null };

class PreviewErrorBoundary extends React.Component<
  { children: React.ReactNode },
  PreviewErrorBoundaryState
> {
  state: PreviewErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): PreviewErrorBoundaryState {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="sdt-preview-error">
          Preview could not render this component ({this.state.error.message}). It may require auth,
          navigation, or async data that is not available in the panel.
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * Renders a live preview of a catalog component.
 */
function DevToolComponentPreview({ name }: { name: string }) {
  if (!Object.prototype.hasOwnProperty.call(COMPONENT_CATALOG, name)) {
    return <div className="sdt-preview-unavailable">Unknown component: {name}</div>;
  }
  const entry = COMPONENT_CATALOG[name];

  if (entry.preview === 'none') {
    return (
      <div className="sdt-preview-unavailable">
        Live preview is not available for {name}.
      </div>
    );
  }

  const content = entry.preview
    ? entry.preview({})
    : React.createElement(entry.component, {});

  return (
    <PreviewErrorBoundary>
      <Suspense fallback={<div className="sdt-preview-loading">Loading preview…</div>}>
        <TooltipProvider>
          <DevToolComponentPreviewProvider>{content}</DevToolComponentPreviewProvider>
        </TooltipProvider>
      </Suspense>
    </PreviewErrorBoundary>
  );
}

function ComponentPreviewHeader(props: {
  name: string;
}) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const prompt = getImplementationPrompt(props.name, {});

  if (!prompt) return null;

  return (
    <div className="sdt-component-preview-header">
      <div className="sdt-component-preview-label">Preview</div>
      <button
        className="sdt-secondary-btn"
        type="button"
        onClick={() => {
          navigator.clipboard.writeText(prompt).then(() => {
            setCopyState("copied");
            window.setTimeout(() => setCopyState("idle"), 1500);
          }, () => {
            setCopyState("error");
            window.setTimeout(() => setCopyState("idle"), 2000);
          });
        }}
        title="Copy an implementation prompt for this component"
      >
        {copyState === "copied" ? "Copied" : copyState === "error" ? "Copy failed" : "Copy prompt"}
      </button>
    </div>
  );
}

function ComponentDetail({ name }: { name: string }) {
  return (
    <div className="sdt-component-detail">
      <h3>&lt;{name} /&gt;</h3>

      <ComponentPreviewHeader name={name} />
      <div className="sdt-component-preview-frame">
        <DevToolComponentPreview name={name} />
      </div>
    </div>
  );
}

function PageDetail({ page }: { page: PageInfo }) {
  const fullUrl = typeof window !== "undefined"
    ? new URL(page.url, window.location.origin).toString()
    : page.url;

  return (
    <div className="sdt-component-detail">
      <h3>{page.label}</h3>
      <div className="sdt-component-detail-sub">
        <span className={`sdt-badge ${page.hosted ? "sdt-badge-info" : "sdt-badge-success"}`}>
          {page.hosted ? "Hosted" : "Custom"}
        </span>
        <span style={{ marginLeft: 8, fontFamily: "var(--sdt-font-mono)", fontSize: 12 }}>{page.url}</span>
      </div>
      <div className="sdt-page-iframe-frame">
        <iframe
          src={fullUrl}
          title={page.label}
          className="sdt-page-iframe"
        />
      </div>
    </div>
  );
}

type Selection =
  | { type: "page"; key: keyof HandlerUrls }
  | { type: "component"; name: string };

export function ComponentsTab() {
  const app = useStackApp();
  const urls = app.urls;
  const handlerBase = urls.handler;
  const [selection, setSelection] = useState<Selection | null>(null);

  const pages = useMemo<PageInfo[]>(() =>
    PAGE_ENTRIES.map((entry) => ({
      key: entry.key,
      label: entry.label,
      url: urls[entry.key],
      hosted: isHostedUrl(urls[entry.key], handlerBase),
    })),
    [urls, handlerBase]
  );

  const componentNames = useMemo(
    () => CATALOG_NAMES.filter((name) => !PAGE_COMPONENT_NAMES.has(name)),
    []
  );

  const selectedPage = selection?.type === "page"
    ? pages.find((p) => p.key === selection.key) ?? null
    : null;

  return (
    <div className="sdt-split-pane">
      <div className="sdt-split-left">
        <div className="sdt-component-list">
          <div className="sdt-component-group-label">Pages</div>
          {pages.map((page) => (
            <div
              key={page.key}
              className="sdt-component-item"
              data-selected={selection?.type === "page" && selection.key === page.key}
              onClick={() => setSelection({ type: "page", key: page.key })}
            >
              <span style={{ flex: 1 }}>{page.label}</span>
              <span className={`sdt-badge ${page.hosted ? "sdt-badge-info" : "sdt-badge-success"}`}>
                {page.hosted ? "Hosted" : "Custom"}
              </span>
            </div>
          ))}

          <div className="sdt-component-group-label">Components</div>
          {componentNames.map((name) => (
            <div
              key={name}
              className="sdt-component-item"
              data-selected={selection?.type === "component" && selection.name === name}
              onClick={() => setSelection({ type: "component", name })}
            >
              <span>{name}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="sdt-split-right">
        {selectedPage ? (
          <PageDetail page={selectedPage} />
        ) : selection?.type === "component" ? (
          <ComponentDetail name={selection.name} />
        ) : (
          <div className="sdt-empty-state">
            <div className="sdt-empty-state-icon">{'\u2190'}</div>
            <div>Select a page or component to view details</div>
          </div>
        )}
      </div>
    </div>
  );
}

// END_PLATFORM
