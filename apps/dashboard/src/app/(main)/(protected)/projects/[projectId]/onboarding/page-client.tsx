"use client";

import { useAdminApp } from "@/app/(main)/(protected)/projects/[projectId]/use-admin-app";
import { DesignBadge } from "@/components/design-components/badge";
import { DesignCard } from "@/components/design-components/card";
import { ActionDialog, Spinner, Switch } from "@/components/ui";
import { useUpdateConfig } from "@/lib/config-update";
import { ShieldCheck } from "@phosphor-icons/react";
import type { RestrictedReason } from "@stackframe/stack-shared/dist/schema-fields";
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { useState } from "react";
import { AppEnabledGuard } from "../app-enabled-guard";
import { PageLayout } from "../page-layout";

type AffectedUser = {
  id: string,
  displayName: string | null,
  primaryEmail: string | null,
  restrictedReason: RestrictedReason,
};

type PendingChange = {
  title: string,
  description: string,
  affectedUsers: AffectedUser[],
  totalAffectedCount: number,
  onConfirm: () => Promise<void>,
};

export default function PageClient() {
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const projectConfig = project.useConfig();
  const updateConfig = useUpdateConfig();
  const [pendingChange, setPendingChange] = useState<PendingChange | null>(null);
  const [isToggling, setIsToggling] = useState(false);
  const isEnabled = projectConfig.onboarding.requireEmailVerification;

  const handleEmailVerificationChange = async (checked: boolean) => {
    setIsToggling(true);
    try {
      // If enabling email verification, check for affected users first
      if (checked && !projectConfig.onboarding.requireEmailVerification) {
        // any cast needed: previewAffectedUsersByOnboardingChange is a dynamically-typed admin API method
        const preview = await (stackAdminApp as any).previewAffectedUsersByOnboardingChange(
          { requireEmailVerification: true },
          10,
        );

        if (preview.totalAffectedCount > 0) {
          setPendingChange({
            title: "Enable email verification requirement",
            description: `This change will require ${preview.totalAffectedCount} user${preview.totalAffectedCount === 1 ? '' : 's'} to verify their email before they can continue using your application. They will be prompted to do so the next time they visit your application.`,
            affectedUsers: preview.affectedUsers,
            totalAffectedCount: preview.totalAffectedCount,
            onConfirm: async () => {
              await updateConfig({
                adminApp: stackAdminApp,
                configUpdate: { "onboarding.requireEmailVerification": true },
                pushable: true,
              });
              setPendingChange(null);
            },
          });
          return;
        }
      }

      // No affected users or disabling — apply directly
      await updateConfig({
        adminApp: stackAdminApp,
        configUpdate: { "onboarding.requireEmailVerification": checked },
        pushable: true,
      });
    } finally {
      setIsToggling(false);
    }
  };

  return (
    <AppEnabledGuard appId="onboarding">
      <PageLayout title="Onboarding">
        <DesignCard gradient="default" glassmorphic>
          <div className="flex flex-col gap-4">
            {/* Header row: icon + title + badge + switch */}
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-2 min-w-0">
                <div className="p-1.5 rounded-lg bg-foreground/[0.06] dark:bg-foreground/[0.04]">
                  <ShieldCheck className="h-3.5 w-3.5 text-foreground/70 dark:text-muted-foreground" />
                </div>
                <span className="text-xs font-semibold text-foreground uppercase tracking-wider">
                  Email Verification
                </span>
                <DesignBadge
                  label={isEnabled ? "Enabled" : "Disabled"}
                  color={isEnabled ? "green" : "red"}
                  size="sm"
                />
              </div>
              <div className="flex items-center flex-shrink-0">
                {isToggling ? (
                  <div className="flex items-center justify-center h-5 w-9">
                    <Spinner size={14} className="text-muted-foreground" />
                  </div>
                ) : (
                  <Switch
                    checked={isEnabled}
                    onCheckedChange={(checked) => {
                      runAsynchronouslyWithAlert(handleEmailVerificationChange(checked));
                    }}
                  />
                )}
              </div>
            </div>

            {/* Description */}
            <p className="text-sm text-muted-foreground leading-relaxed">
              {isEnabled
                ? "Users who haven\u2019t verified their primary email will need to complete verification before they can continue. Unverified users are filtered out by default when listing users, and will be redirected to verify when using the SDK with redirect options."
                : "Email verification is not required. Users can access your application without verifying their email address."
              }
            </p>
          </div>
        </DesignCard>

        <ActionDialog
          open={!!pendingChange}
          onClose={() => setPendingChange(null)}
          title="Enable email verification?"
          danger
          okButton={{
            label: "Enable",
            onClick: async () => {
              await pendingChange?.onConfirm();
            },
          }}
          cancelButton={{
            label: "Cancel",
          }}
        >
          {pendingChange && (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                {pendingChange.totalAffectedCount} existing user{pendingChange.totalAffectedCount === 1 ? '' : 's'} will
                need to verify their email next time they visit your app.
              </p>

              {pendingChange.affectedUsers.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  {pendingChange.affectedUsers.map((user) => (
                    <div key={user.id} className="flex items-center gap-2 text-sm">
                      <span className="text-foreground truncate">
                        {user.displayName || user.primaryEmail || "Anonymous user"}
                      </span>
                      {user.displayName && user.primaryEmail && (
                        <span className="text-muted-foreground truncate text-xs">
                          {user.primaryEmail}
                        </span>
                      )}
                      <DesignBadge
                        label={user.restrictedReason.type === "email_not_verified" ? "Unverified" : "Anonymous"}
                        color="orange"
                        size="sm"
                      />
                    </div>
                  ))}
                  {pendingChange.totalAffectedCount > pendingChange.affectedUsers.length && (
                    <p className="text-xs text-muted-foreground">
                      + {pendingChange.totalAffectedCount - pendingChange.affectedUsers.length} more
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </ActionDialog>
      </PageLayout>
    </AppEnabledGuard>
  );
}
