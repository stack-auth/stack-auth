"use client";

import {
  DesignButton,
  DesignInput,
  DesignListItemRow,
} from "@/components/design-components";
import { ActionDialog, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, toast } from "@/components/ui";
import { useUpdateConfig } from "@/lib/config-update";
import { FlagIcon, PlusIcon } from "@phosphor-icons/react";
import { getUserSpecifiedIdErrorMessage, isValidUserSpecifiedId, sanitizeUserSpecifiedId } from "@stackframe/stack-shared/dist/schema-fields";
import { typedEntries } from "@stackframe/stack-shared/dist/utils/objects";
import { generateUuid } from "@stackframe/stack-shared/dist/utils/uuids";
import { useState } from "react";
import { useRouter } from "../../../../../../components/router";
import { AppEnabledGuard } from "../app-enabled-guard";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";

type FlagType = "boolean" | "multivariate" | "json" | "numeric" | "string";

const FLAG_TYPE_OPTIONS: Array<{ value: FlagType, label: string }> = [
  { value: "boolean", label: "Boolean (on/off)" },
  { value: "multivariate", label: "Multivariate (A/B/C…)" },
  { value: "string", label: "String" },
  { value: "numeric", label: "Numeric" },
  { value: "json", label: "JSON payload" },
];

function makeDefaultFlag(key: string, type: FlagType) {
  // For booleans we seed canonical on/off variants so the flag is immediately useful; for other
  // types the operator will define variants in the detail view, so we leave variants empty.
  if (type === "boolean") {
    return {
      key,
      type,
      enabled: true,
      killSwitch: false,
      defaultVariantKey: "off",
      variants: {
        on: { value: true },
        off: { value: false },
      },
      rules: {},
    } as const;
  }
  return {
    key,
    type,
    enabled: true,
    killSwitch: false,
    defaultVariantKey: undefined,
    variants: {},
    rules: {},
  } as const;
}

export default function PageClient() {
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const router = useRouter();
  const updateConfig = useUpdateConfig();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newType, setNewType] = useState<FlagType>("boolean");

  const config = project.useConfig();
  const flags = config.featureFlags.flags;
  const entries = typedEntries(flags);

  const isKeyTaken = (key: string) => entries.some(([, def]) => def.key === key);

  const handleCreate = async () => {
    const key = newKey.trim();
    if (!key) {
      alert("Flag key is required");
      return "prevent-close" as const;
    }
    if (!isValidUserSpecifiedId(key)) {
      alert(getUserSpecifiedIdErrorMessage("flagId"));
      return "prevent-close" as const;
    }
    if (isKeyTaken(key)) {
      alert("A flag with this key already exists");
      return "prevent-close" as const;
    }

    // Internal config id is opaque so flag keys can be renamed without invalidating bucket seeds.
    const flagId = generateUuid();
    const ok = await updateConfig({
      adminApp: stackAdminApp,
      configUpdate: {
        [`featureFlags.flags.${flagId}`]: makeDefaultFlag(key, newType),
      },
      pushable: true,
    });

    if (ok) {
      toast({ title: "Feature flag created" });
      router.push(`/projects/${project.id}/feature-flags/${flagId}`);
    }
  };

  return (
    <AppEnabledGuard appId="feature-flags">
      <PageLayout
        title="Feature Flags"
        description="Define flags, target rollouts, and run experiments. The same evaluator powers the dashboard, the API, and every Stack Auth SDK."
        actions={
          <DesignButton onClick={() => setIsCreateOpen(true)}>
            <PlusIcon className="h-4 w-4 mr-2" />
            Create Flag
          </DesignButton>
        }
      >
        {entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12">
            <div className="p-3 rounded-2xl bg-foreground/[0.04] mb-4">
              <FlagIcon className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="text-base font-semibold mb-1">No feature flags yet</h3>
            <p className="text-sm text-muted-foreground text-center mb-5 max-w-sm">
              Create your first flag to start gating features behind targeted rollouts.
            </p>
            <DesignButton onClick={() => setIsCreateOpen(true)}>
              <PlusIcon className="h-4 w-4 mr-2" />
              Create Your First Flag
            </DesignButton>
          </div>
        ) : (
          <div className="space-y-3">
            {entries.map(([flagId, def]) => (
              <DesignListItemRow
                key={flagId}
                icon={FlagIcon}
                title={def.key || flagId}
                subtitle={[
                  def.type ?? "boolean",
                  def.killSwitch ? "kill switch" : (def.enabled === false ? "disabled" : "enabled"),
                  def.description,
                ].filter(Boolean).join(" · ")}
                onClick={() => router.push(`/projects/${project.id}/feature-flags/${flagId}`)}
              />
            ))}
          </div>
        )}

        <ActionDialog
          open={isCreateOpen}
          onOpenChange={(open) => {
            setIsCreateOpen(open);
            if (!open) {
              setNewKey("");
              setNewType("boolean");
            }
          }}
          title="Create Feature Flag"
          description="Pick a key and a type. You can configure variants and targeting rules after creation."
          okButton={{ label: "Create Flag", onClick: handleCreate }}
          cancelButton
        >
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="flagKey">Flag Key</Label>
              <DesignInput
                id="flagKey"
                placeholder="e.g., new-checkout, dark-mode"
                value={newKey}
                onChange={(e) => setNewKey(sanitizeUserSpecifiedId(e.target.value))}
              />
              <p className="text-xs text-muted-foreground">
                Letters, numbers, underscores, and hyphens only. This is what your code will reference.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="flagType">Type</Label>
              <Select value={newType} onValueChange={(v) => setNewType(v as FlagType)}>
                <SelectTrigger id="flagType">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FLAG_TYPE_OPTIONS.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </ActionDialog>
      </PageLayout>
    </AppEnabledGuard>
  );
}
