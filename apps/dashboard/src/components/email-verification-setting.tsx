"use client";

import { useAdminApp } from "@/app/(main)/(protected)/projects/[projectId]/use-admin-app";
import { SettingSwitch } from "@/components/settings";
import { ActionDialog, Typography } from "@/components/ui";
import { EnvelopeSimpleIcon } from "@phosphor-icons/react";
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { useState } from "react";

type AffectedUser = {
  id: string,
  displayName: string | null,
  primaryEmail: string | null,
  restrictedReason: { type: "anonymous" | "email_not_verified" },
};

type PendingChange = {
  title: string,
  description: string,
  affectedUsers: AffectedUser[],
  totalAffectedCount: number,
  onConfirm: () => Promise<void>,
};

export function EmailVerificationSetting(props: {
  showIcon?: boolean,
  hint?: string,
}) {
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const projectConfig = project.useConfig();
  const [pendingChange, setPendingChange] = useState<PendingChange | null>(null);

  const handleEmailVerificationChange = async (checked: boolean) => {
    // If enabling email verification, check for affected users
    if (checked && !projectConfig.onboarding.requireEmailVerification) {
      const preview = await (stackAdminApp as any).previewAffectedUsersByOnboardingChange(
        { requireEmailVerification: true },
        10,
      );

      if (preview.totalAffectedCount > 0) {
        // Show confirmation dialog
        setPendingChange({
          title: "Enable email verification requirement",
          description: `This change will require ${preview.totalAffectedCount} user${preview.totalAffectedCount === 1 ? '' : 's'} to verify their email before they can continue using your application. They will be prompted to do so the next time they visit your application.`,
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
    <>
      <SettingSwitch
        label={
          props.showIcon ? (
            <div className="flex items-center gap-2">
              <EnvelopeSimpleIcon size={20} />
              <span>Require email verification</span>
            </div>
          ) : (
            "Require email verification"
          )
        }
        checked={projectConfig.onboarding.requireEmailVerification}
        onCheckedChange={(checked) => {
          runAsynchronouslyWithAlert(handleEmailVerificationChange(checked));
        }}
        hint={props.hint}
      />

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
                            {user.restrictedReason.type === "email_not_verified" ? "Email not verified" : "Anonymous user"}
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
    </>
  );
}
