'use client';

import { DesignBadge, DesignCard } from "@/components/design-components";
import { Typography } from "@/components/ui";
import { ALL_APPS, type AppId } from "@hexclave/shared/dist/apps/apps-config";
import type { ReactNode } from "react";
import { AppEnabledGuard } from "./app-enabled-guard";
import { PageLayout } from "./page-layout";

/**
 * Placeholder page for apps that are registered (so they appear in the app
 * store and sidebar) but whose full UI hasn't been built yet. Without this the
 * sidebar links to a route that has no `page.tsx`, which 404s. Title/subtitle
 * are pulled from `ALL_APPS` so the placeholder stays in sync with the registry.
 */
export function ComingSoonApp({ appId, children }: { appId: AppId, children?: ReactNode }) {
  const app = ALL_APPS[appId];

  return (
    <AppEnabledGuard appId={appId}>
      <PageLayout title={app.displayName} description={app.subtitle}>
        <DesignCard glassmorphic gradient="default" contentClassName="p-10">
          <div className="flex flex-col items-center gap-3 text-center">
            <DesignBadge label="Coming soon" color="purple" />
            <Typography type="h3" className="tracking-tight">
              {app.displayName} is on the way
            </Typography>
            <Typography variant="secondary" className="max-w-md">
              We&apos;re still building this app. It&apos;s enabled for your project, but there&apos;s
              nothing to configure here just yet — check back soon.
            </Typography>
            {children}
          </div>
        </DesignCard>
      </PageLayout>
    </AppEnabledGuard>
  );
}
