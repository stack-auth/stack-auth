"use client";

import { AppEnabledGuard } from "../app-enabled-guard";
import { PageLayout } from "../page-layout";

export default function PageClient() {
  return (
    <AppEnabledGuard appId="emails">
      <PageLayout
        title="Email Settings"
        description="Configure email server and themes"
      >
        {/* Email server settings and themes will go here */}
      </PageLayout>
    </AppEnabledGuard>
  );
}
