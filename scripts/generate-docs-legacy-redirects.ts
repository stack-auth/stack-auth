import { readFileSync, writeFileSync } from "fs";
import path from "path";

type Redirect = {
  source: string,
  destination: string,
};

const NEW_DOCS_ORIGIN = "https://docs.hexclave.com";

const AUTH_PROVIDERS = [
  "apple",
  "bitbucket",
  "discord",
  "facebook",
  "github",
  "gitlab",
  "google",
  "linkedin",
  "microsoft",
  "passkey",
  "spotify",
  "twitch",
  "two-factor-auth",
  "x-twitter",
] as const;

const APPS_WITH_OVERVIEW = [
  "analytics",
  "api-keys",
  "data-vault",
  "emails",
  "fraud-protection",
  "launch-checklist",
  "payments",
  "webhooks",
] as const;

const SDK_TYPES = [
  "api-key",
  "connected-account",
  "contact-channel",
  "customer",
  "email",
  "item",
  "project",
  "team",
  "team-permission",
  "team-profile",
  "team-user",
  "user",
] as const;

const COMPONENTS = [
  "account-settings",
  "credential-sign-in",
  "credential-sign-up",
  "forgot-password",
  "index",
  "magic-link-sign-in",
  "oauth-button",
  "oauth-button-group",
  "password-reset",
  "selected-team-switcher",
  "sign-in",
  "sign-up",
  "stack-handler",
  "stack-provider",
  "stack-theme",
  "user-button",
] as const;

const PLATFORM_PREFIXES = ["next", "react", "js", "python"] as const;

function addRedirect(redirects: Map<string, string>, source: string, destination: string) {
  redirects.set(source, destination);
}

function buildLegacyPathRedirects(): Redirect[] {
  const redirects = new Map<string, string>();

  addRedirect(redirects, "/docs", "/");
  addRedirect(redirects, "/docs/overview", "/");
  addRedirect(redirects, "/docs/faq", "/guides/faq");

  addRedirect(redirects, "/docs/getting-started/setup", "/guides/getting-started/setup");
  addRedirect(redirects, "/docs/getting-started/users", "/guides/getting-started/user-fundamentals");
  addRedirect(redirects, "/docs/getting-started/production", "/guides/other/tutorials/ship-production-ready-auth");
  addRedirect(redirects, "/docs/getting-started/components", "/guides/getting-started/setup");
  addRedirect(redirects, "/docs/getting-started/vite-example", "/guides/getting-started/setup");

  addRedirect(redirects, "/docs/concepts/auth-providers", "/guides/apps/authentication/auth-providers");
  for (const provider of AUTH_PROVIDERS) {
    addRedirect(
      redirects,
      `/docs/concepts/auth-providers/${provider}`,
      `/guides/apps/authentication/auth-providers/${provider}`,
    );
  }

  addRedirect(redirects, "/docs/concepts/jwt", "/guides/apps/authentication/jwts");
  addRedirect(redirects, "/docs/concepts/sign-up-rules", "/guides/apps/authentication/sign-up-rules");
  addRedirect(redirects, "/docs/concepts/user-onboarding", "/guides/apps/authentication/user-onboarding");
  addRedirect(redirects, "/docs/concepts/team-selection", "/guides/apps/teams/team-selection");
  addRedirect(redirects, "/docs/concepts/stack-app", "/sdk/objects/hexclave-app");
  addRedirect(redirects, "/docs/concepts/backend-integration", "/api/overview");
  addRedirect(redirects, "/docs/concepts/custom-user-data", "/guides/getting-started/user-fundamentals#custom-metadata");
  addRedirect(redirects, "/docs/concepts/teams", "/guides/apps/teams/overview");
  addRedirect(redirects, "/docs/concepts/orgs-and-teams", "/guides/apps/teams/overview");
  addRedirect(redirects, "/docs/concepts/emails", "/guides/apps/emails/overview");
  addRedirect(redirects, "/docs/concepts/webhooks", "/guides/apps/webhooks/overview");
  addRedirect(redirects, "/docs/concepts/permissions", "/guides/apps/rbac/overview");
  addRedirect(redirects, "/docs/concepts/api-keys", "/guides/apps/api-keys/overview");
  addRedirect(redirects, "/docs/concepts/oauth", "/guides/apps/authentication/connected-accounts");

  for (const app of APPS_WITH_OVERVIEW) {
    addRedirect(redirects, `/docs/apps/${app}`, `/guides/apps/${app}/overview`);
  }
  addRedirect(redirects, "/docs/apps/orgs-and-teams", "/guides/apps/teams/overview");
  addRedirect(redirects, "/docs/apps/permissions", "/guides/apps/rbac/overview");
  addRedirect(redirects, "/docs/apps/oauth", "/guides/apps/authentication/connected-accounts");

  addRedirect(redirects, "/docs/others/convex", "/guides/integrations/convex/overview");
  addRedirect(redirects, "/docs/others/supabase", "/guides/integrations/supabase/overview");
  addRedirect(redirects, "/docs/others/self-host", "/guides/other/self-host");
  addRedirect(redirects, "/docs/others/mcp-setup", "/guides/getting-started/ai-integration");
  addRedirect(redirects, "/docs/others/cli-authentication", "/guides/apps/authentication/cli-authentication");

  addRedirect(redirects, "/docs/customization/dark-mode", "/guides/getting-started/setup");
  addRedirect(redirects, "/docs/customization/custom-styles", "/guides/getting-started/setup");
  addRedirect(redirects, "/docs/customization/custom-pages", "/guides/getting-started/setup");
  addRedirect(redirects, "/docs/customization/internationalization", "/guides/getting-started/setup");
  addRedirect(redirects, "/docs/customization/page-examples", "/guides/getting-started/setup");
  addRedirect(redirects, "/docs/customization/page-examples/sign-in", "/guides/getting-started/setup");
  addRedirect(redirects, "/docs/customization/page-examples/sign-up", "/guides/getting-started/setup");
  addRedirect(redirects, "/docs/customization/page-examples/forgot-password", "/guides/getting-started/setup");
  addRedirect(redirects, "/docs/customization/page-examples/password-reset", "/guides/getting-started/setup");

  addRedirect(redirects, "/docs/sdk", "/sdk/overview");
  addRedirect(redirects, "/docs/sdk/index", "/sdk/overview");
  addRedirect(redirects, "/docs/sdk/overview-new", "/sdk/overview");
  addRedirect(redirects, "/docs/sdk/objects/stack-app", "/sdk/objects/hexclave-app");
  addRedirect(redirects, "/docs/sdk/hooks/use-stack-app", "/sdk/hooks/use-hexclave-app");
  addRedirect(redirects, "/docs/sdk/hooks/use-user", "/sdk/hooks/use-user");
  for (const sdkType of SDK_TYPES) {
    addRedirect(redirects, `/docs/sdk/types/${sdkType}`, `/sdk/types/${sdkType}`);
  }

  addRedirect(redirects, "/docs/components", "/sdk/overview");
  for (const component of COMPONENTS) {
    addRedirect(redirects, `/docs/components/${component}`, "/sdk/overview");
  }

  addRedirect(redirects, "/docs/rest-api/overview", "/api/overview");
  addRedirect(redirects, "/docs/api", "/api/overview");
  addRedirect(redirects, "/docs/api/overview", "/api/overview");

  addRedirect(redirects, "/getting-started/setup", "/guides/getting-started/setup");
  addRedirect(redirects, "/rest-api/overview", "/api/overview");
  addRedirect(redirects, "/sdk/objects/stack-app", "/sdk/objects/hexclave-app");
  addRedirect(redirects, "/sdk/hooks/use-stack-app", "/sdk/hooks/use-hexclave-app");
  addRedirect(redirects, "/others/js-client", "/sdk/objects/hexclave-app");

  for (const platform of PLATFORM_PREFIXES) {
    addRedirect(redirects, `/${platform}/getting-started/setup`, "/guides/getting-started/setup");
    addRedirect(redirects, `/docs/${platform}/getting-started/setup`, "/guides/getting-started/setup");
    addRedirect(redirects, `/${platform}/getting-started/users`, "/guides/getting-started/user-fundamentals");
    addRedirect(redirects, `/docs/${platform}/getting-started/users`, "/guides/getting-started/user-fundamentals");
    addRedirect(redirects, `/${platform}/getting-started/production`, "/guides/other/tutorials/ship-production-ready-auth");
    addRedirect(redirects, `/docs/${platform}/getting-started/production`, "/guides/other/tutorials/ship-production-ready-auth");
    addRedirect(redirects, `/${platform}/sdk`, "/sdk/overview");
    addRedirect(redirects, `/docs/${platform}/sdk`, "/sdk/overview");
    addRedirect(redirects, `/${platform}/sdk/objects/stack-app`, "/sdk/objects/hexclave-app");
    addRedirect(redirects, `/docs/${platform}/sdk/objects/stack-app`, "/sdk/objects/hexclave-app");
  }

  return [...redirects.entries()]
    .sort(([sourceA], [sourceB]) => sourceA.localeCompare(sourceB))
    .map(([source, destination]) => ({ source, destination }));
}

function main() {
  const repoRoot = path.resolve(__dirname, "..");
  const vercelJsonPath = path.join(repoRoot, "docs-legacy-redirects/vercel.json");

  const pathRedirects = buildLegacyPathRedirects();
  const vercelRedirects = [
    ...pathRedirects.map(({ source, destination }) => ({
      source,
      destination: `${NEW_DOCS_ORIGIN}${destination}`,
      permanent: true,
    })),
    {
      source: "/:path*",
      destination: `${NEW_DOCS_ORIGIN}/`,
      permanent: true,
    },
  ];

  writeFileSync(
    vercelJsonPath,
    `${JSON.stringify({ $schema: "https://openapi.vercel.sh/vercel.json", redirects: vercelRedirects }, null, 2)}\n`,
    "utf-8",
  );
  console.log(`Updated ${pathRedirects.length} legacy redirects in docs-legacy-redirects/vercel.json`);
}

main();
