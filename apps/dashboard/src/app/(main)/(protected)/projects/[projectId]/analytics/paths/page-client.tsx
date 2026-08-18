"use client";

import { AppEnabledGuard } from "../../app-enabled-guard";
import { PageLayout } from "../../page-layout";
import { useAdminApp } from "../../use-admin-app";
import { DesignAnalyticsCard } from "@/components/design-components/analytics-card";
import { DesignButton } from "@/components/design-components/button";
import { Typography } from "@/components/ui";
import { SpinnerGapIcon, ArrowClockwiseIcon } from "@phosphor-icons/react";
import { runAsynchronouslyWithAlert } from "@hexclave/shared/dist/utils/promises";
import { useCallback, useEffect, useRef, useState } from "react";
import { normalizeUrlPath } from "./normalize-url";
import { computeLayout, type GraphNode, type GraphEdge } from "./force-layout";
import { buildPathsGraphPresentation } from "./graph-presentation";
import { PathsGraphCanvas } from "./paths-graph-canvas";

type TransitionRow = {
  from_path: string,
  to_path: string,
  cnt: string,
};

type PathsData = {
  nodes: GraphNode[],
  edges: GraphEdge[],
  weakEdges: GraphEdge[],
  totalNodeCount: number,
  totalEdgeCount: number,
  totalTransitionCount: number,
  visibleTransitionCount: number,
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
      ORDER BY started_at ASC
    ) as prev_path
  FROM default.spans
  WHERE span_type = '$page-view'
    AND JSONExtractString(data, 'path') != ''
    AND user_id != ''
) sub
WHERE prev_path != '' AND prev_path != path
GROUP BY from_path, to_path
ORDER BY cnt DESC
LIMIT 500
`;

const PAGE_VIEWS_QUERY = `
SELECT
  JSONExtractString(data, 'path') as path,
  any(domain(JSONExtractString(data, 'url'))) as page_domain,
  count() as views
FROM default.spans
WHERE span_type = '$page-view'
  AND JSONExtractString(data, 'path') != ''
GROUP BY path
ORDER BY views DESC
LIMIT 200
`;

const MIN_CARD_WIDTH = 100;
const MAX_CARD_WIDTH = 220;

function computeCardWidth(label: string): number {
  // ~6.5px per character in 11px monospace font, plus padding (20px)
  const textWidth = label.length * 6.5 + 20;
  return Math.max(MIN_CARD_WIDTH, Math.min(MAX_CARD_WIDTH, textWidth));
}

export default function PageClient() {
  const adminApp = useAdminApp();
  const [data, setData] = useState<PathsData | null>(null);
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

      const rows = response.result.map((r) => {
        const from_path = r.from_path;
        const to_path = r.to_path;
        const cnt = r.cnt;
        if (typeof from_path !== "string" || typeof to_path !== "string") {
          throw new Error("Unexpected navigation query result shape: from_path/to_path must be strings");
        }
        if (typeof cnt !== "string" && typeof cnt !== "number") {
          throw new Error("Unexpected navigation query result shape: cnt must be string or number");
        }
        return { from_path, to_path, cnt: String(cnt) } satisfies TransitionRow;
      });

      const edgeMap = new Map<string, Map<string, number>>();
      const nodeSet = new Set<string>();

      for (const row of rows) {
        const fromNorm = normalizeUrlPath(row.from_path);
        const toNorm = normalizeUrlPath(row.to_path);
        if (fromNorm === toNorm) continue;

        const count = Number(row.cnt);
        if (!Number.isFinite(count)) {
          throw new Error(`Invalid count value: ${row.cnt}`);
        }
        const outgoingEdges = edgeMap.get(fromNorm);
        if (outgoingEdges == null) {
          edgeMap.set(fromNorm, new Map([[toNorm, count]]));
        } else {
          outgoingEdges.set(toNorm, (outgoingEdges.get(toNorm) ?? 0) + count);
        }
        nodeSet.add(fromNorm);
        nodeSet.add(toNorm);
      }

      // Query page views and domain info
      const pvResponse = await adminApp.queryAnalytics({
        query: PAGE_VIEWS_QUERY,
        include_all_branches: false,
        timeout_ms: 30000,
      });

      const pageViewsMap = new Map<string, { views: number, domain: string }>();
      for (const row of pvResponse.result) {
        const path = row.path;
        const domain = row.page_domain;
        const views = row.views;
        if (typeof path !== "string" || typeof domain !== "string") {
          throw new Error("Unexpected page views query result shape: path/page_domain must be strings");
        }
        if (typeof views !== "string" && typeof views !== "number") {
          throw new Error("Unexpected page views query result shape: views must be string or number");
        }
        const normPath = normalizeUrlPath(path);
        const existing = pageViewsMap.get(normPath);
        const viewCount = Number(views);
        if (!Number.isFinite(viewCount)) {
          throw new Error(`Invalid page view count value: ${views}`);
        }
        if (existing == null) {
          pageViewsMap.set(normPath, { views: viewCount, domain });
        } else {
          existing.views += viewCount;
          if (existing.domain === "") {
            existing.domain = domain;
          }
        }
      }

      const nodeArray: GraphNode[] = Array.from(nodeSet).map((path) => {
        const pvInfo = pageViewsMap.get(path);
        return {
          id: path,
          label: path,
          domain: pvInfo?.domain ?? "",
          pageViews: pvInfo?.views ?? 0,
          width: computeCardWidth(path),
          x: 0,
          y: 0,
        };
      });

      const allEdges: { from: string, to: string, count: number, weight: number }[] = [];
      for (const [from, outgoingEdges] of edgeMap) {
        for (const [to, count] of outgoingEdges) {
          allEdges.push({
            from,
            to,
            count,
            weight: count,
          });
        }
      }

      const presentation = buildPathsGraphPresentation(nodeArray, allEdges);
      // Layout only the traffic backbone. Long-tail edges between these pages
      // remain available on focus, while pages outside the overview do not
      // force the entire canvas to zoom down to illegible labels.
      const laidOutNodes = computeLayout(presentation.nodes, presentation.edges);

      setData({
        ...presentation,
        nodes: laidOutNodes,
        weakEdges: presentation.contextualEdges,
      });
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
        title="Paths"
        description="Explore the routes users take between product events."
        fillWidth
        containedHeight
        actions={
          <DesignButton
            className="gap-1.5"
            variant="secondary"
            loading={loading}
            onClick={loadData}
          >
            <ArrowClockwiseIcon className="h-4 w-4" />
            Refresh
          </DesignButton>
        }
      >
        <DesignAnalyticsCard gradient="slate" className="flex-1 overflow-hidden">
          {loading && (
            <div className="flex items-center justify-center h-full">
              <SpinnerGapIcon className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}
          {error != null && !loading && (
            <div className="flex flex-col items-center justify-center h-full gap-3">
              <Typography variant="secondary" className="text-sm">{error}</Typography>
              <DesignButton variant="secondary" onClick={loadData}>
                Retry
              </DesignButton>
            </div>
          )}
          {data != null && data.nodes.length === 0 && !loading && error == null && (
            <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
              <Typography className="text-sm font-medium">No navigation paths yet</Typography>
              <Typography variant="secondary" className="text-sm">
                Paths will appear after users navigate between tracked pages.
              </Typography>
            </div>
          )}
          {data != null && data.nodes.length > 0 && !loading && error == null && (
            <PathsGraphCanvas
              nodes={data.nodes}
              edges={data.edges}
              weakEdges={data.weakEdges}
              totalNodeCount={data.totalNodeCount}
              totalEdgeCount={data.totalEdgeCount}
              totalTransitionCount={data.totalTransitionCount}
              visibleTransitionCount={data.visibleTransitionCount}
            />
          )}
        </DesignAnalyticsCard>
      </PageLayout>
    </AppEnabledGuard>
  );
}
