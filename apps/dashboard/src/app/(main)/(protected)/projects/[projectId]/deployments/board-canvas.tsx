"use client";

import { DesignButton } from "@/components/design-components";
import { Popover, PopoverContent, PopoverTrigger, cn } from "@/components/ui";
import { MinusIcon, PlusIcon, TriangleIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildEdgePath, deriveConnections, getEdgeAnchors } from "./connections";
import {
  NODE_HEIGHT,
  NODE_WIDTH,
  defaultBuildConfig,
  getInitialServices,
  getServiceTypeMeta,
  type BuildConfig,
  type EnvVar,
  type Service,
  type ServiceType,
} from "./mock-data";
import { ServiceDetailPane } from "./service-detail-pane";
import { ServiceNode } from "./service-node";
import { BLUEPRINT_VARIANT, getAccentClasses } from "./variants";

// Below this pointer travel a press counts as a click (select / deselect),
// not a drag or pan.
const DRAG_THRESHOLD = 4;

const MIN_ZOOM = 0.3;
const MAX_ZOOM = 2.5;

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
  const [services, setServices] = useState<Service[]>(getInitialServices);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  // The just-created service whose name input should grab focus.
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [view, setView] = useState<View>({ x: 0, y: 0, zoom: 1 });

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const interactionRef = useRef<Interaction | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const idCounter = useRef(0);
  const nextId = (prefix: string) => `${prefix}_${idCounter.current++}`;

  const selected = services.find((s) => s.id === selectedId) ?? null;
  const connections = useMemo(() => deriveConnections(services), [services]);

  const linkedIds = useMemo(() => {
    if (!selectedId) return new Set<string>();
    const ids = new Set<string>();
    for (const c of connections) {
      if (c.fromId === selectedId) ids.add(c.toId);
      if (c.toId === selectedId) ids.add(c.fromId);
    }
    return ids;
  }, [connections, selectedId]);

  // Center the initial services once the viewport actually has a size (its
  // layout isn't settled on the first mount tick, which would otherwise center
  // on the world origin). Because view state is not persisted, a page refresh
  // re-runs this and resets the user to center.
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    let done = false;
    const center = () => {
      if (done) return;
      const width = vp.clientWidth;
      const height = vp.clientHeight;
      if (width === 0 || height === 0) return;
      done = true;
      const initial = getInitialServices();
      const xs = initial.map((s) => s.x + NODE_WIDTH / 2);
      const ys = initial.map((s) => s.y + NODE_HEIGHT / 2);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      setView({ x: width / 2 - cx, y: height / 2 - cy, zoom: 1 });
      observer.disconnect();
    };
    const observer = new ResizeObserver(center);
    observer.observe(vp);
    center();
    return () => observer.disconnect();
  }, []);

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
    const service = services.find((s) => s.id === serviceId);
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
        setServices((prev) => prev.map((s) => (s.id === it.id ? { ...s, x, y } : s)));
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

  const handleAddService = useCallback((type: ServiceType) => {
    const id = nextId("svc");
    setServices((prev) => {
      const sameType = prev.filter((s) => s.type === type).length;
      // Drop new nodes near the current center of the viewport, in world space.
      const vp = viewportRef.current;
      const v = viewRef.current;
      const worldCenterX = vp ? (vp.clientWidth / 2 - v.x) / v.zoom - NODE_WIDTH / 2 : 400;
      const worldCenterY = vp ? (vp.clientHeight / 2 - v.y) / v.zoom - NODE_HEIGHT / 2 : 200;
      const created: Service = {
        id,
        name: `${getServiceTypeMeta(type).label.toLowerCase()}-${sameType + 1}`,
        type,
        x: worldCenterX + (prev.length % 3) * 24,
        y: worldCenterY + (prev.length % 3) * 24,
        status: "building",
        region: "us-east",
        source: "github.com/acme/new-app",
        envVars: [],
        domains: [],
        buildConfig: defaultBuildConfig(type),
      };
      return [...prev, created];
    });
    setSelectedId(id);
    setPendingFocusId(id);
  }, []);

  const handleRename = useCallback((id: string, name: string) => {
    setServices((prev) => prev.map((s) => (s.id === id ? { ...s, name } : s)));
  }, []);

  const handleAddEnvVar = useCallback((id: string) => {
    const envId = nextId("env");
    setServices((prev) => prev.map((s) => (s.id === id ? { ...s, envVars: [...s.envVars, { id: envId, key: "", value: "" }] } : s)));
  }, []);

  const handleUpdateEnvVar = useCallback((id: string, envId: string, patch: Partial<Pick<EnvVar, "key" | "value">>) => {
    setServices((prev) => prev.map((s) =>
      s.id === id ? { ...s, envVars: s.envVars.map((e) => (e.id === envId ? { ...e, ...patch } : e)) } : s,
    ));
  }, []);

  const handleRemoveEnvVar = useCallback((id: string, envId: string) => {
    setServices((prev) => prev.map((s) => (s.id === id ? { ...s, envVars: s.envVars.filter((e) => e.id !== envId) } : s)));
  }, []);

  const handleDeleteService = useCallback((id: string) => {
    setServices((prev) => {
      const target = prev.find((s) => s.id === id);
      if (!target || target.type === "hexclave") return prev;
      return prev.filter((s) => s.id !== id);
    });
    setSelectedId((cur) => (cur === id ? null : cur));
  }, []);

  const handleAddDomain = useCallback((id: string, hostname: string) => {
    const domainId = nextId("dom");
    setServices((prev) => prev.map((s) =>
      s.id === id ? { ...s, domains: [...s.domains, { id: domainId, hostname, primary: false, verified: false }] } : s,
    ));
  }, []);

  const handleRemoveDomain = useCallback((id: string, domainId: string) => {
    setServices((prev) => prev.map((s) => (s.id === id ? { ...s, domains: s.domains.filter((d) => d.id !== domainId) } : s)));
  }, []);

  const handleUpdateBuildConfig = useCallback((id: string, patch: Partial<BuildConfig>) => {
    setServices((prev) => prev.map((s) => (s.id === id ? { ...s, buildConfig: { ...s.buildConfig, ...patch } } : s)));
  }, []);

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
        {/* Transformed world layer. */}
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

      {/* Add service — top-right. Only Vercel services can be added. */}
      <div data-board-chrome onPointerDown={(e) => e.stopPropagation()} className="absolute right-3 top-3 z-20">
        <Popover open={addOpen} onOpenChange={setAddOpen}>
          <PopoverTrigger asChild>
            <DesignButton size="sm" variant="outline">
              <PlusIcon className="mr-2 h-4 w-4" />
              Add Service
            </DesignButton>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-44 p-1">
            <button
              onClick={() => {
                setAddOpen(false);
                handleAddService("vercel");
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-foreground transition-colors duration-150 hover:bg-foreground/[0.06] hover:transition-none"
            >
              <TriangleIcon className="h-4 w-4 text-cyan-500" weight="fill" />
              Vercel
            </button>
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
        {selected && (
          <ServiceDetailPane
            service={selected}
            services={services}
            shouldFocusName={selected.id === pendingFocusId}
            onNameFocused={() => setPendingFocusId(null)}
            onClose={() => setSelectedId(null)}
            onRename={handleRename}
            onAddEnvVar={handleAddEnvVar}
            onUpdateEnvVar={handleUpdateEnvVar}
            onRemoveEnvVar={handleRemoveEnvVar}
            onDeleteService={handleDeleteService}
            onAddDomain={handleAddDomain}
            onRemoveDomain={handleRemoveDomain}
            onUpdateBuildConfig={handleUpdateBuildConfig}
          />
        )}
      </div>
    </div>
  );
}
