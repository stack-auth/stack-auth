"use client";

import { DesignBadge, DesignButton, DesignInput, DesignPillToggle } from "@/components/design-components";
import { StyledLink } from "@/components/link";
import { Avatar, AvatarFallback, AvatarImage, Skeleton } from "@/components/ui";
import { SimpleTooltip } from "@/components/ui/simple-tooltip";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { ArrowClockwiseIcon, CaretDownIcon, CursorClickIcon, DesktopIcon, DeviceMobileIcon, DeviceTabletIcon, DevicesIcon, GridFourIcon, MonitorIcon, MonitorPlayIcon, PathIcon, PlayIcon, UserCircleIcon, XIcon } from "@phosphor-icons/react";
import { TooltipPortal } from "@radix-ui/react-tooltip";
import type { AnalyticsHeatmapDevice, AnalyticsHeatmapResponse } from "@stackframe/stack-shared/dist/interface/admin-metrics";
import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { AppEnabledGuard } from "../../app-enabled-guard";
import { PageLayout } from "../../page-layout";
import { useAdminApp } from "../../use-admin-app";
import { AnalyticsEventLimitBanner } from "../shared";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const ALL_DEVICES_VALUE = "all";
const ROUTE_ROW_TOOLTIP_DELAY_MS = 420;

type DeviceFilter = AnalyticsHeatmapDevice | typeof ALL_DEVICES_VALUE;
type BackgroundMode = "grid" | "replay";
type RrwebEventWithTime = import("rrweb/typings/types").eventWithTime;
type RrwebReplayer = InstanceType<typeof import("rrweb").Replayer>;
type HeatmapFrameRect = {
  left: number,
  top: number,
  width: number,
  height: number,
};

type LoadState =
  | { status: "loading" }
  | { status: "error", message: string }
  | { status: "ready", data: AnalyticsHeatmapResponse };

function formatCompact(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
}

function parseDeviceFilter(value: string): DeviceFilter {
  switch (value) {
    case ALL_DEVICES_VALUE:
    case "tv":
    case "widescreen":
    case "desktop":
    case "laptop":
    case "tablet":
    case "mobile": {
      return value;
    }
    default: {
      throw new Error(`Unknown heatmap device filter "${value}"`);
    }
  }
}

function escapeRegexLiteral(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getUserLabel(user: AnalyticsHeatmapResponse["users"][number]) {
  return user.display_name ?? user.primary_email ?? user.id;
}

function getUserInitials(user: AnalyticsHeatmapResponse["users"][number]) {
  return getUserLabel(user).slice(0, 2).toUpperCase();
}

function isRrwebEventWithTime(value: unknown): value is RrwebEventWithTime {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const timestamp = Reflect.get(value, "timestamp");
  const type = Reflect.get(value, "type");
  return typeof timestamp === "number" && Number.isFinite(timestamp) && (typeof type === "number" || typeof type === "string");
}

function getReferenceReplayId(replays: AnalyticsHeatmapResponse["replays"], selectedReplayId: string | null) {
  if (selectedReplayId != null) {
    return selectedReplayId;
  }
  return replays
    .slice()
    .sort((a, b) => b.last_event_at_millis - a.last_event_at_millis)[0]?.id ?? null;
}

export default function PageClient() {
  const adminApp = useAdminApp();
  const project = adminApp.useProject();
  const [routeRegex, setRouteRegex] = useState("");
  const [selectedReplayId, setSelectedReplayId] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [deviceFilter, setDeviceFilter] = useState<DeviceFilter>(ALL_DEVICES_VALUE);
  const [backgroundMode, setBackgroundMode] = useState<BackgroundMode>("replay");
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const loadGenerationRef = useRef(0);

  const load = useCallback(async () => {
    const generation = loadGenerationRef.current + 1;
    loadGenerationRef.current = generation;
    setState({ status: "loading" });
    try {
      const data = await adminApp.getAnalyticsHeatmap({
        kind: "session_replay_clicks",
        route_regex: routeRegex.trim() || undefined,
        replay_id: selectedReplayId ?? undefined,
        user_id: selectedUserId ?? undefined,
        device: deviceFilter === ALL_DEVICES_VALUE ? undefined : deviceFilter,
        since: new Date(Date.now() - 28 * ONE_DAY_MS).toISOString(),
        until: new Date().toISOString(),
      });
      if (loadGenerationRef.current !== generation) {
        return;
      }
      setState({ status: "ready", data });
    } catch (error) {
      if (loadGenerationRef.current !== generation) {
        return;
      }
      setState({ status: "error", message: error instanceof Error ? error.message : "Failed to load route heatmap" });
    }
  }, [adminApp, routeRegex, selectedReplayId, selectedUserId, deviceFilter]);

  useEffect(() => {
    runAsynchronously(load);
  }, [load]);

  const data = state.status === "ready" ? state.data : null;
  const maxPoint = Math.max(0, ...(data?.points.map((point) => point.count) ?? []));
  const routes = useMemo(() => data?.routes ?? [], [data?.routes]);
  const referenceReplayId = data == null ? null : getReferenceReplayId(data.replays, selectedReplayId);
  const hasActiveFilters = routeRegex.trim() !== "" || deviceFilter !== ALL_DEVICES_VALUE || selectedReplayId != null || selectedUserId != null;

  const clearFilters = useCallback(() => {
    setRouteRegex("");
    setSelectedReplayId(null);
    setSelectedUserId(null);
    setDeviceFilter(ALL_DEVICES_VALUE);
  }, []);

  const selectDeviceFilter = useCallback((value: string) => {
    setDeviceFilter(parseDeviceFilter(value));
    setSelectedReplayId(null);
  }, []);

  return (
    <PageLayout
      title="Route heatmaps"
      description="Session replay click density grouped by route."
      fillWidth
    >
      <AppEnabledGuard appId="analytics">
        <AnalyticsEventLimitBanner />
        <PanelGroup direction="horizontal" className="min-h-[760px] flex-1 overflow-hidden rounded-xl border border-border/40 bg-background">
          <Panel defaultSize={28} minSize={20} maxSize={42}>
            <div className="flex h-full flex-col">
              <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border/30 px-3">
                <div className="min-w-0 truncate text-sm font-medium">
                  Heatmaps{!state.status.startsWith("loading") && routes.length > 0 ? ` (${routes.length})` : ""}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <SimpleTooltip tooltip="Clear filters" disabled={!hasActiveFilters}>
                    <DesignButton size="sm" variant="secondary" onClick={clearFilters} disabled={!hasActiveFilters} aria-label="Clear filters" className="h-7 w-7 p-0">
                      <XIcon className="h-3.5 w-3.5" />
                    </DesignButton>
                  </SimpleTooltip>
                  <SimpleTooltip tooltip="Refresh heatmaps">
                    <DesignButton size="sm" variant="secondary" onClick={load} disabled={state.status === "loading"} aria-label="Refresh heatmaps" className="h-7 w-7 p-0">
                      <ArrowClockwiseIcon className="h-3.5 w-3.5" />
                    </DesignButton>
                  </SimpleTooltip>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto divide-y divide-foreground/[0.08]">
                <HeatmapAccordionSection title="Routes" icon={<PathIcon className="h-3.5 w-3.5" />}>
                  <div className="flex max-h-[380px] flex-col gap-3 overflow-auto pb-3 pr-1">
                    <DesignInput value={routeRegex} onChange={(e) => setRouteRegex(e.target.value)} placeholder="Filter routes or regex, e.g. /projects or ^/projects/.*" className="h-8 text-xs" />
                    <button
                      type="button"
                      onClick={() => {
                        setRouteRegex("");
                        setSelectedReplayId(null);
                        setSelectedUserId(null);
                      }}
                      className={cn(
                        "rounded-lg px-3 py-2 text-left transition-colors duration-150 hover:transition-none",
                        routeRegex.trim() === "" ? "bg-cyan-500/10 ring-1 ring-cyan-500/20" : "hover:bg-foreground/[0.04]",
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">All routes</span>
                        <DesignBadge label={formatCompact(routes.reduce((sum, route) => sum + route.clicks, 0))} color="cyan" size="sm" />
                      </div>
                      <div className="mt-1 text-[10px] text-muted-foreground">Combined click heatmap</div>
                    </button>
                    {state.status === "loading" ? (
                      <div className="flex flex-col gap-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)}</div>
                    ) : routes.length === 0 ? (
                      <EmptyPanel label="No routes have replay clicks in this slice." />
                    ) : (
                      <div className="flex flex-col gap-1">
                        {routes.map((route) => (
                          <RouteListItem
                            key={route.path}
                            route={route}
                            isSelected={routeRegex.trim() === `^${escapeRegexLiteral(route.path)}$`}
                            onSelect={() => {
                              setRouteRegex(`^${escapeRegexLiteral(route.path)}$`);
                              setSelectedReplayId(null);
                              setSelectedUserId(null);
                            }}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </HeatmapAccordionSection>

                <HeatmapAccordionSection title="Device" icon={<DevicesIcon className="h-3.5 w-3.5" />}>
                  <div className="pb-3">
                    <DesignPillToggle
                      selected={deviceFilter}
                      onSelect={selectDeviceFilter}
                      options={[
                        { id: ALL_DEVICES_VALUE, label: "All devices", icon: DevicesIcon },
                        { id: "tv", label: "TV", icon: MonitorIcon },
                        { id: "widescreen", label: "Widescreen", icon: MonitorIcon },
                        { id: "desktop", label: "Desktop", icon: DesktopIcon },
                        { id: "laptop", label: "Laptop", icon: DesktopIcon },
                        { id: "tablet", label: "Tablet", icon: DeviceTabletIcon },
                        { id: "mobile", label: "Mobile", icon: DeviceMobileIcon },
                      ]}
                      size="sm"
                      gradient="cyan"
                      showLabels={false}
                      className="flex w-full justify-between"
                    />
                  </div>
                </HeatmapAccordionSection>

                <HeatmapAccordionSection title="Clickmaps" icon={<CursorClickIcon className="h-3.5 w-3.5" />}>
                  <div className="flex max-h-64 flex-col gap-1 overflow-auto pb-3 pr-1">
                    {(data?.selectors ?? []).length === 0 ? <EmptyPanel label="No captured selectors in this slice." /> : data?.selectors.map((selector, index) => (
                      <div
                        key={selector.selector}
                        className="rounded-lg px-3 py-2 transition-colors duration-150 hover:transition-none hover:bg-foreground/[0.04]"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate font-mono text-xs">{index + 1}. {selector.selector}</span>
                          <DesignBadge label={formatCompact(selector.clicks)} color="cyan" size="sm" />
                        </div>
                        <div className="mt-1 text-[10px] text-muted-foreground">Autocaptured element clicks</div>
                      </div>
                    ))}
                  </div>
                </HeatmapAccordionSection>

                <HeatmapAccordionSection title="Users" icon={<UserCircleIcon className="h-3.5 w-3.5" />}>
                  <div className="flex max-h-64 flex-col gap-1 overflow-auto pb-3 pr-1">
                    {(data?.users ?? []).length === 0 ? <EmptyPanel label="No linked users." /> : data?.users.map((user) => (
                      <button
                        key={user.id}
                        type="button"
                        onClick={() => {
                          setSelectedUserId(user.id);
                            setSelectedReplayId(null);
                        }}
                        className={cn("rounded-lg px-3 py-2 text-left transition-colors duration-150 hover:transition-none", selectedUserId === user.id ? "bg-emerald-500/10 ring-1 ring-emerald-500/20" : "hover:bg-foreground/[0.04]")}
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <Avatar className="h-7 w-7 shrink-0">
                            <AvatarImage src={user.profile_image_url ?? undefined} alt={getUserLabel(user)} />
                            <AvatarFallback className="text-[10px]">{getUserInitials(user)}</AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <div className="truncate text-xs font-medium">{getUserLabel(user)}</div>
                            <div className="mt-0.5 truncate text-[10px] text-muted-foreground">{formatCompact(user.clicks)} clicks · {formatCompact(user.replays)} replays</div>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </HeatmapAccordionSection>

                <HeatmapAccordionSection title="Recordings" icon={<MonitorPlayIcon className="h-3.5 w-3.5" />}>
                  <div className="flex max-h-64 flex-col gap-1 overflow-auto pb-3 pr-1">
                    {(data?.replays ?? []).length === 0 ? <EmptyPanel label="No linked recordings." /> : data?.replays.map((replay) => (
                      <button
                        key={replay.id}
                        type="button"
                        onClick={() => {
                            setSelectedReplayId(replay.id);
                            setSelectedUserId(null);
                        }}
                        className={cn("rounded-lg px-3 py-2 text-left transition-colors duration-150 hover:transition-none", selectedReplayId === replay.id ? "bg-cyan-500/10 ring-1 ring-cyan-500/20" : "hover:bg-foreground/[0.04]")}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate font-mono text-xs">{replay.id}</span>
                          <DesignBadge label={formatCompact(replay.clicks)} color="cyan" size="sm" />
                        </div>
                        <div className="mt-1 truncate text-[10px] text-muted-foreground">
                          {replay.viewport_width ?? "?"}x{replay.viewport_height ?? "?"}
                        </div>
                      </button>
                    ))}
                  </div>
                </HeatmapAccordionSection>

                <HeatmapAccordionSection title="Player" icon={<PlayIcon className="h-3.5 w-3.5" />}>
                  <div className="pb-3">
                    {selectedReplayId ? (
                      <StyledLink href={`/projects/${project.id}/session-replays/${selectedReplayId}`} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-cyan-600 transition-colors duration-150 hover:transition-none hover:bg-cyan-500/10">
                        <PlayIcon className="h-3.5 w-3.5" />
                        Open replay player
                      </StyledLink>
                    ) : (
                      <EmptyPanel label="Select a replay to open the player." />
                    )}
                  </div>
                </HeatmapAccordionSection>
              </div>
            </div>
          </Panel>

          <PanelResizeHandle className="w-px bg-border/40 transition-colors hover:transition-none hover:bg-border" />

          <Panel defaultSize={72} minSize={45}>
            <div className="flex h-full flex-col">
              <div className="flex h-10 shrink-0 items-center justify-between gap-3 border-b border-border/30 px-3 py-2">
                <div className="truncate text-sm font-medium">
                  {routeRegex.trim() || "All routes"}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <DesignPillToggle
                    selected={backgroundMode}
                    onSelect={(value) => setBackgroundMode(value === "grid" ? "grid" : "replay")}
                    options={[
                      { id: "replay", label: "Replay", icon: MonitorPlayIcon },
                      { id: "grid", label: "Grid", icon: GridFourIcon },
                    ]}
                    size="sm"
                    gradient="cyan"
                    showLabels
                  />
                  <div className="text-xs text-muted-foreground">
                    {deviceFilter === ALL_DEVICES_VALUE ? "All devices" : deviceFilter}
                  </div>
                </div>
              </div>
              <div className="flex-1 overflow-auto p-4">
                {state.status === "error" ? (
                  <EmptyPanel label={state.message} />
                ) : state.status === "loading" ? (
                  <Skeleton className="h-full min-h-[620px] rounded-2xl" />
                ) : (
                  <ReplayHeatmap
                    adminApp={adminApp}
                    points={state.data.points}
                    max={maxPoint}
                    selectedReplayId={selectedReplayId}
                    backgroundMode={backgroundMode}
                    referenceReplayId={referenceReplayId}
                  />
                )}
              </div>
            </div>
          </Panel>
        </PanelGroup>
      </AppEnabledGuard>
    </PageLayout>
  );
}

function RouteListItem({ route, isSelected, onSelect }: {
  route: AnalyticsHeatmapResponse["routes"][number],
  isSelected: boolean,
  onSelect: () => void,
}) {
  const metrics = [
    { label: "Clicks", value: route.clicks, icon: CursorClickIcon },
    { label: "Users", value: route.users, icon: UserCircleIcon },
    { label: "Recordings", value: route.replays, icon: MonitorPlayIcon },
  ];

  return (
    <Tooltip delayDuration={ROUTE_ROW_TOOLTIP_DELAY_MS} disableHoverableContent={false}>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onSelect}
          aria-label={`Select route ${route.path}`}
          className={cn(
            "grid h-10 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-3 text-left transition-colors duration-150 hover:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/45",
            isSelected ? "bg-cyan-500/10 ring-1 ring-cyan-500/20" : "hover:bg-foreground/[0.04]",
          )}
        >
          <span className="min-w-0 truncate font-mono text-xs text-foreground">{route.path}</span>
          <span className="flex shrink-0 items-center gap-2 text-[10px] text-muted-foreground">
            {metrics.map((metric) => {
              const Icon = metric.icon;
              return (
                <span key={metric.label} className="inline-flex min-w-0 items-center gap-0.5 tabular-nums" aria-label={`${formatCompact(metric.value)} ${metric.label.toLowerCase()}`}>
                  <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span>{formatCompact(metric.value)}</span>
                </span>
              );
            })}
          </span>
        </button>
      </TooltipTrigger>
      <TooltipPortal>
        <TooltipContent side="right" align="start" sideOffset={8} className="max-w-96 p-3 text-left">
          <div className="space-y-2">
            <div>
              <div className="mb-1 text-[10px] font-medium uppercase text-primary-foreground/70">Route</div>
              <div className="break-all font-mono text-xs">{route.path}</div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {metrics.map((metric) => {
                const Icon = metric.icon;
                return (
                  <div key={metric.label} className="rounded-md bg-primary-foreground/10 px-2 py-1.5">
                    <div className="flex items-center gap-1 text-[10px] text-primary-foreground/70">
                      <Icon className="h-3.5 w-3.5" aria-hidden />
                      {metric.label}
                    </div>
                    <div className="mt-0.5 text-xs font-medium tabular-nums">{formatCompact(metric.value)}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </TooltipContent>
      </TooltipPortal>
    </Tooltip>
  );
}

function HeatmapAccordionSection({ title, icon, children }: { title: string, icon: ReactNode, children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <section className="px-3">
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
        className="flex w-full items-center justify-between py-3 text-xs font-medium transition-colors duration-150 hover:transition-none hover:text-foreground"
      >
        <span className="flex items-center gap-2">
          {icon}
          {title}
        </span>
        <CaretDownIcon className={cn("h-3.5 w-3.5 text-muted-foreground", isOpen ? "rotate-180" : "")} />
      </button>
      {isOpen ? children : null}
    </section>
  );
}

function ReplayHeatmap({ adminApp, points, max, selectedReplayId, backgroundMode, referenceReplayId }: {
  adminApp: ReturnType<typeof useAdminApp>,
  points: AnalyticsHeatmapResponse["points"],
  max: number,
  selectedReplayId: string | null,
  backgroundMode: BackgroundMode,
  referenceReplayId: string | null,
}) {
  const [servedFrameRect, setServedFrameRect] = useState<HeatmapFrameRect | null>(null);
  const heatmapFrameRect = backgroundMode === "replay" && servedFrameRect != null ? servedFrameRect : null;
  const heatmapSizeScale = heatmapFrameRect == null ? 1 : Math.max(0.55, Math.min(1.35, Math.min(heatmapFrameRect.width, heatmapFrameRect.height) / 700));

  useEffect(() => {
    if (backgroundMode !== "replay") {
      setServedFrameRect(null);
    }
  }, [backgroundMode]);

  return (
    <div className="relative mx-auto aspect-[16/10] min-h-[620px] w-full overflow-hidden rounded-2xl bg-background ring-1 ring-foreground/[0.08]">
      {backgroundMode === "replay" && referenceReplayId != null ? (
        <ReplayBackgroundFrame adminApp={adminApp} replayId={referenceReplayId} onFrameRectChange={setServedFrameRect} />
      ) : (
        <NormalizedHeatmapFrame selectedReplayId={selectedReplayId} />
      )}
      <div
        className="absolute pointer-events-none"
        style={heatmapFrameRect == null ? { inset: 0 } : {
          left: heatmapFrameRect.left,
          top: heatmapFrameRect.top,
          width: heatmapFrameRect.width,
          height: heatmapFrameRect.height,
        }}
      >
        {points.map((point, index) => {
          const intensity = max > 0 ? point.count / max : 0;
          const size = (16 + intensity * 76) * heatmapSizeScale;
          return (
            <span
              key={`${point.x_percent}:${point.y_percent}:${index}`}
              className="absolute rounded-full blur-lg"
              title={`${formatCompact(point.count)} clicks`}
              style={{
                left: `${point.x_percent}%`,
                top: `${point.y_percent}%`,
                width: size,
                height: size,
                transform: "translate(-50%, -50%)",
                backgroundColor: intensity > 0.66 ? "rgba(239, 68, 68, 0.45)" : intensity > 0.33 ? "rgba(245, 158, 11, 0.42)" : "rgba(6, 182, 212, 0.38)",
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

function ReplayBackgroundFrame({ adminApp, replayId, onFrameRectChange }: {
  adminApp: ReturnType<typeof useAdminApp>,
  replayId: string,
  onFrameRectChange: (rect: HeatmapFrameRect | null) => void,
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const replayerRef = useRef<RrwebReplayer | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    const root = rootRef.current;
    if (root == null) {
      return;
    }

    let cancelled = false;
    setStatus("loading");
    onFrameRectChange(null);
    root.replaceChildren();
    replayerRef.current = null;
    resizeObserverRef.current?.disconnect();
    resizeObserverRef.current = null;

    runAsynchronously(async () => {
      const response = await adminApp.getSessionReplayEvents(replayId, { offset: 0, limit: 20 });
      if (cancelled) {
        return;
      }

      const events = response.chunkEvents
        .flatMap((chunk) => chunk.events)
        .filter(isRrwebEventWithTime);

      if (events.length === 0) {
        throw new Error("No replay snapshot events were available for the heatmap background.");
      }

      const { Replayer } = await import("rrweb");

      const replayer = new Replayer(events, {
        root,
        speed: 1,
        skipInactive: true,
        triggerFocus: false,
        mouseTail: false,
      });
      replayerRef.current = replayer;

      root.style.position = "relative";
      root.style.width = "100%";
      root.style.height = "100%";
      root.style.overflow = "hidden";

      replayer.wrapper.style.margin = "0";
      replayer.wrapper.style.position = "absolute";
      replayer.wrapper.style.transformOrigin = "top left";
      replayer.iframe.style.border = "0";
      replayer.iframe.style.pointerEvents = "none";

      const updateScale = () => {
        const containerWidth = root.clientWidth;
        const containerHeight = root.clientHeight;
        const replayWidth = replayer.wrapper.offsetWidth;
        const replayHeight = replayer.wrapper.offsetHeight;
        if (containerWidth <= 0 || containerHeight <= 0 || replayWidth <= 0 || replayHeight <= 0) {
          return;
        }
        const scale = Math.min(containerWidth / replayWidth, containerHeight / replayHeight);
        const scaledWidth = replayWidth * scale;
        const scaledHeight = replayHeight * scale;
        const left = (containerWidth - scaledWidth) / 2;
        const top = (containerHeight - scaledHeight) / 2;
        replayer.wrapper.style.left = `${left}px`;
        replayer.wrapper.style.top = `${top}px`;
        replayer.wrapper.style.transform = `scale(${scale})`;
        onFrameRectChange({ left, top, width: scaledWidth, height: scaledHeight });
      };

      updateScale();
      let scaleRaf = 0;
      const observer = new ResizeObserver(() => {
        cancelAnimationFrame(scaleRaf);
        scaleRaf = requestAnimationFrame(updateScale);
      });
      observer.observe(root);
      observer.observe(replayer.wrapper);
      resizeObserverRef.current = observer;

      replayer.play(0);
      replayer.pause(0);
      setStatus("ready");
    }, {
      noErrorLogging: true,
      onError: () => {
        if (!cancelled) {
          setStatus("error");
        }
      },
    });

    return () => {
      cancelled = true;
      onFrameRectChange(null);
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      replayerRef.current?.pause();
      replayerRef.current = null;
      root.replaceChildren();
    };
  }, [adminApp, onFrameRectChange, replayId]);

  return (
    <>
      <div ref={rootRef} className={cn("absolute inset-0 bg-background", status === "ready" ? "opacity-70" : "opacity-0")} />
      {status !== "ready" ? <NormalizedHeatmapFrame selectedReplayId={replayId} /> : null}
      {status === "loading" ? (
        <div className="absolute right-6 top-5 z-20 rounded-xl bg-background/82 px-3 py-2 text-[10px] text-muted-foreground ring-1 ring-foreground/[0.06]">
          Loading replay background
        </div>
      ) : null}
      {status === "error" ? (
        <div className="absolute right-6 top-5 z-20 rounded-xl bg-background/82 px-3 py-2 text-[10px] text-muted-foreground ring-1 ring-foreground/[0.06]">
          Replay background unavailable
        </div>
      ) : null}
    </>
  );
}

function NormalizedHeatmapFrame({ selectedReplayId }: { selectedReplayId: string | null }) {
  return (
    <>
      <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(148,163,184,0.09)_1px,transparent_1px),linear-gradient(to_bottom,rgba(148,163,184,0.09)_1px,transparent_1px)] bg-[size:8.333%_10%]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(6,182,212,0.10),transparent_38%)]" />
      <div className="absolute inset-x-6 top-5 z-10 flex h-8 items-center justify-between gap-3 rounded-xl bg-background/82 px-3 ring-1 ring-foreground/[0.06]">
        <span className="truncate font-mono text-[10px] text-muted-foreground">{selectedReplayId ?? "All selected route clicks"}</span>
        <span className="shrink-0 text-[10px] text-muted-foreground">100% x 100%</span>
      </div>
      <div className="absolute inset-6 top-16 rounded-xl bg-foreground/[0.018] ring-1 ring-foreground/[0.06]">
        {Array.from({ length: 5 }).map((_, index) => (
          <span
            key={index}
            className="absolute inset-y-0 w-px bg-foreground/[0.045]"
            style={{ left: `${(index + 1) * (100 / 6)}%` }}
          />
        ))}
        {Array.from({ length: 4 }).map((_, index) => (
          <span
            key={index}
            className="absolute inset-x-0 h-px bg-foreground/[0.045]"
            style={{ top: `${(index + 1) * 20}%` }}
          />
        ))}
        <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-cyan-500/[0.13]" />
        <div className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-cyan-500/[0.13]" />
      </div>
    </>
  );
}

function EmptyPanel({ label }: { label: string }) {
  return <div className="rounded-lg bg-foreground/[0.03] p-4 text-center text-xs text-muted-foreground">{label}</div>;
}
