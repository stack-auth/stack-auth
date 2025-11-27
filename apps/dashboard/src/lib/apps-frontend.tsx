import { Link } from "@/components/link";
import { CreditCardIcon, EnvelopeSimpleIcon, FingerprintSimpleIcon, KeyIcon, MailboxIcon, RocketIcon, SparkleIcon, TelevisionSimpleIcon, UserGearIcon, UsersIcon, VaultIcon, WebhooksLogoIcon } from "@phosphor-icons/react/dist/ssr";
import { StackAdminApp } from "@stackframe/stack";
import { ALL_APPS } from "@stackframe/stack-shared/dist/apps/apps-config";
import { getRelativePart, isChildUrl } from "@stackframe/stack-shared/dist/utils/urls";
import LogoBright from "../../public/logo-bright.svg";
import OpenGraphImage from "../../public/open-graph-image.png";
import { ConvexIcon } from "./icons/convex";
import { NeonIcon } from "./icons/neon";
import { VercelIcon } from "./icons/vercel";

export type AppId = keyof typeof ALL_APPS;

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
  screenshots: string[],
  storeDescription: React.ReactNode,
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
      { displayName: "Trusted Domains", href: "../domains" },
    ],
    screenshots: [
      LogoBright,
      OpenGraphImage,
    ],
    storeDescription: <></>,
  },
  teams: {
    icon: UsersIcon,
    href: "teams",
    navigationItems: [
      { displayName: "Teams", href: ".", getBreadcrumbItems: getTeamBreadcrumbItems },
      { displayName: "Team Settings", href: "../team-settings" },
    ],
    screenshots: [],
    storeDescription: <></>,
  },
  rbac: {
    icon: UserGearIcon,
    href: "./project-permissions",
    navigationItems: [
      { displayName: "Project Permissions", href: "../project-permissions" },
      { displayName: "Team Permissions", href: "../team-permissions" },
    ],
    screenshots: [],
    storeDescription: <></>,
  },
  "api-keys": {
    icon: KeyIcon,
    href: "api-keys-app",
    navigationItems: [
      { displayName: "API Keys", href: "." },
    ],
    screenshots: [],
    storeDescription: <></>,
  },
  payments: {
    icon: CreditCardIcon,
    href: "payments",
    navigationItems: [
      { displayName: "Products", href: "./products" },
      { displayName: "Customers", href: "./customers" },
      { displayName: "Transactions", href: "./transactions" },
    ],
    screenshots: [],
    storeDescription: "",
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
    screenshots: [],
    storeDescription: <></>,
  },
  "email-api": {
    icon: MailboxIcon,
    href: "email-api",
    navigationItems: [
      { displayName: "Email API", href: "." },
    ],
    screenshots: [],
    storeDescription: <></>,
  },
  "data-vault": {
    icon: VaultIcon,
    href: "data-vault",
    navigationItems: [
      { displayName: "Data Vault", href: "." },
    ],
    screenshots: [],
    storeDescription: <></>,
  },
  webhooks: {
    icon: WebhooksLogoIcon,
    href: "webhooks",
    navigationItems: [
      { displayName: "Webhooks", href: "." },
    ],
    screenshots: [],
    storeDescription: <></>,
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
    storeDescription: <></>,
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
    icon: NeonIcon,
    href: "neon",
    navigationItems: [
      { displayName: "Neon Integration", href: "." },
    ],
    screenshots: [],
    storeDescription: <></>,
  },
  convex: {
    icon: ConvexIcon,
    href: "convex",
    navigationItems: [
      { displayName: "Convex Integration", href: "." },
    ],
    screenshots: [],
    storeDescription: <></>,
  },
  vercel: {
    icon: VercelIcon,
    href: "vercel",
    navigationItems: [
      { displayName: "Setup", href: "." },
    ],
    screenshots: [],
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
