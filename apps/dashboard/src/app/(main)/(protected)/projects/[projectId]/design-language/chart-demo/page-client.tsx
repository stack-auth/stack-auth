"use client";

import {
  DesignAnalyticsCard,
  DesignBadge,
} from "@/components/design-components";
import { LightningIcon, PulseIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PageLayout } from "../../page-layout";
import {
  AnalyticsChart,
  DEFAULT_FORMAT_KIND,
  pointValue,
  type AnalyticsChartState,
  type Annotation,
} from "@stackframe/dashboard-ui-components";
import {
  AnalyticsChartEventsPanel,
  type AnalyticsChartLabEvent,
} from "./demo/analytics-chart-events-panel";
import { AnalyticsChartStatePanel } from "./demo/analytics-chart-state-panel";
import {
  AnalyticsChartUsageViewer,
  generateAnalyticsChartUsage,
} from "./demo/analytics-chart-usage-viewer";
import {
  ANNOTATIONS,
  DEMO_DEFAULT_STATE,
  SERIES,
} from "./demo/fixtures";
import {
  FormatterPanel,
  InsightsTablePanel,
  KpiBlock,
  SectionHeading,
  ThreeStatePanel,
} from "./demo/panels";

export default function PageClient() {
  const [pulse, setPulse] = useState(0);

  // Simulated "live" heartbeat so the LIVE badge visibly breathes.
  useEffect(() => {
    const id = window.setInterval(() => setPulse((p) => p + 1), 2400);
    return () => window.clearInterval(id);
  }, []);

  const latest = SERIES[SERIES.length - 1]!;
  const firstPrev = pointValue(SERIES[0]!, "previous");
  const sumCurrent = SERIES.reduce((a, p) => a + pointValue(p, "signups"), 0);
  const sumPrev = SERIES.reduce((a, p) => a + pointValue(p, "previous"), 0);

  // AnalyticsChart is fully controlled — PageClient owns the entire state
  // object. DEMO_DEFAULT_STATE ships with the demo breakdown matrices
  // pre-wired into the primary/compare layers so the segmented view works
  // immediately.
  const [labState, setLabState] = useState<AnalyticsChartState>(DEMO_DEFAULT_STATE);
  const resetLabState = () => setLabState(DEMO_DEFAULT_STATE);

  // Annotations are a prop — PageClient owns the array and appends to it
  // whenever the chart fires onAnnotationCreate.
  const [labAnnotations, setLabAnnotations] = useState<Annotation[]>(ANNOTATIONS);

  const usageCode = useMemo(
    () =>
      generateAnalyticsChartUsage(labState, {
        data: SERIES,
        annotations: labAnnotations,
      }),
    [labState, labAnnotations],
  );

  // Lab playground: live event log subscribed to onChange diffs and the
  // discrete onAnnotationCreate callback. Capped at the most recent 16
  // entries so the panel stays compact.
  const [labEvents, setLabEvents] = useState<AnalyticsChartLabEvent[]>([]);
  const labEventIdRef = useRef(0);
  const logLabEvent = useCallback((name: string, payload: unknown) => {
    setLabEvents((prev) => {
      labEventIdRef.current += 1;
      const next: AnalyticsChartLabEvent = {
        id: labEventIdRef.current,
        ts: Date.now(),
        name,
        payload:
          payload === null
            ? "null"
            : typeof payload === "object"
              ? JSON.stringify(payload)
              : String(payload),
      };
      return [next, ...prev].slice(0, 16);
    });
  }, []);
  const clearLabEvents = useCallback(() => setLabEvents([]), []);

  // Wrap setLabState so every changed field becomes a discrete event in
  // the log. Drops rows for the controlled-state props that no longer
  // exist (hoverIndex, brush, annotationDraft) — only persistent state
  // slices and annotation creation are surfaced.
  const handleLabStateChange = useCallback<React.Dispatch<React.SetStateAction<AnalyticsChartState>>>(
    (action) => {
      setLabState((prev) => {
        const next =
          typeof action === "function"
            ? (action as (p: AnalyticsChartState) => AnalyticsChartState)(prev)
            : action;
        for (const key of Object.keys(next) as (keyof AnalyticsChartState)[]) {
          if (!Object.is(next[key], prev[key])) {
            logLabEvent(`onChange:${key}`, next[key]);
          }
        }
        return next;
      });
    },
    [logLabEvent],
  );
  const handleLabAnnotationCreate = useCallback(
    (annotation: Annotation) => {
      setLabAnnotations((prev) => [...prev, annotation]);
      logLabEvent("onAnnotationCreate", annotation);
    },
    [logLabEvent],
  );

  return (
    <PageLayout
      title="Chart interaction lab"
      description={
        <span>
          Ported patterns from PostHog&apos;s insight surface — pinnable tooltips,
          crosshair, period compare, annotations, formatter pluggability, series
          visibility, three-state shims and instant display-type switching.
          All shells use <span className="font-mono text-[11px] text-foreground">DesignAnalyticsCard</span>.
        </span>
      }
      actions={
        <div className="flex items-center gap-2">
          <DesignBadge
            label="Lab · internal"
            color="purple"
            icon={LightningIcon}
            size="sm"
          />
          <DesignBadge
            key={pulse}
            label="Live"
            color="cyan"
            icon={PulseIcon}
            size="sm"
          />
        </div>
      }
    >
      <div className="flex flex-col gap-6">
        <section>
          <SectionHeading
            index="01"
            label="Analytics chart"
            caption="Layer-based · fully controlled · mix-and-match per-layer types · live callbacks"
          />
          <div className="flex flex-col gap-4">
            <AnalyticsChartStatePanel
              state={labState}
              onChange={handleLabStateChange}
              onReset={resetLabState}
              dataLength={SERIES.length}
            />
            <DesignAnalyticsCard
              gradient="blue"
              chart={{ type: "none", tooltipType: "none", highlightMode: "none" }}
            >
              <div className="flex items-center gap-3 border-b border-foreground/[0.05] px-5 py-3.5">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Sign-ups
                </span>
                <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70">
                  30-day window
                </span>
              </div>
              <div className="px-5 py-4">
                <AnalyticsChart
                  data={SERIES}
                  annotations={labAnnotations}
                  state={labState}
                  onChange={handleLabStateChange}
                  onAnnotationCreate={handleLabAnnotationCreate}
                />
              </div>
            </DesignAnalyticsCard>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <AnalyticsChartUsageViewer code={usageCode} />
              <AnalyticsChartEventsPanel events={labEvents} onClear={clearLabEvents} />
            </div>
          </div>
        </section>

        <section>
          <SectionHeading
            index="02"
            label="KPI deltas"
            caption="Big number + previous-period comparison with trend icons"
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <KpiBlock
              label="Sign-ups · 30d"
              current={sumCurrent}
              previous={sumPrev}
              formatKind={DEFAULT_FORMAT_KIND.short}
              gradient="blue"
            />
            <KpiBlock
              label="Daily peak"
              current={Math.max(...SERIES.map((p) => pointValue(p, "signups")))}
              previous={Math.max(...SERIES.map((p) => pointValue(p, "previous")))}
              formatKind={DEFAULT_FORMAT_KIND.numeric}
              gradient="cyan"
            />
            <KpiBlock
              label="Δ vs launch"
              current={pointValue(latest, "signups")}
              previous={firstPrev}
              formatKind={DEFAULT_FORMAT_KIND.numeric}
              gradient="green"
            />
          </div>
        </section>

        <section>
          <SectionHeading
            index="03"
            label="Value formatters"
            caption="One number, five pluggable renderers"
          />
          <FormatterPanel />
        </section>

        <section>
          <SectionHeading
            index="04"
            label="State shim"
            caption="Data · loading · empty · error — one shell, four states"
          />
          <ThreeStatePanel />
        </section>

        <section>
          <SectionHeading
            index="05"
            label="Insights table"
            caption="Sortable rows with trend sparklines and delta pills"
          />
          <InsightsTablePanel />
        </section>
      </div>
    </PageLayout>
  );
}
