'use client';

import { useRouter } from "@/components/router";
import { AppId } from "@stackframe/stack-shared/dist/apps/apps-config";
import { Typography } from "@stackframe/stack-ui";
import type { ReactNode } from "react";
import { useEffect } from "react";
import { PageLayout } from "./page-layout";
import { useAdminApp } from "./use-admin-app";

export function AppEnabledGuard(props: { appId: AppId, children: ReactNode }) {
  const router = useRouter();
  const adminApp = useAdminApp();
  const project = adminApp.useProject();
  const config = project.useConfig();
  const isEnabled = config.apps.installed[props.appId]?.enabled;

  useEffect(() => {
    if (!isEnabled) {
      router.replace(`/projects/${project.id}/apps/${props.appId}`);
    }
  }, [isEnabled, project.id, props.appId, router]);

  if (!isEnabled) {
    return (
      <PageLayout>
        <div className="rounded-lg border border-dashed border-border bg-muted/20 p-6 text-center">
          <Typography className="font-medium">
            App is not enabled
          </Typography>
        </div>
      </PageLayout>
    );
  }

  return <>{props.children}</>;
}
