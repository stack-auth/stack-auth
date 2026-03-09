import type { LucideIcon } from 'lucide-react';
import { BookOpen, CreditCard, Lightbulb, Link2, Mail, Palette, PieChart, Settings } from 'lucide-react';

export type PageItem = {
  title: string,
  href: string,
  activePrefix?: string,
};

export type SidebarCategory = {
  title: string | null,
  pages: PageItem[],
};

export type SidebarSection = {
  title: string,
  icon?: LucideIcon,
  defaultOpen: boolean,
  categories: SidebarCategory[],
};

export type DocsConfig = {
  topLinks: PageItem[],
  sections: SidebarSection[],
};

export const docsConfig: DocsConfig = {
  topLinks: [
    { title: "Guides", href: "/docs/overview", activePrefix: "/docs" },
    { title: "SDK Reference", href: "/docs/sdk" },
    { title: "API Reference", href: "/api/overview" },
  ],
  sections: [
    {
      title: "Auth",
      icon: BookOpen,
      defaultOpen: true,
      categories: [
        {
          title: null,
          pages: [
            { title: "Setup", href: "/docs/getting-started/setup" },
            { title: "Stack App", href: "/docs/concepts/stack-app" },
            { title: "Components", href: "/docs/getting-started/components" },
            { title: "Users", href: "/docs/getting-started/users" },
            { title: "Production", href: "/docs/getting-started/production" },
            { title: "OAuth", href: "/docs/concepts/oauth" },
            { title: "Auth Providers", href: "/docs/concepts/auth-providers" },
            { title: "Backend Integration", href: "/docs/concepts/backend-integration" },
            { title: "JWT", href: "/docs/concepts/jwt" },
          ],
        },
      ],
    },
    {
      title: "Payments",
      icon: CreditCard,
      defaultOpen: false,
      categories: [
        {
          title: null,
          pages: [
            { title: "Payments", href: "/docs/apps/payments" },
          ],
        },
      ],
    },
    {
      title: "Emails",
      icon: Mail,
      defaultOpen: false,
      categories: [
        {
          title: null,
          pages: [
            { title: "Emails", href: "/docs/apps/emails" },
            { title: "Emails", href: "/docs/concepts/emails" },
          ],
        },
      ],
    },
    {
      title: "Analytics",
      icon: PieChart,
      defaultOpen: false,
      categories: [
        {
          title: null,
          pages: [],
        },
      ],
    },
    {
      title: "Other",
      icon: Settings,
      defaultOpen: false,
      categories: [
        {
          title: null,
          pages: [
            { title: "Orgs & Teams", href: "/docs/apps/orgs-and-teams" },
            { title: "Orgs & Teams", href: "/docs/concepts/orgs-and-teams" },
            { title: "Permissions", href: "/docs/apps/permissions" },
            { title: "Permissions", href: "/docs/concepts/permissions" },
            { title: "Team Selection", href: "/docs/concepts/team-selection" },
            { title: "Webhooks", href: "/docs/apps/webhooks" },
            { title: "Webhooks", href: "/docs/concepts/webhooks" },
            { title: "CLI Authentication", href: "/docs/others/cli-authentication" },
            { title: "Self Host", href: "/docs/others/self-host" },
          ],
        },
      ],
    },
    {
      title: "Customization / Components",
      icon: Palette,
      defaultOpen: false,
      categories: [
        {
          title: "Customization",
          pages: [
            { title: "Custom Pages", href: "/docs/customization/custom-pages" },
            { title: "Custom Styles", href: "/docs/customization/custom-styles" },
            { title: "Dark Mode", href: "/docs/customization/dark-mode" },
            { title: "Internationalization", href: "/docs/customization/internationalization" },
            { title: "Page Examples", href: "/docs/customization/page-examples" },
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
      title: "Concepts",
      icon: Lightbulb,
      defaultOpen: false,
      categories: [
        {
          title: null,
          pages: [
            { title: "How Auth Works", href: "/docs/concepts/how-auth-works" },
            { title: "Sessions & Tokens", href: "/docs/concepts/sessions-and-tokens" },
            { title: "Server vs Client", href: "/docs/concepts/server-vs-client" },
            { title: "Multi-tenancy", href: "/docs/concepts/multi-tenancy" },
            { title: "Security Model", href: "/docs/concepts/security-model" },
          ],
        },
      ],
    },
    {
      title: "Integrations",
      icon: Link2,
      defaultOpen: false,
      categories: [
        {
          title: null,
          pages: [
            { title: "Supabase", href: "/docs/others/supabase" },
            { title: "Convex", href: "/docs/others/convex" },
          ],
        },
      ],
    },
  ],
};

export function findActiveSection(pathname: string): SidebarSection | null {
  const normalizedPath = pathname.replace(/\/$/, '');

  for (const section of docsConfig.sections) {
    for (const category of section.categories) {
      for (const page of category.pages) {
        if (normalizedPath === page.href || normalizedPath.startsWith(page.href + '/')) {
          return section;
        }
      }
    }
  }

  return null;
}
