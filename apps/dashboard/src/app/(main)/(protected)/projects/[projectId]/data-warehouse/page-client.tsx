"use client";

import { CodeBlock } from "@/components/code-block";
import { DesignBadge, DesignButton, DesignCard } from "@/components/design-components";
import { Alert, AlertDescription, CopyField, toast } from "@/components/ui";
import { getAppStageLabel } from "@/lib/apps-utils";
import { useDashboardInternalUser } from "@/lib/dashboard-user";
import type { DataWarehouseCredentialsJson } from "@hexclave/shared/dist/interface/admin-interface";
import { ITEM_IDS, resolvePlanId } from "@hexclave/shared/dist/plans";
import { ArrowClockwiseIcon, DatabaseIcon, KeyIcon, PlugIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { AppEnabledGuard } from "../app-enabled-guard";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";

const stageLabel = getAppStageLabel("data-warehouse-alpha");

export default function PageClient() {
  return (
    <AppEnabledGuard appId="data-warehouse-alpha">
      <PageLayout
        title="Data Warehouse"
        description={
          <span className="flex items-center gap-2">
            A ClickHouse database of your own, on the same instance as your analytics data.
            {stageLabel != null && <DesignBadge label={stageLabel} color="purple" size="sm" />}
          </span>
        }
      >
        <DataWarehouseContent />
      </PageLayout>
    </AppEnabledGuard>
  );
}

function DataWarehouseContent() {
  const adminApp = useAdminApp();
  const warehouse = adminApp.useDataWarehouse();
  const [credentials, setCredentials] = useState<DataWarehouseCredentialsJson | null>(null);

  const isProvisioned = warehouse.status === "ready";

  const handleProvision = async () => {
    setCredentials(await adminApp.provisionDataWarehouse());
    toast({ title: "Data warehouse created" });
  };

  const handleRotate = async () => {
    setCredentials(await adminApp.rotateDataWarehousePassword());
    toast({ title: "Password rotated" });
  };

  return (
    <div className="flex flex-col gap-4">
      <EntitlementGate />

      {warehouse.status === "failed" && (
        <Alert variant="destructive">
          <WarningCircleIcon className="h-4 w-4" />
          <AlertDescription>
            {warehouse.error ?? "Provisioning failed."} Provisioning is safe to repeat — try again.
          </AlertDescription>
        </Alert>
      )}

      {credentials != null && <CredentialsPanel credentials={credentials} />}

      <DesignCard
        icon={DatabaseIcon}
        title={isProvisioned ? "Your warehouse" : "Create your warehouse"}
        subtitle={
          isProvisioned
            ? "Connect any ClickHouse client with the details below. Your analytics tables are readable from the same connection, so you can join them against your own."
            : "We'll create a ClickHouse database named after your project id, plus a user with read and write access to it. Nothing else on the instance is reachable from that user."
        }
      >
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <CopyField type="input" label="Database" value={warehouse.database_name ?? ""} monospace />
            <CopyField type="input" label="Host" value={warehouse.connection.host} monospace />
            <CopyField type="input" label="HTTPS port" value={String(warehouse.connection.https_port)} monospace />
            <CopyField type="input" label="Native port" value={String(warehouse.connection.native_port)} monospace />
            {warehouse.username != null && (
              <CopyField type="input" label="Username" value={warehouse.username} monospace />
            )}
          </div>

          {isProvisioned && (
            <p className="text-sm text-muted-foreground">
              The password is shown only when it is created. If you no longer have it, rotate it — rotating
              invalidates the previous password immediately.
            </p>
          )}

          <div className="flex gap-2">
            {isProvisioned ? (
              <DesignButton variant="secondary" onClick={handleRotate}>
                <ArrowClockwiseIcon className="h-4 w-4" />
                Rotate password
              </DesignButton>
            ) : (
              <DesignButton onClick={handleProvision} loading={warehouse.status === "provisioning"}>
                <DatabaseIcon className="h-4 w-4" />
                {warehouse.status === "failed" ? "Retry provisioning" : "Provision"}
              </DesignButton>
            )}
          </div>
        </div>
      </DesignCard>

      {isProvisioned && warehouse.username != null && (
        <DesignCard
          icon={PlugIcon}
          title="Connecting"
          subtitle="Any ClickHouse client works — clickhouse-client, dbt, or your BI tool."
        >
          <CodeBlock
            language="bash"
            title="clickhouse-client"
            icon="terminal"
            content={[
              "clickhouse-client \\",
              `  --host ${warehouse.connection.host} \\`,
              `  --port ${warehouse.connection.native_port} \\`,
              "  --secure \\",
              `  --user ${warehouse.username} \\`,
              "  --password <your-password> \\",
              `  --database ${warehouse.database_name ?? ""}`,
            ].join("\n")}
          />
        </DesignCard>
      )}
    </div>
  );
}

/**
 * The Data Warehouse needs a team plan or higher. The backend enforces this on
 * every provision and rotation; this is the version the user can see before
 * clicking, and it stays quiet when plan limits aren't enforced at all
 * (self-hosted, and local development).
 */
function EntitlementGate() {
  const adminApp = useAdminApp();
  const project = adminApp.useProject();
  const planUsage = adminApp.usePlanUsage();
  const user = useDashboardInternalUser();
  const teams = user.useTeams();

  const ownerTeam = useMemo(
    () => teams.find(t => t.id === project.ownerTeamId),
    [teams, project.ownerTeamId],
  );

  if (!planUsage.arePlanLimitsEnforced || ownerTeam == null) {
    return null;
  }

  return <EntitlementGateInner team={ownerTeam} />;
}

function EntitlementGateInner({ team }: {
  team: {
    useItem: (itemId: string) => { quantity: number },
    useProducts: () => Array<{ id: string | null, type?: string }>,
    createCheckoutUrl: (options: { productId: string, returnUrl: string }) => Promise<string>,
  },
}) {
  const item = team.useItem(ITEM_IDS.dataWarehouse);
  const products = team.useProducts();
  const planId = resolvePlanId(products);

  if (item.quantity >= 1) {
    return null;
  }

  const handleUpgrade = async () => {
    const checkoutUrl = await team.createCheckoutUrl({
      productId: planId === "free" ? "team" : "growth",
      returnUrl: window.location.href,
    });
    window.location.assign(checkoutUrl);
  };

  return (
    <Alert>
      <WarningCircleIcon className="h-4 w-4" />
      <AlertDescription className="flex items-center justify-between gap-4">
        <span>The Data Warehouse is available on the Team plan and above.</span>
        <DesignButton size="sm" onClick={handleUpgrade}>Upgrade</DesignButton>
      </AlertDescription>
    </Alert>
  );
}

/**
 * Shown once, right after provisioning or rotation. The password is never
 * retrievable afterwards, so this panel is the only chance to copy it.
 */
function CredentialsPanel({ credentials }: { credentials: DataWarehouseCredentialsJson }) {
  return (
    <DesignCard
      icon={KeyIcon}
      title="Your password"
      subtitle="Copy it now — this is the only time it is shown. Rotate it if you lose it."
    >
      <div className="hexclave-sensitive flex flex-col gap-3">
        <CopyField type="input" label="Username" value={credentials.username} monospace />
        <CopyField type="input" label="Password" value={credentials.password} monospace isSecret />
      </div>
    </DesignCard>
  );
}
