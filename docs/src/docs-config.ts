import { BarChart3, Book, ClipboardList, Code, CreditCard, Database, Inbox, Key, Layers, Lock, Mail, Monitor, Rocket, ShieldCheck, Sparkles, Triangle, Users, Webhook, Zap, type LucideIcon } from 'lucide-react';

export type PageItem = {
  title: string,
  href: string,
  icon?: LucideIcon,
  iconColor?: string,
  iconTooltip?: string,
  children?: PageItem[],
};

export type SidebarCategory = {
  title: string | null,
  pages: PageItem[],
};

export type TabConfig = {
  title: string,
  icon: LucideIcon,
  sidebarCategories: SidebarCategory[],
};

export type DocsConfig = {
  tabs: TabConfig[],
};

export const docsConfig: DocsConfig = {
  tabs: [
    {
      title: "Guides",
      icon: Book,
      sidebarCategories: [
        {
          title: null,
          pages: [
            { title: "Overview", href: "/docs/overview" },
            { title: "FAQ", href: "/docs/overview" },
          ],
        },
        {
          title: "Getting Started",
          pages: [
            { title: "Setup", href: "/docs/getting-started/setup" },
            { title: "Users", href: "/docs/getting-started/users" },
            { title: "Backend Integration", href: "/docs/getting-started/production" },
            { title: "Customization", href: "/docs/getting-started/vite-example" },
          ],
        },
        {
          title: "Going Further",
          pages: [
            { title: "The StackApp Object", href: "/docs/concepts/stack-app" },
            { title: "Integrating with backends", href: "/docs/concepts/integrating-with-backends" },
            { title: "Local Development", href: "/docs/concepts/developing-locally" },
            { title: "Component customization", href: "/docs/concepts/developing-locally" },
          ],
        },
        {
          title: "Apps",
          pages: [
            { title: "Authentication", icon: Lock, href: "/docs/apps/authentication", children: [
              { title: "Auth Providers", href: "/docs/apps/auth-providers", children: [
                { title: "GitHub", href: "/docs/apps/auth-providers/github" },
                { title: "Google", href: "/docs/apps/auth-providers/google" },
                { title: "Facebook", href: "/docs/apps/auth-providers/facebook" },
                { title: "Microsoft", href: "/docs/apps/auth-providers/microsoft" },
                { title: "Spotify", href: "/docs/apps/auth-providers/spotify" },
                { title: "Discord", href: "/docs/apps/auth-providers/discord" },
                { title: "GitLab", href: "/docs/apps/auth-providers/gitlab" },
                { title: "Apple", href: "/docs/apps/auth-providers/apple" },
                { title: "Bitbucket", href: "/docs/apps/auth-providers/bitbucket" },
                { title: "LinkedIn", href: "/docs/apps/auth-providers/linkedin" },
                { title: "X (Twitter)", href: "/docs/apps/auth-providers/x-twitter" },
                { title: "Twitch", href: "/docs/apps/auth-providers/twitch" },
                { title: "Passkey", href: "/docs/apps/auth-providers/passkey" },
                { title: "Two-Factor Auth", href: "/docs/apps/auth-providers/two-factor-auth" },
              ] },
              { title: "Sign-up Rules", href: "/docs/apps/sign-up-rules" },
              { title: "CLI Authentication", href: "/docs/apps/oauth" },
            ] },
            { title: "Onboarding", icon: ClipboardList, href: "/docs/apps/onboarding" },
            { title: "Teams", icon: Users, href: "/docs/apps/teams", children: [
              { title: "Team Settings", href: "/docs/apps/team-settings" },
              { title: "Selected Teams", href: "/docs/apps/selected-teams" },
            ] },
            { title: "RBAC", icon: ShieldCheck, href: "/docs/apps/rbac" },
            { title: "API Keys", icon: Key, href: "/docs/apps/api-keys" },
            { title: "Payments", icon: CreditCard, href: "/docs/apps/payments" },
            { title: "Emails", icon: Mail, href: "/docs/apps/emails" },
            { title: "Email API", icon: Inbox, href: "/docs/apps/email-api" },
            { title: "Data Vault", icon: Database, href: "/docs/apps/data-vault" },
            { title: "Webhooks", icon: Webhook, href: "/docs/apps/webhooks" },
            { title: "TV Mode", icon: Monitor, href: "/docs/apps/tv-mode" },
            { title: "Launch Checklist", icon: Rocket, href: "/docs/apps/launch-checklist" },
            { title: "Catalyst", icon: Sparkles, href: "/docs/apps/catalyst" },
            { title: "Analytics", icon: BarChart3, href: "/docs/apps/analytics" },
          ],
        },
        {
          title: "Integrations",
          pages: [
            { title: "Supabase", icon: Database, iconColor: "amber", href: "/docs/apps/supabase" },
            { title: "Convex", icon: Database, iconColor: "amber", href: "/docs/apps/convex" },
            { title: "Vercel", icon: Triangle, iconColor: "amber", href: "/docs/apps/vercel" },
            { title: "Neon", icon: Database, iconColor: "amber", href: "/docs/apps/neon" },
          ],
        },
        {
          title: "Other",
          pages: [
            { title: "Self Hosting", href: "/docs/others/self-host" },
            { title: "MCP Setup", href: "/docs/others/mcp-setup" },
            { title: "Migrations", href: "/docs/others/migrations", children: [
              { title: "From Auth0", href: "/docs/others/migrations/from-auth0" },
              { title: "From Firebase", href: "/docs/others/migrations/from-firebase" },
              { title: "From Supabase", href: "/docs/others/migrations/from-supabase" },
              { title: "From Stripe", href: "/docs/others/migrations/from-firebase" },
              { title: "From Clerk", href: "/docs/others/migrations/from-clerk" },
            ] },
            { title: "Tutorials", href: "/docs/others/migrations", children: [
              { title: "Build a SaaS with Stack Auth", href: "/docs/others/tutorials/build-a-saas-with-stack-auth" },
              { title: "Build a SaaS with Stack Auth", href: "/docs/others/tutorials/build-a-saas-with-stack-auth" },
              { title: "Build a SaaS with Stack Auth", href: "/docs/others/tutorials/build-a-saas-with-stack-auth" },
            ] },
            { title: "Showcase", href: "/docs/others/showcase" },
          ],
        },
      ],
    },
    {
      title: "SDK",
      icon: Code,
      sidebarCategories: [
        {
          title: null,
          pages: [
            { title: "SDK Overview", href: "/docs/sdk" },
          ],
        },
        {
          title: "Objects",
          pages: [
            { title: "StackApp", href: "/docs/sdk/objects/stack-app" },
          ],
        },
        {
          title: "Types",
          pages: [
            { title: "User", href: "/docs/sdk/types/user" },
            { title: "Team", href: "/docs/sdk/types/team" },
            { title: "Team User", href: "/docs/sdk/types/team-user" },
            { title: "Team Permission", href: "/docs/sdk/types/team-permission" },
            { title: "Team Profile", href: "/docs/sdk/types/team-profile" },
            { title: "Contact Channel", href: "/docs/sdk/types/contact-channel" },
            { title: "Email", href: "/docs/sdk/types/email" },
            { title: "API Key", href: "/docs/sdk/types/api-key" },
            { title: "Project", href: "/docs/sdk/types/project" },
            { title: "Connected Account", href: "/docs/sdk/types/connected-account" },
            { title: "Item", href: "/docs/sdk/types/item" },
            { title: "Customer", href: "/docs/sdk/types/customer" },
          ],
        },
        {
          title: "Hooks",
          pages: [
            { title: "useStackApp", href: "/docs/sdk/hooks/use-stack-app" },
            { title: "useUser", href: "/docs/sdk/hooks/use-user" },
          ],
        },
      ],
    },
    {
      title: "Components",
      icon: Layers,
      sidebarCategories: [
        {
          title: null,
          pages: [
            { title: "Components Overview", href: "/docs/components" },
          ],
        },
        {
          title: "Pages",
          pages: [
            { title: "Sign In", icon: Lock, iconTooltip: "Authentication app", href: "/docs/components/sign-in" },
            { title: "Sign Up", icon: Lock, iconTooltip: "Authentication app", href: "/docs/components/sign-up" },
            { title: "Forgot Password", icon: Lock, iconTooltip: "Authentication app", href: "/docs/components/forgot-password" },
            { title: "Password Reset", icon: Lock, iconTooltip: "Authentication app", href: "/docs/components/password-reset" },
            { title: "Email Verification", icon: Mail, iconTooltip: "Emails app", href: "/docs/components/email-verification" },
            { title: "Team Invitation", icon: Users, iconTooltip: "Teams app", href: "/docs/components/team-invitation" },
            { title: "Stack Handler", href: "/docs/components/stack-handler" },
            { title: "Account Settings", href: "/docs/components/account-settings" },
          ],
        },
        {
          title: "Component Cookbooks",
          pages: [
            { title: "Sign In Component", icon: Lock, iconTooltip: "Authentication app", href: "/docs/components/sign-in" },
            { title: "Sign Up Component", icon: Lock, iconTooltip: "Authentication app", href: "/docs/components/sign-up" },
            { title: "Credential Sign In", icon: Lock, iconTooltip: "Authentication app", href: "/docs/components/credential-sign-in" },
            { title: "Credential Sign Up", icon: Lock, iconTooltip: "Authentication app", href: "/docs/components/credential-sign-up" },
            { title: "Magic Link Sign In", icon: Lock, iconTooltip: "Authentication app", href: "/docs/components/magic-link-sign-in" },
            { title: "OAuth Button", icon: Lock, iconTooltip: "Authentication app", href: "/docs/components/oauth-button" },
            { title: "OAuth Button Group", icon: Lock, iconTooltip: "Authentication app", href: "/docs/components/oauth-button-group" },
            { title: "Team Switcher", icon: Users, iconTooltip: "Teams app", href: "/docs/components/team-switcher" },
            { title: "User Button", icon: Lock, iconTooltip: "Authentication app", href: "/docs/components/user-button" },
            { title: "Selected Team Switcher", icon: Users, iconTooltip: "Teams app", href: "/docs/components/selected-team-switcher" },
          ],
        },
      ],
    },
    {
      title: "API Reference",
      icon: Zap,
      sidebarCategories: [
        {
          title: null,
          pages: [
            { title: "API Overview", href: "/api/overview" },
          ],
        },
      ],
    },
  ],
};

function* iteratePages(pages: PageItem[]): Generator<PageItem> {
  for (const page of pages) {
    yield page;
    if (page.children) {
      yield* iteratePages(page.children);
    }
  }
}

function* iterateAllTabPages(tab: TabConfig): Generator<PageItem> {
  for (const category of tab.sidebarCategories) {
    yield* iteratePages(category.pages);
  }
}

export function getTabDefaultHref(tab: TabConfig): string {
  for (const page of iterateAllTabPages(tab)) {
    return page.href;
  }
  return '/docs/overview';
}

export function findActiveTab(pathname: string): TabConfig | null {
  const normalizedPath = pathname.replace(/\/$/, '');

  for (const tab of docsConfig.tabs) {
    for (const page of iterateAllTabPages(tab)) {
      if (normalizedPath === page.href) {
        return tab;
      }
    }
  }

  for (const tab of docsConfig.tabs) {
    for (const page of iterateAllTabPages(tab)) {
      if (normalizedPath.startsWith(page.href + '/')) {
        return tab;
      }
    }
  }

  return docsConfig.tabs[0] ?? null;
}
