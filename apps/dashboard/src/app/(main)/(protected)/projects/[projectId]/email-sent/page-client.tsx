"use client";

import { AppEnabledGuard } from "../app-enabled-guard";
import { PageLayout } from "../page-layout";

export default function PageClient() {
  return (
    <AppEnabledGuard appId="emails">
      <PageLayout
        title="Sent"
        description="View email logs and domain reputation"
      >
        {/* Email log and domain reputation will go here */}
      </PageLayout>
    </AppEnabledGuard>
  );
}
