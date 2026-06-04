"use client";

import { AppEnabledGuard } from "../app-enabled-guard";
import { PageLayout } from "../page-layout";
import { DomainSettings } from "./domain-settings";
import { ThemeSettings } from "./theme-settings";

/**
 * @dashboardReference emails/email-settings
 * @dashboardReferenceDescription SMTP delivery, managed domains, and email themes.
 *
 * ## Theme settings (`ThemeSettings`)
 *
 * Pick the active email theme, preview rendered HTML at miniature scale, and open **email-themes** to edit layouts. Themes apply to templates and programmatic sends.
 *
 * ## Domain settings (`DomainSettings`)
 *
 * Configure delivery backend:
 *
 * - **Shared** / **Managed** / **Resend** / **Custom SMTP**
 * - Managed domains: DNS records, verification status, sender local part
 * - Test send, copy DNS records, download zone file helpers
 *
 * Saving updates `config.emails.server` via deferred dialogs and config push.
 */

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
