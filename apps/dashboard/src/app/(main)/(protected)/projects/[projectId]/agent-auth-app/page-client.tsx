"use client";

import { DesignAlert, DesignCard } from "@/components/design-components";
import { Switch, Typography } from "@/components/ui";
import { useUpdateConfig } from "@/components/config-update";
import { hexclaveAppInternalsSymbol } from "@hexclave/next";
import { GearSix, Users } from "@phosphor-icons/react";
import { runAsynchronouslyWithAlert } from "@hexclave/shared/dist/utils/promises";
import { useEffect, useState } from "react";
import { AppEnabledGuard } from "../app-enabled-guard";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";

type AgentGrant = {
  capability: string,
  status: string,
  constraints: unknown,
  expires_at: string | null,
};

type AgentRow = {
  id: string,
  name: string,
  mode: "delegated" | "autonomous",
  status: string,
  agent_thumbprint: string,
  linked_user_id: string | null,
  host: {
    id: string,
    name: string,
    thumbprint: string,
    linked_user_id: string | null,
  },
  linked_user: {
    id: string,
    display_name: string | null,
  } | null,
  capabilities: AgentGrant[],
  expires_at: string,
  max_lifetime_ends_at: string,
  absolute_lifetime_ends_at: string,
  created_at: string,
  updated_at: string,
  last_used_at: string | null,
};

export default function PageClient() {
  const adminApp = useAdminApp();
  const project = adminApp.useProject();
  const config = project.useConfig();
  const updateConfig = useUpdateConfig();
  const enabled = config.apps.installed["agent-auth"]?.enabled ?? false;

  const [localEnabled, setLocalEnabled] = useState<boolean | undefined>(undefined);
  const [agents, setAgents] = useState<AgentRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const appEnabled = localEnabled ?? enabled;
  useEffect(() => {
    if (!appEnabled) {
      setAgents([]);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    async function loadAgents() {
      setLoading(true);
      setError(null);
      try {
        const response = await adminApp[hexclaveAppInternalsSymbol].sendRequest(
          "/api/latest/agent-auth/agents",
          {},
          "admin",
        );
        if (!response.ok) {
          throw new Error(`Failed to load agents: ${response.status}`);
        }
        const body = await response.json() as { agents: AgentRow[] };
        if (!cancelled) {
          setAgents(body.agents);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load agents");
          setAgents(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadAgents().catch((loadError) => {
      if (!cancelled) {
        setError(loadError instanceof Error ? loadError.message : "Failed to load agents");
        setAgents(null);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [adminApp, appEnabled]);

  const handleToggle = (checked: boolean) => {
    runAsynchronouslyWithAlert(async () => {
      await updateConfig({
        adminApp,
        configUpdate: {
          "apps.installed.agent-auth.enabled": checked,
        },
        pushable: true,
      });
      setLocalEnabled(undefined);
    });
  };

  return (
    <AppEnabledGuard appId="agent-auth">
      <PageLayout
        title="Agent Auth"
        description="Review real agent identities, hosts, and capability grants."
      >
        <DesignAlert
          variant="info"
          title="Agent identities"
          description="This page reads the live backend Agents API for the current project."
        />

        <DesignCard title="App State" subtitle="Enable or disable Agent Auth for this project" icon={GearSix}>
          <div className="flex items-center justify-between gap-3">
            <Typography className="text-sm font-medium">
              Agent Auth enabled
            </Typography>
            <Switch checked={appEnabled} onCheckedChange={handleToggle} />
          </div>
        </DesignCard>

        <DesignCard title="Agents" subtitle="Live agents registered in this project" icon={Users}>
          {loading ? (
            <Typography className="text-sm text-muted-foreground">Loading agents…</Typography>
          ) : error ? (
            <Typography className="text-sm text-destructive">{error}</Typography>
          ) : agents == null || agents.length === 0 ? (
            <Typography className="text-sm text-muted-foreground">No agents registered yet.</Typography>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b">
                  <tr className="text-muted-foreground">
                    <th className="py-2 pr-4">Name</th>
                    <th className="py-2 pr-4">Agent</th>
                    <th className="py-2 pr-4">Host</th>
                    <th className="py-2 pr-4">Linked user</th>
                    <th className="py-2 pr-4">Mode</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 pr-4">Capabilities</th>
                    <th className="py-2 pr-4">Last used</th>
                  </tr>
                </thead>
                <tbody>
                  {agents.map((agent) => (
                    <tr key={agent.id} className="border-b last:border-b-0 align-top">
                      <td className="py-3 pr-4 font-medium">{agent.name}</td>
                      <td className="py-3 pr-4 font-mono text-xs">{agent.id.slice(0, 8)}</td>
                      <td className="py-3 pr-4">
                        <div className="font-medium">{agent.host.name}</div>
                        <div className="font-mono text-xs text-muted-foreground">{agent.host.id.slice(0, 8)}</div>
                      </td>
                      <td className="py-3 pr-4">
                        {agent.linked_user?.display_name ?? agent.linked_user_id ?? "—"}
                      </td>
                      <td className="py-3 pr-4">{agent.mode}</td>
                      <td className="py-3 pr-4">{agent.status}</td>
                      <td className="py-3 pr-4">
                        {agent.capabilities.map((capability) => (
                          <div key={`${agent.id}-${capability.capability}`} className="mb-1">
                            <span className="font-medium">{capability.capability}</span>
                            <span className="ml-2 text-xs text-muted-foreground">{capability.status}</span>
                          </div>
                        ))}
                      </td>
                      <td className="py-3 pr-4">{agent.last_used_at ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DesignCard>
      </PageLayout>
    </AppEnabledGuard>
  );
}
