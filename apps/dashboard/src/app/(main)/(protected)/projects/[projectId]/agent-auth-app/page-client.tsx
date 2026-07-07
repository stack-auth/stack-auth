"use client";

import { Suspense, useMemo, useState } from "react";

import { useUpdateConfig } from "@/components/config-update";
import { DesignAlert, DesignCard, DesignEditableGrid, type DesignEditableGridItem } from "@/components/design-components";
import { Switch } from "@/components/ui";
import { SparkleIcon, EnvelopeSimpleIcon, UserGearIcon } from "@phosphor-icons/react";
import { useMetricsOrThrow } from "@/lib/hexclave-app-internals";
import { useAdminApp } from "../use-admin-app";
import { PageLayout } from "../page-layout";

export default function PageClient() {
  const hexclaveAdminApp = useAdminApp();
  const project = hexclaveAdminApp.useProject();
  const config = project.useConfig();
  const updateConfig = useUpdateConfig();

  const configuredAppEnabled = config.apps.installed["agent-auth"]?.enabled === true;
  const configuredServiceAuthEnabled = config.agentAuth.identityTypes.serviceAuth === true;
  const configuredAnonymousEnabled = config.agentAuth.identityTypes.anonymous === true;

  const [localAppEnabled, setLocalAppEnabled] = useState<boolean | undefined>(undefined);
  const [localServiceAuthEnabled, setLocalServiceAuthEnabled] = useState<boolean | undefined>(undefined);
  const [localAnonymousEnabled, setLocalAnonymousEnabled] = useState<boolean | undefined>(undefined);

  const appEnabled = localAppEnabled ?? configuredAppEnabled;
  const serviceAuthEnabled = localServiceAuthEnabled ?? configuredServiceAuthEnabled;
  const anonymousEnabled = localAnonymousEnabled ?? configuredAnonymousEnabled;

  const hasChanges = useMemo(() =>
    localAppEnabled !== undefined || localServiceAuthEnabled !== undefined || localAnonymousEnabled !== undefined,
  [localAppEnabled, localServiceAuthEnabled, localAnonymousEnabled]);

  const modifiedKeys = useMemo(() => new Set([
    ...(localAppEnabled !== undefined ? ["app-enabled"] : []),
    ...(localServiceAuthEnabled !== undefined ? ["service-auth"] : []),
    ...(localAnonymousEnabled !== undefined ? ["anonymous"] : []),
  ]), [localAnonymousEnabled, localAppEnabled, localServiceAuthEnabled]);

  const handleSave = async () => {
    const configUpdate: Record<string, boolean> = {};
    if (localAppEnabled !== undefined) {
      configUpdate["apps.installed.agent-auth.enabled"] = localAppEnabled;
    }
    if (localServiceAuthEnabled !== undefined) {
      configUpdate["agentAuth.identityTypes.serviceAuth"] = localServiceAuthEnabled;
    }
    if (localAnonymousEnabled !== undefined) {
      configUpdate["agentAuth.identityTypes.anonymous"] = localAnonymousEnabled;
    }
    await updateConfig({
      adminApp: hexclaveAdminApp,
      configUpdate,
      pushable: true,
    });
    setLocalAppEnabled(undefined);
    setLocalServiceAuthEnabled(undefined);
    setLocalAnonymousEnabled(undefined);
  };

  const handleDiscard = () => {
    setLocalAppEnabled(undefined);
    setLocalServiceAuthEnabled(undefined);
    setLocalAnonymousEnabled(undefined);
  };

  const items: DesignEditableGridItem[] = [
    {
      itemKey: "app-enabled",
      type: "custom",
      icon: <SparkleIcon className="h-3.5 w-3.5" />,
      name: "Agent Auth Enabled",
      tooltip: "Enable project-scoped agent-auth discovery documents and backend routes.",
      children: (
        <Switch
          checked={appEnabled}
          onCheckedChange={(checked) => {
            if (checked === configuredAppEnabled) {
              setLocalAppEnabled(undefined);
            } else {
              setLocalAppEnabled(checked);
            }
          }}
        />
      ),
    },
    {
      itemKey: "service-auth",
      type: "custom",
      icon: <EnvelopeSimpleIcon className="h-3.5 w-3.5" />,
      name: "Service Auth",
      tooltip: "Allow email-backed registrations for agents that can prove ownership of a service email address.",
      children: (
        <Switch
          checked={serviceAuthEnabled}
          onCheckedChange={(checked) => {
            if (checked === configuredServiceAuthEnabled) {
              setLocalServiceAuthEnabled(undefined);
            } else {
              setLocalServiceAuthEnabled(checked);
            }
          }}
        />
      ),
    },
    {
      itemKey: "anonymous",
      type: "custom",
      icon: <UserGearIcon className="h-3.5 w-3.5" />,
      name: "Anonymous",
      tooltip: "Allow agents to register without an initial human identity and defer claim until later.",
      children: (
        <Switch
          checked={anonymousEnabled}
          onCheckedChange={(checked) => {
            if (checked === configuredAnonymousEnabled) {
              setLocalAnonymousEnabled(undefined);
            } else {
              setLocalAnonymousEnabled(checked);
            }
          }}
        />
      ),
    },
  ];

  return (
    <PageLayout title="Agent Auth" description="Configure agent-auth discovery and registration settings for this project">
      <DesignAlert
        variant="info"
        title="About Agent Auth"
        description={<>
          This app exposes the project-scoped discovery documents and the hosted manifest used by agentic clients.
          <br /><br />
          The enable switch controls whether the project serves the public metadata at all. The identity toggles control which registration flows appear in discovery.
        </>}
      />

      <DesignCard
        title="Agent Auth Settings"
        subtitle="Enable the app and choose which identity types discovery should advertise"
        icon={SparkleIcon}
        glassmorphic
      >
        <DesignEditableGrid
          items={items}
          columns={1}
          deferredSave
          hasChanges={hasChanges}
          onSave={handleSave}
          onDiscard={handleDiscard}
          externalModifiedKeys={modifiedKeys}
          className="gap-y-3"
        />
      </DesignCard>

      <Suspense fallback={<DesignCard title="Agent Auth Metrics" subtitle="Loading agent-auth usage stats..." icon={SparkleIcon} glassmorphic />}>
        <AgentAuthMetricsCard />
      </Suspense>
    </PageLayout>
  );
}

function AgentAuthMetricsCard() {
  const hexclaveAdminApp = useAdminApp();
  const metrics = useMetricsOrThrow(hexclaveAdminApp, false);
  const agentAuthMetrics = metrics.auth_overview.agent_auth;

  return (
    <DesignCard
      title="Agent Auth Metrics"
      subtitle="Read-only project totals from the internal metrics endpoint"
      icon={SparkleIcon}
      glassmorphic
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricItem label="Registrations" value={agentAuthMetrics.total_registrations} />
        <MetricItem label="Completed claims" value={agentAuthMetrics.completed_claims} />
        <MetricItem label="New-user signups" value={agentAuthMetrics.new_user_signups} />
        <MetricItem label="API keys issued" value={agentAuthMetrics.api_keys_issued} />
      </div>
    </DesignCard>
  );
}

function MetricItem({ label, value }: { label: string, value: number }) {
  return (
    <div className="rounded-xl border border-border/60 bg-background/40 p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-2 text-2xl font-semibold tabular-nums">{value.toLocaleString()}</div>
    </div>
  );
}
