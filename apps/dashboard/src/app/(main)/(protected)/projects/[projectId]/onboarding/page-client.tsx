"use client";

import { useAdminApp } from "@/app/(main)/(protected)/projects/[projectId]/use-admin-app";
import {
  DesignBadge,
  DesignButton,
  DesignDialog,
  DesignDialogClose,
} from "@/components/design-components";
import { Typography } from "@/components/ui";
import { useUpdateConfig } from "@/lib/config-update";
import { WarningCircle } from "@phosphor-icons/react";
import type { RestrictedReason } from "@stackframe/stack-shared/dist/schema-fields";
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { useState } from "react";
import { AppEnabledGuard } from "../app-enabled-guard";
import { PageLayout } from "../page-layout";
import { OnboardingEmailVerificationSetting } from "./onboarding-email-verification-setting";

type AffectedUser = {
  id: string,
  displayName: string | null,
  primaryEmail: string | null,
  restrictedReason: RestrictedReason,
};

type PendingChange = {
  affectedUsers: AffectedUser[],
  totalAffectedCount: number,
  onConfirm: () => Promise<void>,
};

function EnableEmailVerificationDialog({
  pendingChange,
  onDismiss,
}: {
  pendingChange: PendingChange | null,
  onDismiss: () => void,
}) {
  return (
    <DesignDialog
      open={pendingChange != null}
      onOpenChange={(open) => {
        if (!open) {
          onDismiss();
        }
      }}
      size="lg"
      icon={WarningCircle}
      title="Enable email verification?"
      description="Existing users who have not verified will need to complete verification the next time they open your app."
      headerContent={
        pendingChange != null && pendingChange.totalAffectedCount > 0 ? (
          <p className="text-sm text-muted-foreground">
            <span className="font-semibold tabular-nums text-foreground">
              {pendingChange.totalAffectedCount.toLocaleString()}
            </span>
            {" "}
            user
            {pendingChange.totalAffectedCount === 1 ? "" : "s"}
            {" "}
            may be asked to verify on their next app open. The list below is a sample; totals may be higher.
          </p>
        ) : null
      }
      footer={(
        <>
          <DesignDialogClose asChild>
            <DesignButton variant="secondary" size="sm">
              <span>Cancel</span>
            </DesignButton>
          </DesignDialogClose>
          <DesignButton
            size="sm"
            onClick={async () => {
              if (pendingChange == null) return;
              await pendingChange.onConfirm();
            }}
          >
            <span>Enable</span>
          </DesignButton>
        </>
      )}
    >
      {pendingChange != null && (
        <div className="flex flex-col gap-3">
          {pendingChange.affectedUsers.length > 0 && (
            <div>
              <Typography variant="secondary" className="mb-2 text-[10px] font-semibold uppercase tracking-wider">
                Sample accounts
              </Typography>
              <div className="max-h-[min(200px,35vh)] overflow-y-auto rounded-xl bg-background/60 ring-1 ring-foreground/[0.06]">
                <ul className="divide-y divide-foreground/[0.06]">
                  {pendingChange.affectedUsers.map((user) => (
                    <li
                      key={user.id}
                      className="flex flex-col gap-0.5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
                    >
                      <div className="min-w-0">
                        <span className="block truncate text-sm font-medium text-foreground">
                          {user.displayName || user.primaryEmail || "Anonymous user"}
                        </span>
                        {user.displayName && user.primaryEmail && (
                          <span className="block truncate text-xs text-muted-foreground">
                            {user.primaryEmail}
                          </span>
                        )}
                      </div>
                      <div className="w-fit shrink-0">
                        <DesignBadge
                          label={user.restrictedReason.type === "email_not_verified" ? "Unverified" : "Anonymous"}
                          color="orange"
                          size="sm"
                        />
                      </div>
                    </li>
                  ))}
                </ul>
                {pendingChange.totalAffectedCount > pendingChange.affectedUsers.length && (
                  <p className="border-t border-foreground/[0.06] px-3 py-2 text-xs text-muted-foreground">
                    +
                    {" "}
                    {(pendingChange.totalAffectedCount - pendingChange.affectedUsers.length).toLocaleString()}
                    {" "}
                    more not shown in this sample
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </DesignDialog>
  );
}

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
      if (checked && !projectConfig.onboarding.requireEmailVerification) {
        // any cast needed: previewAffectedUsersByOnboardingChange is a dynamically-typed admin API method
        const preview = await (stackAdminApp as any).previewAffectedUsersByOnboardingChange(
          { requireEmailVerification: true },
          10,
        );

        if (preview.totalAffectedCount > 0) {
          setPendingChange({
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
      <PageLayout
        title="Onboarding"
        description="Control first-run requirements so users meet your app’s trust bar before they continue."
      >
        <div className="flex flex-col gap-4">
          <OnboardingEmailVerificationSetting
            isEnabled={isEnabled}
            isToggling={isToggling}
            onCheckedChange={(checked: boolean) => {
              runAsynchronouslyWithAlert(handleEmailVerificationChange(checked));
            }}
          />
        </div>

        <EnableEmailVerificationDialog
          pendingChange={pendingChange}
          onDismiss={() => setPendingChange(null)}
        />
      </PageLayout>
    </AppEnabledGuard>
  );
}
