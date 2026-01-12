"use client";

import { EmailVerificationSetting } from "@/components/email-verification-setting";
import { SettingCard } from "@/components/settings";
import { Typography } from "@/components/ui";
import { AppEnabledGuard } from "../app-enabled-guard";
import { PageLayout } from "../page-layout";

export default function PageClient() {
  return (
    <AppEnabledGuard appId="onboarding">
      <PageLayout title="Onboarding">
        <SettingCard
          title="Email Verification Requirement"
          description="Control whether users must verify their email to complete onboarding."
        >
          <EmailVerificationSetting />
          <Typography variant="secondary" type="footnote">
            When enabled, users who haven&apos;t verified their primary email will need to complete onboarding first.
            Users with pending onboarding are filtered out by default when listing users, and will be redirected
            to complete email verification when using the SDK with redirect options.
          </Typography>
        </SettingCard>
      </PageLayout>
    </AppEnabledGuard>
  );
}
