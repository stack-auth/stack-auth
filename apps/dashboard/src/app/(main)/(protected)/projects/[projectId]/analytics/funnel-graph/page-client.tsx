"use client";

import { AppEnabledGuard } from "../../app-enabled-guard";
import { PageLayout } from "../../page-layout";
import { useAdminApp } from "../../use-admin-app";
import { Button, Typography } from "@/components/ui";
import { SpinnerGapIcon, ArrowClockwiseIcon } from "@phosphor-icons/react";
import { runAsynchronouslyWithAlert } from "@hexclave/shared/dist/utils/promises";
import { useCallback, useEffect, useRef, useState } from "react";
import { normalizeUrlPath } from "./normalize-url";
import { computeForceLayout, type GraphNode, type GraphEdge } from "./force-layout";
import { FunnelGraphCanvas } from "./funnel-graph-canvas";

type TransitionRow = {
  from_path: string,
  to_path: string,
  cnt: string,
};

type FunnelData = {
  nodes: GraphNode[],
  edges: GraphEdge[],
};

const NAVIGATION_QUERY = `
SELECT
  prev_path as from_path,
  path as to_path,
  count() as cnt
FROM (
  SELECT
    user_id,
    JSONExtractString(data, 'path') as path,
    lagInFrame(JSONExtractString(data, 'path')) OVER (
      PARTITION BY user_id
      ORDER BY event_at ASC
    ) as prev_path
  FROM default.events
  WHERE event_type = '$page-view'
    AND JSONExtractString(data, 'path') != ''
    AND user_id != ''
) sub
WHERE prev_path != '' AND prev_path != path
GROUP BY from_path, to_path
ORDER BY cnt DESC
LIMIT 500
`;

export default function PageClient() {
  const adminApp = useAdminApp();
  const [data, setData] = useState<FunnelData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadedRef = useRef(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await adminApp.queryAnalytics({
        query: NAVIGATION_QUERY,
        include_all_branches: false,
        timeout_ms: 30000,
      });

      const rows = response.result as TransitionRow[];

      // Normalize paths and aggregate
      const edgeMap = new Map<string, number>();
      const nodeSet = new Set<string>();

      for (const row of rows) {
        const fromNorm = normalizeUrlPath(row.from_path);
        const toNorm = normalizeUrlPath(row.to_path);
        if (fromNorm === toNorm) continue;

        const key = `${fromNorm}\0${toNorm}`;
        const count = Number(row.cnt);
        edgeMap.set(key, (edgeMap.get(key) ?? 0) + count);
        nodeSet.add(fromNorm);
        nodeSet.add(toNorm);
      }

      // Build nodes
      const nodeArray: GraphNode[] = Array.from(nodeSet).map((path) => ({
        id: path,
        label: path,
        x: 0,
        y: 0,
      }));

      // Build edges with logarithmic weight
      const edges: GraphEdge[] = [];
      for (const [key, count] of edgeMap) {
        const [from, to] = key.split("\0") as [string, string];
        edges.push({
          from,
          to,
          count,
          weight: Math.log2(count + 1),
        });
      }

      // Compute force-directed layout
      const laidOutNodes = computeForceLayout(nodeArray, edges);

      setData({ nodes: laidOutNodes, edges });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [adminApp]);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    runAsynchronouslyWithAlert(loadData);
  }, [loadData]);

  return (
    <AppEnabledGuard appId="analytics">
      <PageLayout
        title="Navigation Funnel"
        description="Visualize user navigation flows between pages."
        fillWidth
        containedHeight
        actions={
          <Button
            className="gap-1.5"
            variant="secondary"
            disabled={loading}
            onClick={() => runAsynchronouslyWithAlert(loadData)}
          >
            <ArrowClockwiseIcon className="h-4 w-4" />
            Refresh
          </Button>
        }
      >
        <div className="flex-1 min-h-0 rounded-2xl border border-black/[0.06] bg-white/90 shadow-[0_2px_12px_rgba(0,0,0,0.04)] backdrop-blur-xl dark:border-white/[0.06] dark:bg-zinc-900/90 overflow-hidden">
          {loading && (
            <div className="flex items-center justify-center h-full">
              <SpinnerGapIcon className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}
          {error != null && !loading && (
            <div className="flex flex-col items-center justify-center h-full gap-3">
              <Typography variant="secondary" className="text-sm">{error}</Typography>
              <Button variant="secondary" onClick={() => runAsynchronouslyWithAlert(loadData)}>
                Retry
              </Button>
            </div>
          )}
          {data != null && !loading && error == null && (
            <FunnelGraphCanvas nodes={data.nodes} edges={data.edges} />
          )}
        </div>
      </PageLayout>
    </AppEnabledGuard>
  );
}
