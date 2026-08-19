'use client';

import { Typography } from "@/components/ui";
import { getPublicEnvVar } from "@/lib/env";

import { DashboardUserButton } from "./dashboard-user-button";
import { Link } from "./link";
import { Logo } from "./logo";
import ThemeToggle from "./theme-toggle";

export function Navbar({ ...props }) {
  const isRemoteDevelopmentEnvironment = getPublicEnvVar("NEXT_PUBLIC_STACK_IS_REMOTE_DEVELOPMENT_ENVIRONMENT") === "true";
  // In preview mode the dashboard is embedded on the marketing site; the external
  // Docs link would navigate the iframe away, so hide it there.
  const isPreview = getPublicEnvVar("NEXT_PUBLIC_STACK_IS_PREVIEW") === "true";

  return (
    <header
      className={`sticky top-0 z-30 flex items-center justify-between border-b border-black/[0.06] dark:border-white/[0.06] backdrop-blur-xl bg-white/45 dark:bg-black/20 px-4 shrink-0 ${props.className || ""}`}
      style={{ height: `50px` }}
    >
      <div className="flex items-center justify-center">
        <Logo full height={24} href="/projects" className="h-6" />
      </div>
      <div className="flex items-center">
        <div className="flex gap-4 mr-4 items-center">
          {!isPreview && (
            <Link href="https://docs.hexclave.com/">
              <Typography type='label'>Docs</Typography>
            </Link>
          )}
          <ThemeToggle />
        </div>
        {!isRemoteDevelopmentEnvironment && <DashboardUserButton />}
      </div>
    </header>
  );
}
