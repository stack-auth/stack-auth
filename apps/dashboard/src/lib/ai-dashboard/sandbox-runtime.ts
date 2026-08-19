import packageJson from "../../../package.json";

/**
 * The pieces every AI-generated-UI sandbox needs, shared by the two hosts that render one:
 * the custom-dashboard composer (components/commands/create-dashboard) and the Growth report
 * presentation (gtm/components/presentation-sandbox).
 *
 * Both hosts build a full HTML document, hand it to an `iframe sandbox="allow-scripts"` via
 * `srcDoc`, and let Babel compile the authored source inside the frame. What differs between them
 * is only what the frame is allowed to reach: the composer bridges an access token in so the
 * generated dashboard can query live project data, while a Growth presentation is a frozen
 * document and gets no SDK and no token at all. Hence `includeStackSdk` below — everything else
 * here is identical for both, and duplicating it once caused the two frames to drift on theme
 * variables.
 */

/** No-op tag that keeps editors syntax-highlighting the embedded documents as HTML. */
export function html(strings: TemplateStringsArray, ...values: unknown[]): string {
  return strings.reduce<string>((result, str, i) => result + str + (values[i] ?? ''), '');
}

export const isSandboxDevMode = process.env.NODE_ENV === "development";
export const SANDBOX_LOAD_ERROR_MESSAGE = "This report could not be loaded. Please refresh and try again.";

const ESM_VERSION_HEADER = "// @stack-esm-version:";
const ESM_VERSION_REGEX = /^\/\/\s*@stack-esm-version:\s*(\S+)\s*$/m;

/**
 * Saved sources carry the package version they were authored against, so a dashboard written
 * months ago keeps loading the SDK it was written for instead of silently jumping to a new major.
 */
export function extractEsmVersion(sourceCode: string): string | null {
  const match = sourceCode.match(ESM_VERSION_REGEX);
  return match ? match[1] : null;
}

export function stampEsmVersion(sourceCode: string, version: string): string {
  if (ESM_VERSION_REGEX.test(sourceCode)) {
    return sourceCode.replace(ESM_VERSION_REGEX, `${ESM_VERSION_HEADER} ${version}`);
  }
  return `${ESM_VERSION_HEADER} ${version}\n${sourceCode}`;
}

/** The version a source is pinned to, falling back to the dashboard's own version. */
export function getSandboxEsmVersion(sourceCode: string): string {
  return extractEsmVersion(sourceCode) ?? packageJson.version;
}

/**
 * esm.sh only has versions that were actually published, and the dashboard's version moves ahead
 * of the npm release. One patch back is the last version we know is on the registry.
 */
export function getEsmFallbackVersion(version: string): string {
  const parts = version.split(".");
  if (parts.length !== 3) return version;
  const patch = Number(parts[2]);
  if (!Number.isInteger(patch) || patch <= 0) return version;
  return `${parts[0]}.${parts[1]}.${patch - 1}`;
}

/** JSON, with `<` escaped so the payload can live inside a `<script type="application/json">`. */
export function encodeSourceForJsonScript(code: string): string {
  return JSON.stringify(code).replace(/</g, "\\u003c");
}

/**
 * Installed before any authored code runs, so a Babel parse error, an uncaught throw, or a
 * rejected promise reaches the parent instead of leaving a blank frame behind.
 */
export const SANDBOX_ERROR_LISTENER_SCRIPT = html`
    <script>
      (function () {
        function postError(message, stack) {
          try {
            window.parent.postMessage({
              type: 'dashboard-error-boundary',
              message: message || 'Unknown dashboard error',
              stack: stack || undefined,
            }, '*');
          } catch (_) { /* parent may be gone */ }
        }
        window.__postDashboardError = postError;
        window.addEventListener('error', function (event) {
          var err = event && event.error;
          postError((err && err.message) || (event && event.message) || 'Unknown runtime error', err && err.stack);
        });
        window.addEventListener('unhandledrejection', function (event) {
          var reason = event && event.reason;
          postError((reason && (reason.message || String(reason))) || 'Unhandled promise rejection', reason && reason.stack);
        });
      })();
    </script>`;

/** Tailwind Play CDN plus the token aliases the dashboard's own components expect. */
export const SANDBOX_TAILWIND_CONFIG_SCRIPT = html`
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
    </script>`;

/**
 * The dashboard's design tokens, inlined: the frame is a separate document and cannot inherit the
 * parent's stylesheet. `--page-background: transparent` lets the host page's background show
 * through so an embedded frame does not paint a differently-shaded rectangle.
 */
export const SANDBOX_THEME_STYLES = html`
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
    </style>`;

export const SANDBOX_BABEL_SCRIPT = html`
    <script src="https://unpkg.com/@babel/standalone@7.29.7/babel.min.js" crossorigin="anonymous"></script>`;

function getCustomDashboardDependencyScripts(
  esmVersion: string,
  esmFallbackVersion: string,
  dashboardUrl: string,
): string {
  if (isSandboxDevMode) {
    return html`
      <script type="module">
        function formatDependencyError(error) {
          return error instanceof Error ? error.message : String(error);
        }

        function reportDependencyError(message, error) {
          window.parent.postMessage({
            type: 'dashboard-sandbox-dependency-error',
            message,
            stack: error instanceof Error ? error.stack : undefined,
          }, '*');
        }

        function failDependencyLoad(message, error) {
          reportDependencyError(message, error);
          window.__depsError = {
            message,
            stack: error instanceof Error ? error.stack : undefined,
          };
          window.__depsReady = true;
          window.dispatchEvent(new Event('deps-ready'));
        }

        import React from 'https://esm.sh/react@19.2.3';
        import * as ReactDOM from 'https://esm.sh/react-dom@19.2.3?deps=react@19.2.3';
        import * as ReactDOMClient from 'https://esm.sh/react-dom@19.2.3/client?deps=react@19.2.3';
        import * as Recharts from 'https://esm.sh/recharts@2.15.4?deps=react@19.2.3,react-dom@19.2.3';

        window.React = React;
        window.ReactDOM = { ...ReactDOM, ...ReactDOMClient };
        window.Recharts = Recharts;

        // Stack SDK may not be published at the current version — try with fallback
        try {
          const StackSDK = await import('https://esm.sh/@hexclave/js@${esmVersion}');
          window.StackAdminApp = StackSDK.StackAdminApp;
          window.StackServerApp = StackSDK.StackServerApp;
          window.StackSDK = StackSDK;
        } catch (e) {
          reportDependencyError('[sandbox] @hexclave/js failed at version ${esmVersion}; trying fallback ${esmFallbackVersion}: ' + formatDependencyError(e), e);
          try {
            const StackSDK = await import('https://esm.sh/@hexclave/js@${esmFallbackVersion}');
            window.StackAdminApp = StackSDK.StackAdminApp;
            window.StackServerApp = StackSDK.StackServerApp;
            window.StackSDK = StackSDK;
          } catch (e2) {
            failDependencyLoad('[sandbox] @hexclave/js fallback failed at version ${esmFallbackVersion}: ' + formatDependencyError(e2), e2);
          }
        }
        window.generateUuid = () => crypto.randomUUID();

        // Load local IIFE for dashboard-ui-components (after globals are set)
        const script = document.createElement('script');
        script.src = '${dashboardUrl}/dashboard-ui-components.iife.js';
        script.onload = () => {
          window.__depsReady = true;
          window.dispatchEvent(new Event('deps-ready'));
        };
        script.onerror = (e) => {
          const message = '[sandbox] Failed to load local dashboard-ui-components IIFE bundle. Run pnpm --filter @hexclave/dashboard-ui-components dev or pnpm --filter @hexclave/dashboard-ui-components build so apps/dashboard/public/dashboard-ui-components.iife.js exists.';
          failDependencyLoad(message, e instanceof Error ? e : new Error(message));
        };
        document.head.appendChild(script);
      </script>`;
  }

  return html`
    <script type="module">
      const CUSTOM_DASHBOARD_LOAD_ERROR_MESSAGE = 'There was a problem loading custom dashboards. Please refresh the page and try again.';

      function formatDependencyError(error) {
        return error instanceof Error ? error.message : String(error);
      }

      function reportDependencyError(message, error) {
        window.parent.postMessage({
          type: 'dashboard-sandbox-dependency-error',
          message,
          stack: error instanceof Error ? error.stack : undefined,
        }, '*');
      }

      function failDependencyLoad(message, error) {
        reportDependencyError(message, error);
        window.__depsError = {
          message: CUSTOM_DASHBOARD_LOAD_ERROR_MESSAGE,
          stack: error instanceof Error ? error.stack : undefined,
        };
        window.__depsReady = true;
        window.dispatchEvent(new Event('deps-ready'));
      }

      import React from 'https://esm.sh/react@19.2.3';
      import * as ReactDOM from 'https://esm.sh/react-dom@19.2.3?deps=react@19.2.3';
      import * as ReactDOMClient from 'https://esm.sh/react-dom@19.2.3/client?deps=react@19.2.3';
      import * as Recharts from 'https://esm.sh/recharts@2.15.4?deps=react@19.2.3,react-dom@19.2.3';

      window.React = React;
      window.ReactDOM = { ...ReactDOM, ...ReactDOMClient };
      window.Recharts = Recharts;

      // Try current version first, fall back to last known good version
      let DashboardUIComponents, StackSDK;
      try {
        [DashboardUIComponents, StackSDK] = await Promise.all([
          import('https://esm.sh/@hexclave/dashboard-ui-components@${esmVersion}?deps=react@19.2.3,react-dom@19.2.3'),
          import('https://esm.sh/@hexclave/js@${esmVersion}'),
        ]);
      } catch (e) {
        reportDependencyError('[sandbox] Custom dashboard packages failed at version ${esmVersion}; trying fallback ${esmFallbackVersion}: ' + formatDependencyError(e), e);
        try {
          [DashboardUIComponents, StackSDK] = await Promise.all([
            import('https://esm.sh/@hexclave/dashboard-ui-components@${esmFallbackVersion}?deps=react@19.2.3,react-dom@19.2.3'),
            import('https://esm.sh/@hexclave/js@${esmFallbackVersion}'),
          ]);
        } catch (e2) {
          failDependencyLoad('[sandbox] Custom dashboard package fallback failed at version ${esmFallbackVersion}: ' + formatDependencyError(e2), e2);
        }
      }

      if (!window.__depsError) {
        window.DashboardUI = DashboardUIComponents;
        window.StackAdminApp = StackSDK.StackAdminApp;
        window.StackServerApp = StackSDK.StackServerApp;
        window.StackSDK = StackSDK;
        window.generateUuid = () => crypto.randomUUID();

        window.__depsReady = true;
        window.dispatchEvent(new Event('deps-ready'));
      }
    </script>`;
}

/**
 * React, ReactDOM, Recharts and our component library, loaded from esm.sh — except in development,
 * where the component library comes from the local IIFE bundle the dashboard serves, since the
 * unreleased version does not exist on the registry yet.
 *
 * `includeStackSdk` decides whether `@hexclave/js` is loaded at all. A frame that never gets an
 * access token has no use for it, and not shipping it keeps that frame unable to talk to our API
 * even if the authored source tries.
 */
export function getSandboxDependencyScripts(options: {
  esmVersion: string,
  esmFallbackVersion: string,
  dashboardUrl: string,
  includeStackSdk: boolean,
}): string {
  if (options.includeStackSdk) {
    return getCustomDashboardDependencyScripts(
      options.esmVersion,
      options.esmFallbackVersion,
      options.dashboardUrl,
    );
  }

  const { esmVersion, esmFallbackVersion, dashboardUrl } = options;
  const loadErrorMessage = SANDBOX_LOAD_ERROR_MESSAGE;
  const errorHelpers = `      function formatDependencyError(error) {
        return error instanceof Error ? error.message : String(error);
      }

      function reportDependencyError(message, error) {
        window.parent.postMessage({
          type: 'dashboard-sandbox-dependency-error',
          message,
          stack: error instanceof Error ? error.stack : undefined,
        }, '*');
      }`;

  if (isSandboxDevMode) {
    return html`
      <script type="module">
${errorHelpers}

        function failDependencyLoad(message, error) {
          reportDependencyError(message, error);
          window.__depsError = {
            message,
            stack: error instanceof Error ? error.stack : undefined,
          };
          window.__depsReady = true;
          window.dispatchEvent(new Event('deps-ready'));
        }

        import React from 'https://esm.sh/react@19.2.3';
        import * as ReactDOM from 'https://esm.sh/react-dom@19.2.3?deps=react@19.2.3';
        import * as ReactDOMClient from 'https://esm.sh/react-dom@19.2.3/client?deps=react@19.2.3';
        import * as Recharts from 'https://esm.sh/recharts@2.15.4?deps=react@19.2.3,react-dom@19.2.3';

        window.React = React;
        window.ReactDOM = { ...ReactDOM, ...ReactDOMClient };
        window.Recharts = Recharts;
        window.generateUuid = () => crypto.randomUUID();

        // Load local IIFE for dashboard-ui-components (after globals are set)
        const script = document.createElement('script');
        script.src = '${dashboardUrl}/dashboard-ui-components.iife.js';
        script.onload = () => {
          window.__depsReady = true;
          window.dispatchEvent(new Event('deps-ready'));
        };
        script.onerror = (e) => {
          const message = '[sandbox] Failed to load local dashboard-ui-components IIFE bundle. Run pnpm --filter @hexclave/dashboard-ui-components dev or pnpm --filter @hexclave/dashboard-ui-components build so apps/dashboard/public/dashboard-ui-components.iife.js exists.';
          failDependencyLoad(message, e instanceof Error ? e : new Error(message));
        };
        document.head.appendChild(script);
      </script>`;
  }

  const packageImports = (version: string) =>
    `import('https://esm.sh/@hexclave/dashboard-ui-components@${version}?deps=react@19.2.3,react-dom@19.2.3')`;

  return html`
    <script type="module">
      const CUSTOM_DASHBOARD_LOAD_ERROR_MESSAGE = ${JSON.stringify(loadErrorMessage)};

${errorHelpers}

      function failDependencyLoad(message, error) {
        reportDependencyError(message, error);
        window.__depsError = {
          message: CUSTOM_DASHBOARD_LOAD_ERROR_MESSAGE,
          stack: error instanceof Error ? error.stack : undefined,
        };
        window.__depsReady = true;
        window.dispatchEvent(new Event('deps-ready'));
      }

      import React from 'https://esm.sh/react@19.2.3';
      import * as ReactDOM from 'https://esm.sh/react-dom@19.2.3?deps=react@19.2.3';
      import * as ReactDOMClient from 'https://esm.sh/react-dom@19.2.3/client?deps=react@19.2.3';
      import * as Recharts from 'https://esm.sh/recharts@2.15.4?deps=react@19.2.3,react-dom@19.2.3';

      window.React = React;
      window.ReactDOM = { ...ReactDOM, ...ReactDOMClient };
      window.Recharts = Recharts;

      // Try current version first, fall back to last known good version
      let DashboardUIComponents;
      try {
        [DashboardUIComponents] = await Promise.all([
            ${packageImports(esmVersion)}
        ]);
      } catch (e) {
        reportDependencyError('[sandbox] Sandbox packages failed at version ${esmVersion}; trying fallback ${esmFallbackVersion}: ' + formatDependencyError(e), e);
        try {
          [DashboardUIComponents] = await Promise.all([
            ${packageImports(esmFallbackVersion)}
          ]);
        } catch (e2) {
          failDependencyLoad('[sandbox] Sandbox package fallback failed at version ${esmFallbackVersion}: ' + formatDependencyError(e2), e2);
        }
      }

      if (!window.__depsError) {
        window.DashboardUI = DashboardUIComponents;
        window.generateUuid = () => crypto.randomUUID();

        window.__depsReady = true;
        window.dispatchEvent(new Event('deps-ready'));
      }
    </script>`;
}
