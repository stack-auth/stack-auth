import { Book, Code, Home, Layers, Zap, type LucideIcon } from 'lucide-react';

export type PageItem = {
  title: string,
  href: string,
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
      title: "Welcome",
      icon: Home,
      sidebarCategories: [
        {
          title: null,
          pages: [
            { title: "Overview", href: "/docs/overview" },
            { title: "FAQ", href: "/docs/faq" },
          ],
        },
      ],
    },
    {
      title: "Guides",
      icon: Book,
      sidebarCategories: [
        {
          title: "Getting Started",
          pages: [
            { title: "Setup", href: "/docs/getting-started/setup" },
            { title: "Components", href: "/docs/getting-started/components" },
            { title: "Users", href: "/docs/getting-started/users" },
            { title: "Production", href: "/docs/getting-started/production" },
            { title: "Vite Example", href: "/docs/getting-started/vite-example" },
          ],
        },
        {
          title: "Apps",
          pages: [
            { title: "API Keys", href: "/docs/apps/api-keys" },
            { title: "Emails", href: "/docs/apps/emails" },
            { title: "OAuth", href: "/docs/apps/oauth" },
            { title: "Auth Providers", href: "/docs/apps/auth-providers" },
            { title: "Orgs & Teams", href: "/docs/apps/orgs-and-teams" },
            { title: "Permissions", href: "/docs/apps/permissions" },
            { title: "Webhooks", href: "/docs/apps/webhooks" },
            { title: "Payments", href: "/docs/apps/payments" },
          ],
        },
        {
          title: "Concepts",
          pages: [
            { title: "API Keys", href: "/docs/concepts/api-keys" },
            { title: "Backend Integration", href: "/docs/concepts/backend-integration" },
            { title: "Custom User Data", href: "/docs/concepts/custom-user-data" },
            { title: "Sign-up Rules", href: "/docs/concepts/sign-up-rules" },
            { title: "Emails", href: "/docs/concepts/emails" },
            { title: "JWT", href: "/docs/concepts/jwt" },
            { title: "OAuth", href: "/docs/concepts/oauth" },
            { title: "Auth Providers", href: "/docs/concepts/auth-providers" },
            { title: "Orgs & Teams", href: "/docs/concepts/orgs-and-teams" },
            { title: "Permissions", href: "/docs/concepts/permissions" },
            { title: "Stack App", href: "/docs/concepts/stack-app" },
            { title: "Team Selection", href: "/docs/concepts/team-selection" },
            { title: "User Onboarding", href: "/docs/concepts/user-onboarding" },
            { title: "Webhooks", href: "/docs/concepts/webhooks" },
          ],
        },
        {
          title: "Customization",
          pages: [
            { title: "Custoakshdfsdm Pages", href: "/docs/customization/custom-pages" },
            { title: "Custom Styles", href: "/docs/customization/custom-styles" },
            { title: "Dark Mode", href: "/docs/customization/dark-mode" },
            { title: "Internationalization", href: "/docs/customization/internationalization" },
            { title: "Page Examples", href: "/docs/customization/page-examples" },
          ],
        },
        {
          title: "Other",
          pages: [
            { title: "CLI Authentication", href: "/docs/others/cli-authentication" },
            { title: "Self Host", href: "/docs/others/self-host" },
            { title: "Supabase", href: "/docs/others/supabase" },
            { title: "Convex", href: "/docs/others/convex" },
            { title: "MCP Setup", href: "/docs/others/mcp-setup" },
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
            { title: "StackApp (Test)", href: "/docs/sdk/objects/stack-app-test" },
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
          title: "Authentication",
          pages: [
            { title: "Sign In", href: "/docs/components/sign-in" },
            { title: "Sign Up", href: "/docs/components/sign-up" },
            { title: "Credential Sign In", href: "/docs/components/credential-sign-in" },
            { title: "Credential Sign Up", href: "/docs/components/credential-sign-up" },
            { title: "Magic Link Sign In", href: "/docs/components/magic-link-sign-in" },
            { title: "Forgot Password", href: "/docs/components/forgot-password" },
            { title: "Password Reset", href: "/docs/components/password-reset" },
          ],
        },
        {
          title: "OAuth",
          pages: [
            { title: "OAuth Button", href: "/docs/components/oauth-button" },
            { title: "OAuth Button Group", href: "/docs/components/oauth-button-group" },
          ],
        },
        {
          title: "User Interface",
          pages: [
            { title: "User Button", href: "/docs/components/user-button" },
            { title: "Account Settings", href: "/docs/components/account-settings" },
            { title: "Selected Team Switcher", href: "/docs/components/selected-team-switcher" },
          ],
        },
        {
          title: "Layout & Providers",
          pages: [
            { title: "Stack Provider", href: "/docs/components/stack-provider" },
            { title: "Stack Handler", href: "/docs/components/stack-handler" },
            { title: "Stack Theme", href: "/docs/components/stack-theme" },
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

export function getTabDefaultHref(tab: TabConfig): string {
  for (const category of tab.sidebarCategories) {
    for (const page of category.pages) {
      return page.href;
    }
  }
  return '/docs/overview';
}

export function findActiveTab(pathname: string): TabConfig | null {
  const normalizedPath = pathname.replace(/\/$/, '');

  for (const tab of docsConfig.tabs) {
    for (const category of tab.sidebarCategories) {
      for (const page of category.pages) {
        if (normalizedPath === page.href) {
          return tab;
        }
      }
    }
  }

  for (const tab of docsConfig.tabs) {
    for (const category of tab.sidebarCategories) {
      for (const page of category.pages) {
        if (normalizedPath.startsWith(page.href + '/')) {
          return tab;
        }
      }
    }
  }

  return docsConfig.tabs[0] ?? null;
}
