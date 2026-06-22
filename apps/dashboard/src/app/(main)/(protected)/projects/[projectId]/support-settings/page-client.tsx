"use client";

import { DesignButton, DesignCard, DesignInput, DesignSelectorDropdown } from "@/components/design-components";
import { useUpdateConfig } from "@/lib/config-update";
import { Switch, Typography } from "@/components/ui";
import { runAsynchronouslyWithAlert } from "@hexclave/shared/dist/utils/promises";
import { useMemo, useState } from "react";
import { AppEnabledGuard } from "../app-enabled-guard";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";

type Priority = "low" | "normal" | "high" | "urgent";

const PRIORITY_OPTIONS: { value: Priority, label: string }[] = [
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
];

function isPriority(value: string): value is Priority {
  return PRIORITY_OPTIONS.some((option) => option.value === value);
}

// Empty string => "no target" (null). Otherwise a positive integer number of minutes.
function minutesToInput(value: number | null | undefined): string {
  return value != null ? String(value) : "";
}

function inputToMinutes(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export default function PageClient() {
  const hexclaveAdminApp = useAdminApp();
  const project = hexclaveAdminApp.useProject();
  const support = project.useConfig().support;
  const updateConfig = useUpdateConfig();

  const saved = useMemo(() => ({
    enabled: support.sla.enabled,
    firstResponseMinutes: minutesToInput(support.sla.firstResponseMinutes),
    nextResponseMinutes: minutesToInput(support.sla.nextResponseMinutes),
    defaultPriority: support.defaultPriority,
  }), [support]);

  const [draft, setDraft] = useState(saved);
  const [saving, setSaving] = useState(false);

  const isDirty = (
    draft.enabled !== saved.enabled
    || draft.firstResponseMinutes !== saved.firstResponseMinutes
    || draft.nextResponseMinutes !== saved.nextResponseMinutes
    || draft.defaultPriority !== saved.defaultPriority
  );

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateConfig({
        adminApp: hexclaveAdminApp,
        configUpdate: {
          "support.sla.enabled": draft.enabled,
          "support.sla.firstResponseMinutes": inputToMinutes(draft.firstResponseMinutes),
          "support.sla.nextResponseMinutes": inputToMinutes(draft.nextResponseMinutes),
          "support.defaultPriority": draft.defaultPriority,
        },
        pushable: false,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppEnabledGuard appId="support">
      <PageLayout title="Support Settings" description="Configure SLA targets and defaults for the Support app.">
        <div className="flex flex-col gap-6">
          <DesignCard gradient="default">
            <div className="space-y-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-medium text-foreground">Response-time SLA</div>
                  <Typography variant="secondary" className="text-sm">
                    Track first- and next-response targets. Conversations show an SLA badge as targets approach.
                  </Typography>
                </div>
                <Switch
                  checked={draft.enabled}
                  onCheckedChange={(checked) => setDraft((prev) => ({ ...prev, enabled: checked }))}
                />
              </div>

              {draft.enabled && (
                <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">First response target (minutes)</label>
                    <DesignInput
                      value={draft.firstResponseMinutes}
                      onChange={(e) => setDraft((prev) => ({ ...prev, firstResponseMinutes: e.target.value }))}
                      type="number"
                      placeholder="e.g. 60 (leave blank for none)"
                      size="md"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Next response target (minutes)</label>
                    <DesignInput
                      value={draft.nextResponseMinutes}
                      onChange={(e) => setDraft((prev) => ({ ...prev, nextResponseMinutes: e.target.value }))}
                      type="number"
                      placeholder="e.g. 120 (leave blank for none)"
                      size="md"
                    />
                  </div>
                </div>
              )}
            </div>
          </DesignCard>

          <DesignCard gradient="default">
            <div className="space-y-3">
              <div>
                <div className="text-sm font-medium text-foreground">Default priority</div>
                <Typography variant="secondary" className="text-sm">
                  Priority assigned to new conversations opened by customers (email or in-app).
                </Typography>
              </div>
              <div className="max-w-[12rem]">
                <DesignSelectorDropdown
                  value={draft.defaultPriority}
                  onValueChange={(value) => {
                    if (!isPriority(value)) {
                      throw new Error(`Invalid priority: ${value}`);
                    }
                    setDraft((prev) => ({ ...prev, defaultPriority: value }));
                  }}
                  options={PRIORITY_OPTIONS}
                  size="md"
                />
              </div>
            </div>
          </DesignCard>

          {isDirty && (
            <div className="flex items-center justify-end gap-2">
              <DesignButton variant="secondary" disabled={saving} onClick={() => setDraft(saved)}>
                Discard
              </DesignButton>
              <DesignButton loading={saving} onClick={() => runAsynchronouslyWithAlert(handleSave)}>
                Save changes
              </DesignButton>
            </div>
          )}
        </div>
      </PageLayout>
    </AppEnabledGuard>
  );
}
