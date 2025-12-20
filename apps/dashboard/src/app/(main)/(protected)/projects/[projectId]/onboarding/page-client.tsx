"use client";
import { SettingCard, SettingSwitch } from "@/components/settings";
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { ActionDialog, Typography } from "@stackframe/stack-ui";
import React from "react";
import { AppEnabledGuard } from "../app-enabled-guard";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";

type AffectedUser = {
  id: string,
  displayName: string | null,
  primaryEmail: string | null,
  restrictedReason: { type: "anonymous" | "email_not_verified" },
};

type PendingConfigChange = {
  title: string,
  description: string,
  affectedUsers: AffectedUser[],
  totalAffectedCount: number,
  onConfirm: () => Promise<void>,
};

export default function PageClient() {
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const [pendingChange, setPendingChange] = React.useState<PendingConfigChange | null>(null);

  const handleEmailVerificationChange = async (checked: boolean) => {
    // If enabling email verification, check for affected users
    if (checked && !project.config.onboarding?.requireEmailVerification) {
      const preview = await stackAdminApp.previewAffectedUsersByOnboardingChange(
        { requireEmailVerification: true },
        10,
      );

      if (preview.totalAffectedCount > 0) {
        // Show confirmation dialog
        setPendingChange({
          title: "Enable email verification requirement",
          description: `This change will require ${preview.totalAffectedCount} user${preview.totalAffectedCount === 1 ? '' : 's'} to verify their email before they can continue using your application. These users will be required to complete the necessary onboarding steps again.`,
          affectedUsers: preview.affectedUsers,
          totalAffectedCount: preview.totalAffectedCount,
          onConfirm: async () => {
            await project.updateConfig({
              "onboarding.requireEmailVerification": true,
            });
            setPendingChange(null);
          },
        });
        return;
      }
    }

    // No affected users or disabling the feature - apply directly
    await project.updateConfig({
      "onboarding.requireEmailVerification": checked,
    });
  };

  return (
    <AppEnabledGuard appId="onboarding">
      <PageLayout title="Onboarding">
        <SettingCard
          title="Email Verification Requirement"
          description="Control whether users must verify their email to complete onboarding."
        >
          <SettingSwitch
            label="Require email verification"
            checked={project.config.onboarding?.requireEmailVerification ?? false}
            onCheckedChange={(checked) => {
              runAsynchronouslyWithAlert(handleEmailVerificationChange(checked));
            }}
          />
          <Typography variant="secondary" type="footnote">
            When enabled, users who haven&apos;t verified their primary email will need to complete onboarding first.
            Users with pending onboarding are filtered out by default when listing users, and will be redirected
            to complete email verification when using the SDK with redirect options.
          </Typography>
        </SettingCard>
      </PageLayout>

      <ActionDialog
        open={!!pendingChange}
        onClose={() => setPendingChange(null)}
        title={pendingChange?.title ?? "Confirm Change"}
        danger
        okButton={{
          label: "Apply Change",
          onClick: async () => {
            await pendingChange?.onConfirm();
          },
        }}
        cancelButton={{
          label: "Cancel",
        }}
      >
        <div className="flex flex-col gap-4">
          <Typography>{pendingChange?.description}</Typography>

          {pendingChange && pendingChange.affectedUsers.length > 0 && (
            <div className="flex flex-col gap-2">
              <Typography variant="secondary" type="label">
                Affected users:
              </Typography>
              <div className="border rounded-md overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">User</th>
                      <th className="px-3 py-2 text-left font-medium">Email</th>
                      <th className="px-3 py-2 text-left font-medium">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingChange.affectedUsers.map((user) => (
                      <tr key={user.id} className="border-t">
                        <td className="px-3 py-2">
                          {user.displayName || <span className="text-muted-foreground italic">No name</span>}
                        </td>
                        <td className="px-3 py-2">
                          {user.primaryEmail || <span className="text-muted-foreground italic">No email</span>}
                        </td>
                        <td className="px-3 py-2">
                          <span className="text-orange-600">
                            {user.restrictedReason.type === "email_not_verified" ? "Email not verified" : user.restrictedReason.type === "anonymous" ? "Anonymous user" : user.restrictedReason.type}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {pendingChange.totalAffectedCount > pendingChange.affectedUsers.length && (
                <Typography variant="secondary" type="footnote">
                  ... and {pendingChange.totalAffectedCount - pendingChange.affectedUsers.length} more user{pendingChange.totalAffectedCount - pendingChange.affectedUsers.length === 1 ? '' : 's'}
                </Typography>
              )}
            </div>
          )}
        </div>
      </ActionDialog>
    </AppEnabledGuard>
  );
}
