import { AppId } from "@stackframe/stack-shared/dist/apps/apps-config";
import { getRelativePart } from "@stackframe/stack-shared/dist/utils/urls";
import { LucideIcon, Newspaper, ShieldEllipsis, Users } from "lucide-react";
import LogoBright from "../../public/logo-bright.svg";
import OpenGraphImage from "../../public/open-graph-image.png";

type AppFrontend = {
  icon: LucideIcon,
  href: string,
  matchPath?: (pathname: string) => boolean,
  navigationItems: {
    displayName: string,
    href: string,
    matchPath?: (pathname: string) => boolean,
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
    icon: Newspaper,
    href: "./rbac",
    navigationItems: [
      { displayName: "RBAC", href: "." },
    ],
    screenshots: [],
    storeDescription: <></>,
  },
  "api-keys": {
    icon: ShieldEllipsis,
    href: "/api-keys",
    navigationItems: [
      { displayName: "API Keys", href: "/api-keys" },
    ],
    screenshots: [],
    storeDescription: <></>,
  },
  payments: {
    icon: ShieldEllipsis,
    href: "/payments",
    navigationItems: [
      { displayName: "Payments", href: "/payments" },
    ],
    screenshots: [],
    storeDescription: "",
  },
  emails: {
    icon: ShieldEllipsis,
    href: "/emails",
    navigationItems: [
      { displayName: "Emails", href: "/emails" },
    ],
    screenshots: [],
    storeDescription: <></>,
  },
  "email-api": {
    icon: ShieldEllipsis,
    href: "/email-api",
    navigationItems: [
      { displayName: "Email API", href: "/email-api" },
    ],
    screenshots: [],
    storeDescription: <></>,
  },
  "data-vault": {
    icon: ShieldEllipsis,
    href: "/data-vault",
    navigationItems: [
      { displayName: "Data Vault", href: "/data-vault" },
    ],
    screenshots: [],
    storeDescription: <></>,
  },
  workflows: {
    icon: ShieldEllipsis,
    href: "/workflows",
    navigationItems: [
      { displayName: "Workflows", href: "/workflows" },
    ],
    screenshots: [],
    storeDescription: <></>,
  },
  webhooks: {
    icon: ShieldEllipsis,
    href: "/webhooks",
    navigationItems: [
      { displayName: "Webhooks", href: "/webhooks" },
    ],
    screenshots: [],
    storeDescription: <></>,
  },
  "tv-mode": {
    icon: ShieldEllipsis,
    href: "/tv-mode",
    navigationItems: [
      { displayName: "TV mode", href: "/tv-mode" },
    ],
    screenshots: [],
    storeDescription: <></>,
  },
  "launch-checklist": {
    icon: ShieldEllipsis,
    href: "/launch-checklist",
    navigationItems: [
      { displayName: "Launch Checklist", href: "/launch-checklist" },
    ],
    screenshots: [],
    storeDescription: <></>,
  },
  catalyst: {
    icon: ShieldEllipsis,
    href: "/catalyst",
    navigationItems: [
      { displayName: "Catalyst", href: "/catalyst" },
    ],
    screenshots: [],
    storeDescription: <></>,
  },
  neon: {
    icon: ShieldEllipsis,
    href: "/neon",
    navigationItems: [
      { displayName: "Neon", href: "/neon" },
    ],
    screenshots: [],
    storeDescription: <></>,
  },
  convex: {
    icon: ShieldEllipsis,
    href: "/convex",
    navigationItems: [
      { displayName: "Convex", href: "/convex" },
    ],
    screenshots: [],
    storeDescription: <></>,
  },
} as const satisfies Record<AppId, AppFrontend>;
