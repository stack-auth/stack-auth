import { AppId } from "@stackframe/stack-shared/dist/apps/apps-config";
import { getRelativePart, isChildUrl } from "@stackframe/stack-shared/dist/utils/urls";
import { CreditCard, KeyRound, Mail, Mails, Rocket, ShieldEllipsis, Sparkles, Tv, UserCog, Users, Vault, Webhook, Workflow } from "lucide-react";
import Image from "next/image";
import ConvexLogo from "../../public/convex-logo.png";
import LogoBright from "../../public/logo-bright.svg";
import NeonLogo from "../../public/neon-logo.png";
import OpenGraphImage from "../../public/open-graph-image.png";

export type AppFrontend = {
  icon: React.FunctionComponent<React.SVGProps<SVGSVGElement>>,
  logo?: React.FunctionComponent<{ className?: string }>,
  href: string,
  matchPath?: (relativePart: string) => boolean,
  getBreadcrumbItems?: (relativePart: string) => {
    item: string,
    href: string,
  }[] | null,
  navigationItems: {
    displayName: string,
    href: string,
    matchPath?: (relativePart: string) => boolean,
    getBreadcrumbItems?: (relativePart: string) => {
      item: string,
      href: string,
    }[] | null,
  }[],
  screenshots: string[],
  storeDescription: React.ReactNode,
};

export function getAppPath(projectId: string, appFrontend: AppFrontend) {
  const url = new URL(appFrontend.href, `https://example.com/projects/${projectId}/`);
  return getRelativePart(url);
}

export function getItemPath(projectId: string, appFrontend: AppFrontend, item: AppFrontend["navigationItems"][number]) {
  const url = new URL(item.href, new URL(appFrontend.href, `https://example.com/projects/${projectId}/`) + "/");
  return getRelativePart(url);
}

export function testAppPath(projectId: string, appFrontend: AppFrontend, fullUrl: URL) {
  if (appFrontend.matchPath) return appFrontend.matchPath(getRelativePart(fullUrl));

  for (const item of appFrontend.navigationItems) {
    if (testItemPath(projectId, appFrontend, item, fullUrl)) return true;
  }
  const url = new URL(appFrontend.href, `https://example.com/projects/${projectId}/`);
  return isChildUrl(url, fullUrl);
}

export function testItemPath(projectId: string, appFrontend: AppFrontend, item: AppFrontend["navigationItems"][number], fullUrl: URL) {
  if (item.matchPath) return item.matchPath(getRelativePart(fullUrl));

  const url = new URL(getItemPath(projectId, appFrontend, item), fullUrl);
  return isChildUrl(url, fullUrl);
}

export const ALL_APPS_FRONTEND = {
  authentication: {
    icon: ShieldEllipsis,
    href: "./users",
    navigationItems: [
      { displayName: "Users", href: "." },
      { displayName: "Auth Methods", href: "../auth-methods" },
      { displayName: "Project Permissions", href: "../project-permissions" },
    ],
    screenshots: [
      LogoBright,
      OpenGraphImage,
    ],
    getBreadcrumbItems: (relativePart: string) => [],
    storeDescription: <></>,
  },
  teams: {
    icon: Users,
    href: "./teams",
    navigationItems: [
      { displayName: "Teams", href: "./teams" },
      { displayName: "Team Permissions", href: "../team-permissions" },
      { displayName: "Team Settings", href: "../team-settings" },
    ],
    screenshots: [],
    storeDescription: <></>,
  },
  rbac: {
    icon: UserCog,
    href: "./rbac",
    navigationItems: [
      { displayName: "RBAC", href: "." },
    ],
    screenshots: [],
    storeDescription: <></>,
  },
  "api-keys": {
    icon: KeyRound,
    href: "/api-keys",
    navigationItems: [
      { displayName: "API Keys", href: "/api-keys" },
    ],
    screenshots: [],
    storeDescription: <></>,
  },
  payments: {
    icon: CreditCard,
    href: "/payments",
    navigationItems: [
      { displayName: "Payments", href: "/payments" },
    ],
    screenshots: [],
    storeDescription: "",
  },
  emails: {
    icon: Mail,
    href: "/emails",
    navigationItems: [
      { displayName: "Emails", href: "/emails" },
    ],
    screenshots: [],
    storeDescription: <></>,
  },
  "email-api": {
    icon: Mails,
    href: "/email-api",
    navigationItems: [
      { displayName: "Email API", href: "/email-api" },
    ],
    screenshots: [],
    storeDescription: <></>,
  },
  "data-vault": {
    icon: Vault,
    href: "/data-vault",
    navigationItems: [
      { displayName: "Data Vault", href: "/data-vault" },
    ],
    screenshots: [],
    storeDescription: <></>,
  },
  workflows: {
    icon: Workflow,
    href: "/workflows",
    navigationItems: [
      { displayName: "Workflows", href: "/workflows" },
    ],
    screenshots: [],
    storeDescription: <></>,
  },
  webhooks: {
    icon: Webhook,
    href: "/webhooks",
    navigationItems: [
      { displayName: "Webhooks", href: "/webhooks" },
    ],
    screenshots: [],
    storeDescription: <></>,
  },
  "tv-mode": {
    icon: Tv,
    href: "/tv-mode",
    navigationItems: [
      { displayName: "TV mode", href: "/tv-mode" },
    ],
    screenshots: [],
    storeDescription: <></>,
  },
  "launch-checklist": {
    icon: Rocket,
    href: "/launch-checklist",
    navigationItems: [
      { displayName: "Launch Checklist", href: "/launch-checklist" },
    ],
    screenshots: [],
    storeDescription: <></>,
  },
  catalyst: {
    icon: Sparkles,
    href: "/catalyst",
    navigationItems: [
      { displayName: "Catalyst", href: "/catalyst" },
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
    logo: (props: any) => <Image src={NeonLogo} alt="Neon logo" {...props} />,
    href: "/neon",
    navigationItems: [
      { displayName: "Neon", href: "/neon" },
    ],
    screenshots: [],
    storeDescription: <></>,
  },
  convex: {
    icon: createSvgIcon(() => <>
      <path d="M14.099 16.959c2.369 -0.263 4.603 -1.526 5.833 -3.633 -0.583 5.212 -6.282 8.507 -10.934 6.484 -0.429 -0.186 -0.798 -0.495 -1.051 -0.893 -1.046 -1.642 -1.389 -3.731 -0.895 -5.626 1.411 2.435 4.28 3.928 7.047 3.668"/>
      <path d="M6.965 11.762c-0.961 2.219 -1.002 4.818 0.175 6.957 -4.144 -3.118 -4.099 -9.789 -0.051 -12.876 0.374 -0.285 0.819 -0.455 1.286 -0.48 1.919 -0.101 3.869 0.64 5.236 2.023 -2.778 0.028 -5.484 1.807 -6.647 4.377"/>
      <path d="M14.953 8.068C13.551 6.113 11.357 4.783 8.953 4.742c4.647 -2.109 10.363 1.31 10.985 6.366 0.058 0.469 -0.018 0.948 -0.226 1.371 -0.868 1.763 -2.478 3.131 -4.359 3.637 1.378 -2.556 1.208 -5.68 -0.4 -8.048"/>
    </>),
    logo: (props: any) => <Image src={ConvexLogo} alt="Convex logo" {...props} />,
    href: "/convex",
    navigationItems: [
      { displayName: "Convex", href: "/convex" },
    ],
    screenshots: [],
    storeDescription: <></>,
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
