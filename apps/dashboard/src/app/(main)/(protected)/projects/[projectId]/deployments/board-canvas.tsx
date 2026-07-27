"use client";

import { DesignButton, DesignInput } from "@/components/design-components";
import { Popover, PopoverContent, PopoverTrigger, Spinner, cn } from "@/components/ui";
import { getPublicEnvVar } from "@/lib/env";
import type { AdminDeploymentServiceJson, PushedConfigSource } from "@hexclave/next";
import { runAsynchronously, runAsynchronouslyWithAlert } from "@hexclave/shared/dist/utils/promises";
import { GitBranchIcon, LockSimpleIcon, MinusIcon, PlusIcon, TriangleIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAdminApp } from "../use-admin-app";
import {
  NODE_HEIGHT,
  NODE_WIDTH,
  buildBoardServices,
  getServiceTypeMeta,
  type BoardService,
} from "./board-model";
import { buildEdgePath, deriveConnections, getEdgeAnchors } from "./connections";
import { ServiceDetailPane } from "./service-detail-pane";
import { ServiceNode } from "./service-node";
import { BLUEPRINT_VARIANT, getAccentClasses } from "./variants";

// Below this pointer travel a press counts as a click (select / deselect),
// not a drag or pan.
const DRAG_THRESHOLD = 4;

const MIN_ZOOM = 0.3;
const MAX_ZOOM = 2.5;

// The board data is cheap to fetch, so a simple always-on poll keeps deploy
// statuses fresh without a websocket.
const REFRESH_INTERVAL_MS = 15_000;

function clampZoom(z: number): number {
  return Math.min(Math.max(z, MIN_ZOOM), MAX_ZOOM);
}

// Viewport transform: world→screen is `screen = world * zoom + {x, y}`.
type View = { x: number, y: number, zoom: number };

type Interaction =
  | { mode: "node", id: string, startClientX: number, startClientY: number, startWorldX: number, startWorldY: number, moved: boolean }
  | { mode: "pan", startClientX: number, startClientY: number, startViewX: number, startViewY: number, moved: boolean };

export function BoardCanvas() {
  const variant = BLUEPRINT_VARIANT;
  const adminApp = useAdminApp();
  const project = adminApp.useProject();

  const [apiServices, setApiServices] = useState<AdminDeploymentServiceJson[] | null>(null);
  const [configSource, setConfigSource] = useState<PushedConfigSource | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [services, source] = await Promise.all([
        project.listDeploymentServices(),
        project.getPushedConfigSource(),
      ]);
      setApiServices(services);
      setConfigSource(source);
      setLoadError(null);
    } catch (error) {
      // Keep whatever data we have; the board shows the error banner.
      setLoadError(error instanceof Error ? error.message : String(error));
    }
  }, [project]);

  useEffect(() => {
    runAsynchronously(refresh());
    const interval = setInterval(() => runAsynchronously(refresh()), REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  // Config definitions are read-only in the dashboard when the config is
  // pushed from a config file or GitHub (deploy-time env vars still work).
  const readOnly = configSource != null && configSource.type !== "unlinked";
  const readOnlySourceLabel = configSource?.type === "pushed-from-github" ? "GitHub" : "a config file";

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [newServiceName, setNewServiceName] = useState("");
  const [view, setView] = useState<View>({ x: 0, y: 0, zoom: 1 });
  // In-session drag positions, keyed by service id, on top of the
  // deterministic layout. Not persisted — a refresh resets the layout.
  const [positionOverrides, setPositionOverrides] = useState<Map<string, { x: number, y: number }>>(new Map());

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const interactionRef = useRef<Interaction | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;

  const hexclaveApiHost = useMemo(() => {
    const apiUrl = getPublicEnvVar("NEXT_PUBLIC_STACK_API_URL");
    if (apiUrl == null || apiUrl === "") return "api.hexclave.com";
    try {
      return new URL(apiUrl).host;
    } catch {
      return "api.hexclave.com";
    }
  }, []);

  const services = useMemo(() => {
    if (apiServices == null) return null;
    return buildBoardServices(apiServices, hexclaveApiHost).map((service) => {
      const override = positionOverrides.get(service.id);
      return override != null ? { ...service, x: override.x, y: override.y } : service;
    });
  }, [apiServices, hexclaveApiHost, positionOverrides]);

  const selected = services?.find((s) => s.id === selectedId) ?? null;
  const connections = useMemo(() => deriveConnections(services ?? []), [services]);

  const linkedIds = useMemo(() => {
    if (!selectedId) return new Set<string>();
    const ids = new Set<string>();
    for (const c of connections) {
      if (c.fromId === selectedId) ids.add(c.toId);
      if (c.toId === selectedId) ids.add(c.fromId);
    }
    return ids;
  }, [connections, selectedId]);

  // Center the board once the viewport has a size and the services are known.
  const centeredRef = useRef(false);
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp || services == null || centeredRef.current) return;
    const center = () => {
      if (centeredRef.current) return;
      const width = vp.clientWidth;
      const height = vp.clientHeight;
      if (width === 0 || height === 0 || services.length === 0) return;
      centeredRef.current = true;
      const xs = services.map((s) => s.x + NODE_WIDTH / 2);
      const ys = services.map((s) => s.y + NODE_HEIGHT / 2);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      setView({ x: width / 2 - cx, y: height / 2 - cy, zoom: 1 });
      observer.disconnect();
    };
    const observer = new ResizeObserver(center);
    observer.observe(vp);
    center();
    return () => observer.disconnect();
  }, [services]);

  const zoomTowards = useCallback((factor: number, cx: number, cy: number) => {
    setView((v) => {
      const nz = clampZoom(v.zoom * factor);
      const worldX = (cx - v.x) / v.zoom;
      const worldY = (cy - v.y) / v.zoom;
      return { x: cx - worldX * nz, y: cy - worldY * nz, zoom: nz };
    });
  }, []);

  const zoomByButton = useCallback((factor: number) => {
    const vp = viewportRef.current;
    if (!vp) return;
    const rect = vp.getBoundingClientRect();
    zoomTowards(factor, rect.width / 2, rect.height / 2);
  }, [zoomTowards]);

  // Native, non-passive wheel handler: cmd/ctrl + wheel zooms towards the
  // cursor, plain wheel pans. preventDefault stops the page from scrolling.
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const onWheel = (e: WheelEvent) => {
      // Let the detail pane / controls scroll normally; only the empty canvas
      // pans and zooms.
      const target = e.target as HTMLElement | null;
      if (target?.closest("[data-board-chrome]")) return;
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const rect = vp.getBoundingClientRect();
        const factor = Math.exp(-e.deltaY * 0.002);
        zoomTowards(factor, e.clientX - rect.left, e.clientY - rect.top);
      } else {
        setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
      }
    };
    vp.addEventListener("wheel", onWheel, { passive: false });
    return () => vp.removeEventListener("wheel", onWheel);
  }, [zoomTowards]);

  const handleNodePointerDown = useCallback((e: React.PointerEvent, serviceId: string) => {
    if (e.button !== 0) return;
    // Keep the viewport pan handler from also firing.
    e.stopPropagation();
    const service = services?.find((s) => s.id === serviceId);
    if (!service) return;
    interactionRef.current = {
      mode: "node",
      id: serviceId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startWorldX: service.x,
      startWorldY: service.y,
      moved: false,
    };
  }, [services]);

  const handleViewportPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    interactionRef.current = {
      mode: "pan",
      startClientX: e.clientX,
      startClientY: e.clientY,
      startViewX: viewRef.current.x,
      startViewY: viewRef.current.y,
      moved: false,
    };
  }, []);

  // Window-level move/up so drags and pans keep tracking outside the element.
  useEffect(() => {
    const handleMove = (e: PointerEvent) => {
      const it = interactionRef.current;
      if (!it) return;
      const dist = Math.hypot(e.clientX - it.startClientX, e.clientY - it.startClientY);
      if (!it.moved && dist < DRAG_THRESHOLD) return;
      if (it.mode === "node") {
        if (!it.moved) {
          it.moved = true;
          setDraggingId(it.id);
        }
        const zoom = viewRef.current.zoom;
        const x = it.startWorldX + (e.clientX - it.startClientX) / zoom;
        const y = it.startWorldY + (e.clientY - it.startClientY) / zoom;
        setPositionOverrides((prev) => new Map(prev).set(it.id, { x, y }));
      } else {
        it.moved = true;
        setView((v) => ({ ...v, x: it.startViewX + (e.clientX - it.startClientX), y: it.startViewY + (e.clientY - it.startClientY) }));
      }
    };
    const handleUp = () => {
      const it = interactionRef.current;
      if (it && !it.moved) {
        // A click without meaningful movement: select a node, or deselect on
        // empty canvas.
        setSelectedId(it.mode === "node" ? it.id : null);
      }
      interactionRef.current = null;
      setDraggingId(null);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const handleAddService = useCallback(async () => {
    const name = newServiceName.trim().toLowerCase();
    if (name === "") return;
    await project.createDeploymentService(name, {});
    setAddOpen(false);
    setNewServiceName("");
    await refresh();
    setSelectedId(name);
  }, [newServiceName, project, refresh]);

  return (
    <div className="relative flex min-h-0 flex-1 overflow-hidden rounded-2xl ring-1 ring-black/[0.06] dark:ring-white/[0.06]">
      {/* Infinite pan/zoom viewport. The blueprint grid is a CSS background so it
          tiles infinitely as the user pans, and scales with zoom. */}
      <div
        ref={viewportRef}
        onPointerDown={handleViewportPointerDown}
        className={cn(
          "absolute inset-0 touch-none select-none overflow-hidden",
          "bg-[#f7f8fa] dark:bg-[#0b1220]",
          "[--grid-minor:rgba(37,99,235,0.10)] [--grid-major:rgba(37,99,235,0.20)] dark:[--grid-minor:rgba(103,232,249,0.07)] dark:[--grid-major:rgba(103,232,249,0.13)]",
          draggingId ? "cursor-grabbing" : "cursor-grab",
        )}
        style={{
          backgroundImage:
            "linear-gradient(to right, var(--grid-minor) 1px, transparent 1px)," +
            "linear-gradient(to bottom, var(--grid-minor) 1px, transparent 1px)," +
            "linear-gradient(to right, var(--grid-major) 1px, transparent 1px)," +
            "linear-gradient(to bottom, var(--grid-major) 1px, transparent 1px)",
          backgroundSize:
            `${24 * view.zoom}px ${24 * view.zoom}px, ${24 * view.zoom}px ${24 * view.zoom}px, ` +
            `${120 * view.zoom}px ${120 * view.zoom}px, ${120 * view.zoom}px ${120 * view.zoom}px`,
          backgroundPosition: `${view.x}px ${view.y}px`,
        }}
      >
        {services == null ? (
          <div className="flex h-full items-center justify-center">
            <Spinner />
          </div>
        ) : (
          // Transformed world layer.
          <div className="absolute left-0 top-0" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`, transformOrigin: "0 0" }}>
            <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width={1} height={1}>
              {connections.map((connection) => {
                const from = services.find((s) => s.id === connection.fromId);
                const to = services.find((s) => s.id === connection.toId);
                if (!from || !to) return null;
                const anchors = getEdgeAnchors(from, to);
                const path = buildEdgePath(anchors, variant.connectorStyle);
                const accent = getAccentClasses(getServiceTypeMeta(from.type).accent);
                const active = selectedId === from.id || selectedId === to.id;
                const dimmed = selectedId != null && !active;
                return (
                  <g key={connection.id} className={cn(accent.stroke, "transition-opacity duration-150")} opacity={dimmed ? 0.25 : 1}>
                    <path d={path} fill="none" stroke="currentColor" strokeWidth={active ? 2.5 : 1.75} strokeDasharray={variant.connectorDashed ? "5 5" : undefined} strokeLinecap="round" />
                    <circle cx={anchors.end.x} cy={anchors.end.y} r={active ? 4 : 3} fill="currentColor" />
                  </g>
                );
              })}
            </svg>

            {services.map((service) => (
              <ServiceNode
                key={service.id}
                service={service}
                variant={variant}
                selected={selectedId === service.id}
                dragging={draggingId === service.id}
                linked={linkedIds.has(service.id)}
                onPointerDown={handleNodePointerDown}
              />
            ))}
          </div>
        )}
      </div>

      {/* Read-only / error banners — top-left. */}
      <div data-board-chrome onPointerDown={(e) => e.stopPropagation()} className="absolute left-3 top-3 z-20 flex max-w-[60%] flex-col gap-2">
        {readOnly && (
          <div className="flex items-center gap-2 rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-amber-700 ring-1 ring-amber-500/30 backdrop-blur-md dark:text-amber-300">
            {configSource.type === "pushed-from-github" ? <GitBranchIcon className="h-4 w-4 shrink-0" /> : <LockSimpleIcon className="h-4 w-4 shrink-0" />}
            <span>
              This project&apos;s config is managed by {readOnlySourceLabel}. Edit your repo&apos;s <span className="font-mono">hexclave.config.ts</span> to change services.
            </span>
          </div>
        )}
        {loadError != null && (
          <div className="flex items-center gap-2 rounded-xl bg-red-500/10 px-3 py-2 text-xs text-red-700 ring-1 ring-red-500/30 backdrop-blur-md dark:text-red-300">
            <WarningCircleIcon className="h-4 w-4 shrink-0" />
            <span className="min-w-0 break-words">Failed to load deployments: {loadError}</span>
          </div>
        )}
      </div>

      {/* Zoom controls — bottom-left. */}
      <div data-board-chrome onPointerDown={(e) => e.stopPropagation()} className="absolute bottom-3 left-3 z-20 flex items-center overflow-hidden rounded-xl bg-white/80 shadow-sm ring-1 ring-black/[0.08] backdrop-blur-md dark:bg-background/70 dark:ring-white/[0.08]">
        <button onClick={() => zoomByButton(1 / 1.2)} aria-label="Zoom out" className="flex h-8 w-8 items-center justify-center text-muted-foreground transition-colors duration-150 hover:bg-foreground/[0.06] hover:text-foreground hover:transition-none">
          <MinusIcon className="h-4 w-4" />
        </button>
        <span className="w-12 select-none text-center text-[11px] tabular-nums text-muted-foreground">{Math.round(view.zoom * 100)}%</span>
        <button onClick={() => zoomByButton(1.2)} aria-label="Zoom in" className="flex h-8 w-8 items-center justify-center text-muted-foreground transition-colors duration-150 hover:bg-foreground/[0.06] hover:text-foreground hover:transition-none">
          <PlusIcon className="h-4 w-4" />
        </button>
      </div>

      {/* Add service — top-right. Disabled when the config is pushed from a
          config file or GitHub (definitions are read-only then). */}
      <div data-board-chrome onPointerDown={(e) => e.stopPropagation()} className="absolute right-3 top-3 z-20">
        <Popover
          open={addOpen}
          onOpenChange={(open) => {
            setAddOpen(open);
            if (!open) setNewServiceName("");
          }}
        >
          <PopoverTrigger asChild>
            <DesignButton size="sm" variant="outline" disabled={readOnly || services == null}>
              <PlusIcon className="mr-2 h-4 w-4" />
              Add Service
            </DesignButton>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-64 p-3">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
              <TriangleIcon className="h-4 w-4 text-cyan-500" weight="fill" />
              New Vercel service
            </div>
            <DesignInput
              autoFocus
              value={newServiceName}
              size="sm"
              placeholder="e.g. web, api, docs"
              className="font-mono"
              onChange={(e) => setNewServiceName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") runAsynchronouslyWithAlert(handleAddService());
              }}
            />
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Lowercase letters, digits, hyphens, and underscores. This is the name you&apos;ll pass to <span className="font-mono">hexclave deploy</span>.
            </p>
            <DesignButton
              size="sm"
              className="mt-2 w-full"
              disabled={newServiceName.trim() === ""}
              onClick={handleAddService}
            >
              Create service
            </DesignButton>
          </PopoverContent>
        </Popover>
      </div>

      {/* Detail pane — slides over the right edge. */}
      <div
        data-board-chrome
        onPointerDown={(e) => e.stopPropagation()}
        className={cn(
          "absolute inset-y-0 right-0 z-30 w-[560px] max-w-[94vw] border-l border-border/60 bg-background/95 shadow-[-8px_0_32px_rgba(0,0,0,0.08)] backdrop-blur-xl transition-transform duration-200 ease-out",
          selected ? "translate-x-0" : "pointer-events-none translate-x-full",
        )}
      >
        {selected && services != null && (
          <ServiceDetailPane
            service={selected}
            services={services}
            project={project}
            readOnly={readOnly}
            onClose={() => setSelectedId(null)}
            onDeleted={() => {
              setSelectedId(null);
              runAsynchronously(refresh());
            }}
            refresh={refresh}
          />
        )}
      </div>
    </div>
  );
}
