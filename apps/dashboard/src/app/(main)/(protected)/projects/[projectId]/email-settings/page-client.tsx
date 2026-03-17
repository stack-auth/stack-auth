"use client";

import { AppEnabledGuard } from "../app-enabled-guard";
import { PageLayout } from "../page-layout";
import { DomainSettings } from "./domain-settings";
import { ThemeSettings } from "./theme-settings";

export default function PageClient() {
  return (
    <AppEnabledGuard appId="emails">
      <PageLayout
        title="Email Settings"
        description="Configure email server and themes"
      >
        <div className="space-y-6">
          <ThemeSettings />
          <DomainSettings />
        </div>
      </PageLayout>
    </AppEnabledGuard>
  );
}
