"use client";

import { SettingCard, SettingSwitch } from "@/components/settings";
import { Input, Label, Typography } from "@/components/ui";
import { useUpdateConfig } from "@/lib/config-update";
import type { CompleteConfig } from "@stackframe/stack-shared/dist/config/schema";
import { resolveSupportSla, type SupportSlaConfig } from "@stackframe/stack-shared/dist/helpers/support-sla";
import { AppEnabledGuard } from "../app-enabled-guard";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";

function parseMinutes(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) return null;
  return n;
}

export default function PageClient() {
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const sla = resolveSupportSla(project.useConfig().support);
  const updateConfig = useUpdateConfig();

  const saveSla = async (next: SupportSlaConfig) => {
    await updateConfig({
      adminApp: stackAdminApp,
      configUpdate: {
        "support.sla": next satisfies NonNullable<NonNullable<CompleteConfig["support"]>["sla"]>,
      },
      pushable: true,
    });
  };

  return (
    <AppEnabledGuard appId="support">
      <PageLayout
        title="Support Settings"
        description="Configure SLA targets that drive first-response and next-response due dates on conversations."
      >
        <div className="max-w-3xl space-y-6">
          <SettingSwitch
            label="Enable SLA tracking"
            hint="When enabled, new user-initiated conversations get a first-response due date, and user replies on pending conversations get a next-response due date."
            checked={sla.enabled}
            onCheckedChange={async (enabled) => {
              await saveSla({ ...sla, enabled });
            }}
          />

          <SettingCard
            title="SLA targets"
            description="Minutes allowed for the first agent response and each subsequent agent response after a user reply. Leave blank for 'no target'. These apply to all conversations regardless of priority."
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label className="text-sm font-medium">First response (minutes)</Label>
                <Input
                  type="number"
                  min={1}
                  step={1}
                  inputMode="numeric"
                  placeholder="No target"
                  disabled={!sla.enabled}
                  defaultValue={sla.firstResponseMinutes ?? ""}
                  onBlur={(e) => void saveSla({ ...sla, firstResponseMinutes: parseMinutes(e.currentTarget.value) })}
                />
                <Typography variant="secondary" className="text-xs">
                  Time window to send the first agent reply to a new conversation.
                </Typography>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-sm font-medium">Next response (minutes)</Label>
                <Input
                  type="number"
                  min={1}
                  step={1}
                  inputMode="numeric"
                  placeholder="No target"
                  disabled={!sla.enabled}
                  defaultValue={sla.nextResponseMinutes ?? ""}
                  onBlur={(e) => void saveSla({ ...sla, nextResponseMinutes: parseMinutes(e.currentTarget.value) })}
                />
                <Typography variant="secondary" className="text-xs">
                  Time window to reply after a user follows up on a pending conversation.
                </Typography>
              </div>
            </div>
          </SettingCard>
        </div>
      </PageLayout>
    </AppEnabledGuard>
  );
}
