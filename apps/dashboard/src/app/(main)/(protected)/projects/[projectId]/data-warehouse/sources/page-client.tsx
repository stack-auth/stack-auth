"use client";

import { DesignButton, DesignCard, DesignListItemRow } from "@/components/design-components";
import { Card, Input, Label, Typography, useToast } from "@/components/ui";
import type { CreateDataSourceOptions, DataSourceCatalogJson, DataSourceJson, DataSourceStreamConfig } from "@hexclave/shared/dist/interface/admin-interface";
import { LockSimpleIcon, PlugsIcon } from "@phosphor-icons/react";
import { useRouter } from "@/components/router";
import { useState } from "react";
import { AppEnabledGuard } from "../../app-enabled-guard";
import { PageLayout } from "../../page-layout";
import { useAdminApp } from "../../use-admin-app";
import { SOURCE_TYPES, describeSource, type SourceTypeId } from "./source-types";
import { StreamPicker } from "./stream-picker";

export default function PageClient() {
  return (
    <AppEnabledGuard appId="data-warehouse-alpha">
      <SourcesPage />
    </AppEnabledGuard>
  );
}

type View =
  | { step: "list" }
  | { step: "catalog" }
  | { step: "credentials", sourceType: SourceTypeId }
  | { step: "tables", dataSource: DataSourceJson, catalog: DataSourceCatalogJson };

function SourcesPage() {
  const adminApp = useAdminApp();
  const dataSources = adminApp.useDataSources();
  const [view, setView] = useState<View>({ step: "list" });

  switch (view.step) {
    case "catalog": {
      return <SourceCatalog onBack={() => setView({ step: "list" })} onPick={sourceType => setView({ step: "credentials", sourceType })} />;
    }
    case "credentials": {
      const onConnected = (dataSource: DataSourceJson, catalog: DataSourceCatalogJson) =>
        setView({ step: "tables", dataSource, catalog });
      const onBack = () => setView({ step: "catalog" });
      return view.sourceType === "convex"
        ? <ConnectConvex onBack={onBack} onConnected={onConnected} />
        : <ConnectPostgres onBack={onBack} onConnected={onConnected} />;
    }
    case "tables": {
      return <ChooseTables dataSource={view.dataSource} catalog={view.catalog} />;
    }
    default: {
      return <SourceList dataSources={dataSources} onAdd={() => setView({ step: "catalog" })} />;
    }
  }
}

function SourceList({ dataSources, onAdd }: { dataSources: DataSourceJson[], onAdd: () => void }) {
  const router = useRouter();
  const adminApp = useAdminApp();

  if (dataSources.length === 0) {
    return (
      <PageLayout title="Sources" description="Sync data from your own systems into the warehouse.">
        <Card className="flex flex-col items-center px-6 py-14 text-center">
          <div className="mb-4 grid h-11 w-11 place-items-center rounded-full bg-primary/10 text-primary">
            <PlugsIcon className="h-5 w-5" />
          </div>
          <Typography type="h4">No sources yet</Typography>
          <Typography type="p" variant="secondary" className="mb-5 mt-1">
            Connect a database to start syncing.
          </Typography>
          <DesignButton onClick={onAdd}>Add source</DesignButton>
        </Card>
      </PageLayout>
    );
  }

  return (
    <PageLayout
      title="Sources"
      description={`${dataSources.length} connected`}
      actions={<DesignButton onClick={onAdd}>Add source</DesignButton>}
    >
      <Card className="divide-y divide-border-in-card">
        {dataSources.map(source => {
          const failing = source.streams.filter(stream => stream.status === "failed").length;
          return (
            <DesignListItemRow
              key={source.id}
              size="sm"
              icon={SOURCE_TYPES[source.type].icon}
              title={describeSource(source)}
              subtitle={`${SOURCE_TYPES[source.type].label} · ${source.streams.length} ${source.streams.length === 1 ? "table" : "tables"}${failing > 0 ? ` · ${failing} failing` : ""}`}
              onClick={() => router.push(`/projects/${encodeURIComponent(adminApp.projectId)}/data-warehouse/sources/${encodeURIComponent(source.id)}`)}
            />
          );
        })}
      </Card>
    </PageLayout>
  );
}

/**
 * "Pick what you are syncing from" is a different decision from "type your
 * credentials", so it gets its own step — and the connect form that follows is
 * per source type, because a Convex deploy key and a Postgres host/port have
 * nothing in common.
 */
function SourceCatalog({ onBack, onPick }: { onBack: () => void, onPick: (sourceType: SourceTypeId) => void }) {
  return (
    <PageLayout title="Add source" description="Pick what you want to sync from.">
      <DesignButton variant="ghost" className="self-start" onClick={onBack}>← Sources</DesignButton>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(Object.keys(SOURCE_TYPES) as SourceTypeId[]).map(sourceType => {
          const info = SOURCE_TYPES[sourceType];
          const Icon = info.icon;
          return (
            <button
              key={sourceType}
              type="button"
              onClick={() => onPick(sourceType)}
              className="flex flex-col items-start gap-2 rounded-xl border border-border-in-card p-4 text-left transition-colors hover:border-foreground/40"
            >
              <Icon className="h-5 w-5" />
              <span className="font-medium">{info.label}</span>
              <span className="text-xs text-muted-foreground">{info.category}</span>
            </button>
          );
        })}
      </div>
    </PageLayout>
  );
}

/** The note under every connect form; the secret is handled the same way for all of them. */
function SecretNote({ what }: { what: string }) {
  return (
    <div className="mt-5 flex gap-2.5 border-t border-border-in-card pt-4">
      <LockSimpleIcon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <Typography type="p" variant="secondary" className="text-xs">
        <span className="font-medium text-foreground">Your {what} is encrypted at rest.</span>{" "}
        It is sealed with a key from our KMS before it is written, decrypted only in memory for the
        seconds a sync runs, and never shown again once saved.
      </Typography>
    </div>
  );
}

function ConnectConvex(props: {
  onBack: () => void,
  onConnected: (dataSource: DataSourceJson, catalog: DataSourceCatalogJson) => void,
}) {
  const adminApp = useAdminApp();
  const { toast } = useToast();
  const [deploymentUrl, setDeploymentUrl] = useState("");
  const [deployKey, setDeployKey] = useState("");
  const [connecting, setConnecting] = useState(false);

  const connect = async () => {
    setConnecting(true);
    try {
      const result = await adminApp.createDataSource({
        type: "convex",
        deployment_url: deploymentUrl.trim(),
        secret: deployKey.trim(),
      });
      props.onConnected(result.dataSource, result.catalog);
    } catch (error) {
      toast({ variant: "destructive", title: "Could not connect", description: error instanceof Error ? error.message : String(error) });
    } finally {
      setConnecting(false);
    }
  };

  return (
    <PageLayout title="Connect Convex" description="A deploy key that can read your data is enough.">
      <DesignButton variant="ghost" className="self-start" onClick={props.onBack}>← Add source</DesignButton>
      <DesignCard>
        <div className="grid gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="data-source-deployment-url">Deployment URL</Label>
            <Input
              id="data-source-deployment-url"
              placeholder="https://your-deployment.convex.cloud"
              value={deploymentUrl}
              onChange={event => setDeploymentUrl(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="data-source-deploy-key">Deploy key</Label>
            <Input
              id="data-source-deploy-key"
              type="password"
              value={deployKey}
              onChange={event => setDeployKey(event.target.value)}
            />
            <Typography type="label" variant="secondary" className="text-xs">
              Generate one in your Convex dashboard with the{" "}
              <span className="font-mono">deployment:data:view</span> permission. On Convex Cloud,
              reading the change feed requires a Pro plan.
            </Typography>
          </div>
        </div>
        <SecretNote what="deploy key" />
        <div className="mt-5 flex items-center gap-3">
          <DesignButton onClick={connect} loading={connecting} disabled={deploymentUrl.trim() === "" || deployKey.trim() === ""}>Connect</DesignButton>
          <Typography type="label" variant="secondary">We will read your table list — nothing syncs yet.</Typography>
        </div>
      </DesignCard>
    </PageLayout>
  );
}

function ConnectPostgres(props: {
  onBack: () => void,
  onConnected: (dataSource: DataSourceJson, catalog: DataSourceCatalogJson) => void,
}) {
  const adminApp = useAdminApp();
  const { toast } = useToast();
  const [form, setForm] = useState({ host: "", port: "5432", database: "", username: "", password: "", sslMode: "require" });
  const [connecting, setConnecting] = useState(false);

  const connect = async () => {
    setConnecting(true);
    try {
      const result = await adminApp.createDataSource({
        type: "postgres",
        host: form.host.trim(),
        port: Number.parseInt(form.port, 10),
        database: form.database.trim(),
        username: form.username.trim(),
        ssl_mode: form.sslMode,
        secret: form.password,
      });
      props.onConnected(result.dataSource, result.catalog);
    } catch (error) {
      toast({ variant: "destructive", title: "Could not connect", description: error instanceof Error ? error.message : String(error) });
    } finally {
      setConnecting(false);
    }
  };

  const field = (key: keyof typeof form, label: string, type: "text" | "password" = "text") => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`data-source-${key}`}>{label}</Label>
      <Input
        id={`data-source-${key}`}
        type={type}
        value={form[key]}
        onChange={event => setForm(prev => ({ ...prev, [key]: event.target.value }))}
      />
    </div>
  );

  const complete = form.host.trim() !== "" && form.database.trim() !== "" && form.username.trim() !== "";

  return (
    <PageLayout title="Connect PostgreSQL" description="A read-only role is enough.">
      <DesignButton variant="ghost" className="self-start" onClick={props.onBack}>← Add source</DesignButton>
      <DesignCard>
        <div className="grid gap-4 sm:grid-cols-2">
          {field("host", "Host")}
          {field("port", "Port")}
          {field("database", "Database")}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="data-source-ssl">SSL mode</Label>
            <select
              id="data-source-ssl"
              className="h-9 rounded-md border border-input-in-card bg-transparent px-2 text-sm"
              value={form.sslMode}
              onChange={event => setForm(prev => ({ ...prev, sslMode: event.target.value }))}
            >
              <option value="require">require</option>
              <option value="verify-full">verify-full</option>
              <option value="no-verify">no-verify</option>
              <option value="disable">disable</option>
            </select>
          </div>
          {field("username", "Username")}
          {field("password", "Password", "password")}
        </div>
        <SecretNote what="password" />
        <div className="mt-5 flex items-center gap-3">
          <DesignButton onClick={connect} loading={connecting} disabled={!complete}>Connect</DesignButton>
          <Typography type="label" variant="secondary">We will read your table list — nothing syncs yet.</Typography>
        </div>
      </DesignCard>
    </PageLayout>
  );
}

function ChooseTables({ dataSource, catalog }: { dataSource: DataSourceJson, catalog: DataSourceCatalogJson }) {
  const adminApp = useAdminApp();
  const router = useRouter();
  const { toast } = useToast();

  const save = async (streams: DataSourceStreamConfig[]) => {
    try {
      await adminApp.setDataSourceStreams(dataSource.id, streams);
      router.push(`/projects/${encodeURIComponent(adminApp.projectId)}/data-warehouse/sources/${encodeURIComponent(dataSource.id)}`);
    } catch (error) {
      toast({ variant: "destructive", title: "Could not save", description: error instanceof Error ? error.message : String(error) });
    }
  };

  return (
    <PageLayout title="Choose tables" description="We picked a mode for each table. Change any of them.">
      <StreamPicker catalog={catalog} submitLabel="Start syncing" onSubmit={save} />
    </PageLayout>
  );
}
