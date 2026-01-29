'use client';

import { ALL_APPS, AppId } from "@stackframe/stack-shared/dist/apps/apps-config";
import { AppIcon, appSquarePaddingExpression, appSquareWidthExpression } from "@stackframe/stack-shared/dist/apps/apps-ui";
import { ChartLineIcon, ClipboardList, CreditCard, KeyRound, Mail, Mails, Rocket, ShieldEllipsis, Sparkles, Triangle, Tv, UserCog, Users, Vault, Webhook } from "lucide-react";
import Link from "next/link";
import { cn } from "../../lib/cn";

// URL overrides for apps where the file name differs from the appId
const APP_URL_OVERRIDES: Partial<Record<AppId, string>> = {
  teams: '/docs/apps/orgs-and-teams',
  rbac: '/docs/apps/permissions',
};

// Icon mapping for docs (no Next.js Image dependencies)
const APP_ICONS: Record<AppId, React.FunctionComponent<React.SVGProps<SVGSVGElement>>> = {
  authentication: ShieldEllipsis,
  teams: Users,
  rbac: UserCog,
  "api-keys": KeyRound,
  payments: CreditCard,
  emails: Mail,
  "email-api": Mails,
  "data-vault": Vault,
  webhooks: Webhook,
  "tv-mode": Tv,
  "launch-checklist": Rocket,
  catalyst: Sparkles,
  neon: createSvgIcon(() => (
    <path d="M 21.9999 3.6667 L 21.9999 16.1666 A 1.6667 1.6667 90 0 1 20.3333 17.8333 A 2.5 2.5 90 0 1 18.6666 16.9999 L 12.8333 10.3333 L 12.8333 20.3333 A 1.6667 1.6667 90 0 1 11.1666 21.9999 L 3.6667 21.9999 A 1.6667 1.6667 90 0 1 2 20.3333 L 2 3.6667 A 1.6667 1.6667 90 0 1 3.6667 2 L 20.3333 2 A 1.6667 1.6667 90 0 1 21.9999 3.6667 Z" />
  )),
  convex: createSvgIcon(() => (
    <>
      <path d="M14.099 16.959c2.369 -0.263 4.603 -1.526 5.833 -3.633 -0.583 5.212 -6.282 8.507 -10.934 6.484 -0.429 -0.186 -0.798 -0.495 -1.051 -0.893 -1.046 -1.642 -1.389 -3.731 -0.895 -5.626 1.411 2.435 4.28 3.928 7.047 3.668" />
      <path d="M6.965 11.762c-0.961 2.219 -1.002 4.818 0.175 6.957 -4.144 -3.118 -4.099 -9.789 -0.051 -12.876 0.374 -0.285 0.819 -0.455 1.286 -0.48 1.919 -0.101 3.869 0.64 5.236 2.023 -2.778 0.028 -5.484 1.807 -6.647 4.377" />
      <path d="M14.953 8.068C13.551 6.113 11.357 4.783 8.953 4.742c4.647 -2.109 10.363 1.31 10.985 6.366 0.058 0.469 -0.018 0.948 -0.226 1.371 -0.868 1.763 -2.478 3.131 -4.359 3.637 1.378 -2.556 1.208 -5.68 -0.4 -8.048" />
    </>
  )),
  vercel: Triangle,
  analytics: ChartLineIcon,
  onboarding: ClipboardList,
};

function createSvgIcon(ChildrenComponent: () => React.ReactNode): (props: React.SVGProps<SVGSVGElement>) => React.ReactNode {
  const Result = (props: React.SVGProps<SVGSVGElement>) => (
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

/**
 * Single App Card - displays one app with its icon
 */
export function AppCard({ appId, href }: {
  appId: AppId,
  href?: string,
}) {
  const app = ALL_APPS[appId];
  const IconComponent = APP_ICONS[appId];
  const linkHref = href || APP_URL_OVERRIDES[appId] || `/docs/apps/${appId}`;

  return (
    <Link
      href={linkHref}
      className={cn(
        "flex flex-col items-center gap-2 transition-all duration-200 cursor-pointer group select-none",
        "p-2 rounded-lg",
        "hover:bg-fd-accent/50 hover:duration-0",
      )}
      style={{
        padding: appSquarePaddingExpression,
      }}
    >
      <AppIcon
        appId={appId}
        IconComponent={IconComponent}
        disabled={false}
        style={{
          width: `calc(${appSquareWidthExpression} - 2 * ${appSquarePaddingExpression})`,
          height: `calc(${appSquareWidthExpression} - 2 * ${appSquarePaddingExpression})`,
        }}
        className="shadow-md"
        cn={cn}
      />
      <span className="text-xs lg:text-sm text-center max-w-20 sm:max-w-28 md:max-w-32 lg:max-w-36 truncate select-none text-fd-foreground">
        {app.displayName}
      </span>
    </Link>
  );
}

/**
 * App Grid - displays multiple apps in a grid
 */
export function AppGrid({ appIds, className }: {
  appIds: AppId[],
  className?: string,
}) {
  return (
    <div className="max-w-3xl mx-auto">
      <div className={cn("flex gap-1 lg:gap-8 flex-wrap justify-center", className)}>
        {appIds.map(appId => (
          <AppCard key={appId} appId={appId} />
        ))}
      </div>
    </div>
  );
}

