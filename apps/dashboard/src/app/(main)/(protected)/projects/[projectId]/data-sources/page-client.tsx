"use client";

import { DesignBadge } from "@/components/design-components";
import { useRouter } from "@/components/router";
import { Alert, Button, Card, Spinner, Typography } from "@/components/ui";
import { getAppStageLabel } from "@/lib/apps-utils";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import { urlString } from "@hexclave/shared/dist/utils/urls";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppEnabledGuard } from "../app-enabled-guard";
import { PageLayout } from "../page-layout";
import { useAdminApp, useProjectId } from "../use-admin-app";
import {
  fetchCatalogue, fetchSources,
  type AdminAppWithInternals, type ConnectorDto, type SourceListItem,
} from "./api";
import { Catalogue } from "./catalogue";
import { ConnectWizard } from "./connect-wizard";
import { SourceDetail } from "./source-detail";
import { ConnectorMark, SourceStatusBadge, formatSchedule, formatTimestamp } from "./shared";

// The Data Sources app (alpha). Available to any project that installs
// `data-sources-alpha`; alpha apps are hidden from the app-store listing outside
// development, so installing is a deliberate config action. The backend is NOT
// gated on the app being installed — as with every other app, the API is
// available regardless and this guard is UX.

const stageLabel = getAppStageLabel("data-sources-alpha");

type View =
  | { kind: "list" }
  | { kind: "catalogue" }
  | { kind: "wizard", connector: ConnectorDto };

export default function PageClient() {
  const projectId = useProjectId();
  const adminApp = useAdminApp() as unknown as AdminAppWithInternals;
  const router = useRouter();
  const pathname = usePathname();

  // The detail route (/data-sources/<id>) renders through this same client, so
  // the list stays mounted and navigation between them costs no refetch.
  const marker = "/data-sources/";
  const markerIndex = pathname.indexOf(marker);
  const selectedSourceId = markerIndex === -1
    ? null
    : decodeURIComponent(pathname.slice(markerIndex + marker.length).split("/")[0]) || null;

  const [view, setView] = useState<View>({ kind: "list" });
  const [sources, setSources] = useState<SourceListItem[] | null>(null);
  const [connectors, setConnectors] = useState<ConnectorDto[]>([]);
  const [error, setError] = useState<string | null>(null);

  const loadSources = useCallback(async () => {
    try {
      setSources(await fetchSources(adminApp));
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  }, [adminApp]);

  useEffect(() => {
    runAsynchronously(loadSources());
    runAsynchronously((async () => {
      try {
        const catalogue = await fetchCatalogue(adminApp);
        setConnectors(catalogue.connectors);
      } catch {
        // The catalogue is only needed to add a source; a failure here must not
        // stop existing sources from rendering.
      }
    })());
  }, [adminApp, loadSources]);

  const anySyncing = useMemo(
    () => (sources ?? []).some(source => source.status === "SYNCING"),
    [sources],
  );
  useEffect(() => {
    if (!anySyncing || selectedSourceId != null) return;
    const timer = setInterval(() => runAsynchronously(loadSources()), 3000);
    return () => clearInterval(timer);
  }, [anySyncing, selectedSourceId, loadSources]);

  const goToList = () => router.push(urlString`/projects/${projectId}/data-sources`);

  return (
    <AppEnabledGuard appId="data-sources-alpha">
      <PageLayout
        title="Data Sources"
        description={
          <span className="flex items-center gap-2">
            Connect external systems and query their data alongside your own.
            {stageLabel != null && <DesignBadge label={stageLabel} color="purple" size="sm" />}
          </span>
        }
        actions={
          selectedSourceId == null && view.kind === "list" ? (
            <Button onClick={() => setView({ kind: "catalogue" })}>Add source</Button>
          ) : undefined
        }
      >
        {selectedSourceId != null ? (
          <SourceDetail
            adminApp={adminApp}
            sourceId={selectedSourceId}
            onClose={goToList}
            onDeleted={() => {
              runAsynchronously(loadSources());
              goToList();
            }}
          />
        ) : view.kind === "catalogue" ? (
          <Catalogue
            connectors={connectors}
            onSelect={connector => setView({ kind: "wizard", connector })}
            onCancel={() => setView({ kind: "list" })}
          />
        ) : view.kind === "wizard" ? (
          <ConnectWizard
            adminApp={adminApp}
            connector={view.connector}
            onCancel={() => setView({ kind: "catalogue" })}
            onCreated={sourceId => {
              setView({ kind: "list" });
              runAsynchronously(loadSources());
              router.push(urlString`/projects/${projectId}/data-sources/${sourceId}`);
            }}
          />
        ) : (
          <SourceList
            sources={sources}
            error={error}
            onOpen={sourceId => router.push(urlString`/projects/${projectId}/data-sources/${sourceId}`)}
            onAdd={() => setView({ kind: "catalogue" })}
          />
        )}
      </PageLayout>
    </AppEnabledGuard>
  );
}

function SourceList(props: {
  sources: SourceListItem[] | null,
  error: string | null,
  onOpen: (sourceId: string) => void,
  onAdd: () => void,
}) {
  if (props.error != null) {
    return (
      <Alert variant="destructive">
        <Typography className="text-sm">{props.error}</Typography>
      </Alert>
    );
  }
  if (props.sources == null) {
    return <div className="flex justify-center p-8"><Spinner /></div>;
  }
  if (props.sources.length === 0) {
    return (
      <Card className="flex flex-col items-center gap-3 p-10 text-center">
        <Typography type="h3" className="text-lg font-semibold">No data sources yet</Typography>
        <Typography variant="secondary" className="max-w-md text-sm">
          Import data from Stripe, Klaviyo, Intercom, or any REST API, then query it
          alongside your own users, teams, and events.
        </Typography>
        <Button onClick={props.onAdd}>Add source</Button>
      </Card>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {props.sources.map(source => (
        <button
          key={source.id}
          type="button"
          onClick={() => props.onOpen(source.id)}
          className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 text-left transition hover:border-foreground/30 hover:shadow-sm"
        >
          <ConnectorMark name={source.connector_display_name} size="md" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Typography className="truncate font-medium">{source.display_name}</Typography>
              <SourceStatusBadge status={source.status} />
              {source.has_pending_drift && <DesignBadge label="Schema changed" color="orange" size="sm" />}
              {!source.connector_available && <DesignBadge label="Connector unavailable" color="red" size="sm" />}
            </div>
            <Typography variant="secondary" className="text-xs">
              {source.connector_display_name} · {source.enabled_stream_count}/{source.total_stream_count} streams
              {" · "}{formatSchedule(source.schedule_kind, source.schedule_value)}
              {" · last synced "}{formatTimestamp(source.last_synced_at)}
            </Typography>
            {source.last_error != null && (
              <Typography className="mt-1 line-clamp-1 font-mono text-xs text-destructive">
                {source.last_error}
              </Typography>
            )}
          </div>
        </button>
      ))}
    </div>
  );
}
