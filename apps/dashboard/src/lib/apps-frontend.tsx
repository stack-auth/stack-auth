import { Link } from "@/components/link";
import { ClipboardTextIcon, CreditCardIcon, EnvelopeSimpleIcon, FingerprintSimpleIcon, KeyIcon, MailboxIcon, RocketIcon, SparkleIcon, TelevisionSimpleIcon, TriangleIcon, UserGearIcon, UsersIcon, VaultIcon, WebhooksLogoIcon } from "@phosphor-icons/react";
import { StackAdminApp } from "@stackframe/stack";
import { ALL_APPS } from "@stackframe/stack-shared/dist/apps/apps-config";
import { getRelativePart, isChildUrl } from "@stackframe/stack-shared/dist/utils/urls";
import Image, { StaticImageData } from "next/image";
import ConvexLogo from "../../public/convex-logo.png";
import NeonLogo from "../../public/neon-logo.png";
import VercelLogo from "../../public/vercel-logo.svg";

export type AppId = keyof typeof ALL_APPS;

// Helper to generate screenshot paths
const getScreenshots = (appName: string, count: number): string[] => {
  return Array.from({ length: count }, (_, i) => `/storeDesc-${appName}-${i + 1}.png`);
};

export const DUMMY_ORIGIN = "https://example.com";

type BreadcrumbDefinition = {
  item: string,
  href: string,
}[];

type AppNavigationItem = {
  displayName: string,
  href: string,
  matchPath?: (relativePart: string) => boolean,
  getBreadcrumbItems?: (stackAdminApp: StackAdminApp<false>, relativePart: string) => Promise<BreadcrumbDefinition | null | undefined>,
};

export type AppFrontend = {
  icon: React.FunctionComponent<React.SVGProps<SVGSVGElement>>,
  logo?: React.FunctionComponent<{}>,
  href: string,
  matchPath?: (relativePart: string) => boolean,
  getBreadcrumbItems?: (stackAdminApp: StackAdminApp<false>, relativePart: string) => Promise<BreadcrumbDefinition | null | undefined>,
  navigationItems: AppNavigationItem[],
  screenshots: (string | StaticImageData)[],
  storeDescription: JSX.Element,
};

export function getAppPath(projectId: string, appFrontend: AppFrontend) {
  const url = new URL(appFrontend.href, `${DUMMY_ORIGIN}/projects/${projectId}/`);
  return getRelativePart(url);
}

export function getItemPath(projectId: string, appFrontend: AppFrontend, item: AppFrontend["navigationItems"][number]) {
  const url = new URL(item.href, new URL(appFrontend.href, `${DUMMY_ORIGIN}/projects/${projectId}/`) + "/");
  return getRelativePart(url);
}

export function testAppPath(projectId: string, appFrontend: AppFrontend, fullUrl: URL) {
  if (appFrontend.matchPath) return appFrontend.matchPath(getRelativePart(fullUrl));

  for (const item of appFrontend.navigationItems) {
    if (testItemPath(projectId, appFrontend, item, fullUrl)) return true;
  }
  const url = new URL(appFrontend.href, `${DUMMY_ORIGIN}/projects/${projectId}/`);
  return isChildUrl(url, fullUrl);
}

export function testItemPath(projectId: string, appFrontend: AppFrontend, item: AppFrontend["navigationItems"][number], fullUrl: URL) {
  if (item.matchPath) return item.matchPath(getRelativePart(fullUrl));

  const url = new URL(getItemPath(projectId, appFrontend, item), fullUrl);
  return isChildUrl(url, fullUrl);
}

export const ALL_APPS_FRONTEND = {
  authentication: {
    icon: FingerprintSimpleIcon,
    href: "users",
    navigationItems: [
      { displayName: "Users", href: ".", getBreadcrumbItems: getUserBreadcrumbItems },
      { displayName: "Auth Methods", href: "../auth-methods" },
      { displayName: "Sign-up Rules", href: "../signup-rules" },
      { displayName: "Trusted Domains", href: "../domains" },
    ],
    screenshots: getScreenshots('auth', 6),
    storeDescription: (
      <>
        <p>Authentication centralizes everything you need to operate your Stack Auth user directory.</p>
        <p>Browse and create users, tune sign-up behavior, and configure auth methods without leaving the dashboard.</p>
        <p>When it is time to harden production, manage trusted domains and other guardrails in the same place.</p>
      </>
    ),
  },
  onboarding: {
    icon: ClipboardTextIcon,
    href: "onboarding",
    navigationItems: [
      { displayName: "Onboarding", href: "." },
    ],
    screenshots: [],
    storeDescription: (
      <>
        <p>Onboarding lets you define requirements users must complete before gaining full access.</p>
        <p>Configure email verification and other onboarding steps to ensure users are properly validated.</p>
        <p>Users who haven&apos;t completed onboarding are filtered from normal API responses until they finish the required steps.</p>
      </>
    ),
  },
  teams: {
    icon: UsersIcon,
    href: "teams",
    navigationItems: [
      { displayName: "Teams", href: ".", getBreadcrumbItems: getTeamBreadcrumbItems },
      { displayName: "Team Settings", href: "../team-settings" },
    ],
    screenshots: getScreenshots('teams', 4),
    storeDescription: (
      <>
        <p>Teams gives your project first-class multi-tenancy without extra plumbing.</p>
        <p>Create organizations in seconds, keep their metadata tidy with inline edits, and invite teammates or add existing users while memberships stay in sync.</p>
        <p>Whenever you need deeper context, you can jump straight into team settings, billing, or permissions from the same place.</p>
      </>
    ),
  },
  rbac: {
    icon: UserGearIcon,
    href: "./project-permissions",
    navigationItems: [
      { displayName: "Project Permissions", href: "../project-permissions" },
      { displayName: "Team Permissions", href: "../team-permissions" },
    ],
    screenshots: getScreenshots('rbac', 4),
    storeDescription: (
      <>
        <p>RBAC helps you model the authorization surface of your product in a structured, auditable way.</p>
        <p>Define project and team permissions with IDs that map directly into your code and compose them into higher-level roles.</p>
        <p>The Stack SDK exposes those definitions everywhere so each environment enforces the same checks.</p>
      </>
    ),
  },
  "api-keys": {
    icon: KeyIcon,
    href: "api-keys-app",
    navigationItems: [
      { displayName: "API Keys", href: "." },
    ],
    screenshots: getScreenshots('api-keys', 1),
    storeDescription: (
      <>
        <p>API Keys keeps every environment credentialed without sacrificing control.</p>
        <p>Issue publishable client keys or secret server keys with configurable expirations and copy the values before they disappear.</p>
        <p>When a credential is no longer trusted, revoke or rotate it instantly from the dashboard.</p>
      </>
    ),
  },
  payments: {
    icon: CreditCardIcon,
    href: "payments",
    navigationItems: [
      { displayName: "Product Lines", href: "./product-lines" },
      { displayName: "Products & Items", href: "./products" },
      { displayName: "Customers", href: "./customers" },
      { displayName: "Transactions", href: "./transactions" },
      { displayName: "Payouts", href: "./payouts" },
      { displayName: "Settings", href: "./settings" },
    ],
    screenshots: getScreenshots('payments', 7),
    storeDescription: (
      <>
        <p>Payments brings Stack&apos;s product-first pricing model into the dashboard.</p>
        <p>Design product lines with products, prices, and entitlements, segment user or team customers, and generate checkout URLs with the right guardrails.</p>
        <p>Purchase history and transactions stay visible without leaving the console.</p>
      </>
    ),
  },
  emails: {
    icon: EnvelopeSimpleIcon,
    href: "emails",
    navigationItems: [
      { displayName: "Emails", href: "." },
      { displayName: "Drafts", href: "../email-drafts", getBreadcrumbItems: getEmailDraftBreadcrumbItems },
      { displayName: "Templates", href: "../email-templates", getBreadcrumbItems: getEmailTemplatesBreadcrumbItems },
      { displayName: "Themes", href: "../email-themes", getBreadcrumbItems: getEmailThemeBreadcrumbItems },
    ],
    screenshots: getScreenshots('emails', 8),
    storeDescription: (
      <>
        <p>Emails gives you a full control room for transactional communication.</p>
        <p>Configure shared delivery, Resend, or custom SMTP without touching code, then send test or operational messages whenever you need.</p>
        <p>Draft, templatize, and theme email content so every notification stays on brand while delivery logs remain close by.</p>
      </>
    ),
  },
  "email-api": {
    icon: MailboxIcon,
    href: "email-api",
    navigationItems: [
      { displayName: "Email API", href: "." },
    ],
    screenshots: [],
    storeDescription: (
      <>
        <p>The Email API unlocks programmatic messaging flows directly from the Stack SDK.</p>
        <p>Trigger transactional emails from your server code, reuse the templates and themes you author in the dashboard, and capture delivery results in the same log.</p>
        <p>It is the fastest path from an automation idea to a production-ready notification.</p>
      </>
    ),
  },
  "data-vault": {
    icon: VaultIcon,
    href: "data-vault",
    navigationItems: [
      { displayName: "Data Vault", href: "." },
    ],
    screenshots: getScreenshots('data-vault', 4),
    storeDescription: (
      <>
        <p>Data Vault is an encrypted key-value store for the secrets your app should never expose.</p>
        <p>Create isolated stores for API tokens, recovery codes, or other sensitive values, all protected by your own vault secret.</p>
        <p>Stack only keeps hashed keys and ciphertext, and the SDK ships with examples for reading and writing data safely.</p>
      </>
    ),
  },
  webhooks: {
    icon: WebhooksLogoIcon,
    href: "webhooks",
    navigationItems: [
      { displayName: "Webhooks", href: "." },
    ],
    screenshots: getScreenshots('webhooks', 2),
    storeDescription: (
      <>
        <p>Webhooks keep user and team events in sync between Stack and your own servers.</p>
        <p>Create and manage Svix-powered endpoints without leaving the dashboard, edit descriptions as your integrations evolve, and retire endpoints safely when they are no longer needed.</p>
        <p>Every notification keeps billing, analytics, and downstream services in sync.</p>
      </>
    ),
  },
  "tv-mode": {
    icon: TelevisionSimpleIcon,
    href: "tv-mode",
    navigationItems: [
      { displayName: "TV mode", href: "." },
    ],
    screenshots: [],
    storeDescription: <></>,
  },
  "launch-checklist": {
    icon: RocketIcon,
    href: "launch-checklist",
    navigationItems: [
      { displayName: "Launch Checklist", href: "." },
    ],
    screenshots: [],
    storeDescription: (
      <>
        <p>The Launch Checklist keeps your go-live to-dos inside the product.</p>
        <p>Track implementation progress across the tasks that matter, follow guided instructions for each requirement, and keep teammates aligned as you move from sandbox to production.</p>
        <p>It becomes the shared source of truth when launch day approaches.</p>
      </>
    ),
  },
  catalyst: {
    icon: SparkleIcon,
    href: "catalyst",
    navigationItems: [
      { displayName: "Catalyst", href: "." },
    ],
    screenshots: [],
    storeDescription: <></>,
  },
  neon: {
    icon: createSvgIcon(() => <>
      <path
        d="M 21.9999 3.6667 L 21.9999 16.1666 A 1.6667 1.6667 90 0 1 20.3333 17.8333 A 2.5 2.5 90 0 1 18.6666 16.9999 L 12.8333 10.3333 L 12.8333 20.3333 A 1.6667 1.6667 90 0 1 11.1666 21.9999 L 3.6667 21.9999 A 1.6667 1.6667 90 0 1 2 20.3333 L 2 3.6667 A 1.6667 1.6667 90 0 1 3.6667 2 L 20.3333 2 A 1.6667 1.6667 90 0 1 21.9999 3.6667 Z"
      />
    </>),
    logo: () => <Image src={NeonLogo} alt="Neon logo" />,
    href: "neon",
    navigationItems: [
      { displayName: "Neon Integration", href: "." },
    ],
    screenshots: [],
    storeDescription: <></>,
  },
  convex: {
    icon: createSvgIcon(() => <>
      <path d="M14.099 16.959c2.369 -0.263 4.603 -1.526 5.833 -3.633 -0.583 5.212 -6.282 8.507 -10.934 6.484 -0.429 -0.186 -0.798 -0.495 -1.051 -0.893 -1.046 -1.642 -1.389 -3.731 -0.895 -5.626 1.411 2.435 4.28 3.928 7.047 3.668" />
      <path d="M6.965 11.762c-0.961 2.219 -1.002 4.818 0.175 6.957 -4.144 -3.118 -4.099 -9.789 -0.051 -12.876 0.374 -0.285 0.819 -0.455 1.286 -0.48 1.919 -0.101 3.869 0.64 5.236 2.023 -2.778 0.028 -5.484 1.807 -6.647 4.377" />
      <path d="M14.953 8.068C13.551 6.113 11.357 4.783 8.953 4.742c4.647 -2.109 10.363 1.31 10.985 6.366 0.058 0.469 -0.018 0.948 -0.226 1.371 -0.868 1.763 -2.478 3.131 -4.359 3.637 1.378 -2.556 1.208 -5.68 -0.4 -8.048" />
    </>),
    logo: () => <Image src={ConvexLogo} alt="Convex logo" />,
    href: "convex",
    navigationItems: [
      { displayName: "Convex Integration", href: "." },
    ],
    screenshots: [],
    storeDescription: <></>,
  },
  vercel: {
    icon: TriangleIcon,
    logo: () => <div className="w-full h-full flex items-center justify-center">
      <Image src={VercelLogo} alt="Vercel logo" className="bg-white invert w-full h-full object-contain p-2" />
    </div>,
    href: "vercel",
    navigationItems: [
      { displayName: "Setup", href: "." },
    ],
    screenshots: getScreenshots('vercel', 2),
    storeDescription: <>Deploy your Stack Auth project to <Link href="https://vercel.com" target="_blank">Vercel</Link> with the Vercel x Stack Auth integration.</>,
  },
} as const satisfies Record<AppId, AppFrontend>;

function createSvgIcon(ChildrenComponent: () => React.ReactNode): (props: any) => React.ReactNode {
  const Result = (props: any) => (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
      {...props}
    >
      <ChildrenComponent />
    </svg>
  );
  Result.displayName = `SvgIcon(${ChildrenComponent.name})`;
  return Result;
}

async function getEmailTemplatesBreadcrumbItems(stackAdminApp: StackAdminApp<false>, relativePart: string) {
  const normalized = relativePart || "/";
  const baseCrumbs = [{ item: "Templates", href: "." }];
  if (normalized === "/" || normalized === "") {
    return baseCrumbs;
  }

  const match = normalized.match(/^\/([^/]+)(?:\/.*)?$/);
  if (!match) {
    return baseCrumbs;
  }

  const templateId = decodeURIComponent(match[1]);
  const templates = await stackAdminApp.listEmailTemplates();
  const template = templates.find(({ id }) => id === templateId);
  if (!template) {
    return baseCrumbs;
  }

  return [
    ...baseCrumbs,
    {
      item: template.displayName,
      href: `./${encodeURIComponent(template.id)}`,
    },
  ];
}

async function getUserBreadcrumbItems(stackAdminApp: StackAdminApp<false>, relativePart: string) {
  const baseCrumbs = [{ item: "Users", href: "." }];
  const match = relativePart.match(/^\/([^/]+)(?:\/.*)?$/);
  if (!match) {
    return baseCrumbs;
  }

  const userId = decodeURIComponent(match[1]);
  const user = await stackAdminApp.getUser(userId);
  if (!user) {
    return baseCrumbs;
  }

  return [
    ...baseCrumbs,
    {
      item: user.displayName ?? user.primaryEmail ?? user.id,
      href: `./${encodeURIComponent(user.id)}`,
    },
  ];
}

async function getTeamBreadcrumbItems(stackAdminApp: StackAdminApp<false>, relativePart: string) {
  const baseCrumbs = [{ item: "Teams", href: "." }];
  const match = relativePart.match(/^\/([^/]+)(?:\/.*)?$/);
  if (!match) {
    return baseCrumbs;
  }

  const teamId = decodeURIComponent(match[1]);
  const team = await stackAdminApp.getTeam(teamId);
  if (!team) {
    return baseCrumbs;
  }

  return [
    ...baseCrumbs,
    {
      item: team.displayName,
      href: `./${encodeURIComponent(team.id)}`,
    },
  ];
}


async function getEmailDraftBreadcrumbItems(stackAdminApp: StackAdminApp<false>, relativePart: string) {
  const baseCrumbs = [{ item: "Drafts", href: "." }];
  const match = relativePart.match(/^\/([^/]+)(?:\/.*)?$/);
  if (!match) {
    return baseCrumbs;
  }

  const draftId = decodeURIComponent(match[1]);
  const drafts = await stackAdminApp.listEmailDrafts();
  const draft = drafts.find(({ id }) => id === draftId);
  if (!draft) {
    return baseCrumbs;
  }

  return [
    ...baseCrumbs,
    {
      item: draft.displayName,
      href: `./${encodeURIComponent(draft.id)}`,
    },
  ];
}

async function getEmailThemeBreadcrumbItems(stackAdminApp: StackAdminApp<false>, relativePart: string) {
  const baseCrumbs = [{ item: "Themes", href: "." }];
  const match = relativePart.match(/^\/([^/]+)(?:\/.*)?$/);
  if (!match) {
    return baseCrumbs;
  }

  const themeId = decodeURIComponent(match[1]);
  const themes = await stackAdminApp.listEmailThemes();
  const theme = themes.find(({ id }) => id === themeId);
  if (!theme) {
    return baseCrumbs;
  }

  return [
    ...baseCrumbs,
    {
      item: theme.displayName,
      href: `./${encodeURIComponent(theme.id)}`,
    },
  ];
}
