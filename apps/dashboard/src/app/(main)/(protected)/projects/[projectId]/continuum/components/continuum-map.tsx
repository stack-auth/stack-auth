"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  CaretDownIcon,
  CloudIcon,
  DatabaseIcon,
  HardDrivesIcon,
  RocketLaunchIcon,
  UsersIcon,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CANVAS_BRANCHES,
  MAP_EDGES,
  MAP_NODES,
  NODE_SIZE,
  VIEWBOX,
} from "../fixtures/topology";
import type { ContinuumMapNode } from "../fixtures/types";
import { StatusDot, cellStateToCxStatus, type CxStatus } from "./ui-kit";

type ContinuumMapProps = {
  nodeHealthOverrides?: Map<string, string>,
  edgeHealthOverrides?: Map<string, string>,
  selectedNodeId?: string | null,
  onSelectNode?: (nodeId: string) => void,
  branchId?: string,
  onBranchChange?: (branchId: string) => void,
};

const nodeById = new Map(MAP_NODES.map((node) => [node.id, node]));

function healthToStatus(health: string): CxStatus {
  switch (health) {
    case "critical": {
      return "bad";
    }
    case "degraded": {
      return "warn";
    }
    case "protected": {
      return "info";
    }
    case "pinned": {
      return "pinned";
    }
    case "healthy": {
      return "ok";
    }
    default: {
      return cellStateToCxStatus(health);
    }
  }
}

function edgeStroke(health: string): string {
  switch (health) {
    case "critical": {
      return "#ef4444";
    }
    case "degraded": {
      return "#f59e0b";
    }
    case "active": {
      return "#a78bfa";
    }
    default: {
      return "rgba(255,255,255,0.18)";
    }
  }
}

function kindIcon(kind: ContinuumMapNode["kind"]) {
  switch (kind) {
    case "customer": {
      return UsersIcon;
    }
    case "cell": {
      return HardDrivesIcon;
    }
    case "release": {
      return RocketLaunchIcon;
    }
    case "database": {
      return DatabaseIcon;
    }
    case "provider":
    case "region": {
      return CloudIcon;
    }
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

function kindAccent(kind: ContinuumMapNode["kind"]): string {
  switch (kind) {
    case "customer": {
      return "border-l-[#38bdf8]";
    }
    case "cell": {
      return "border-l-[#34d399]";
    }
    case "release": {
      return "border-l-[#a78bfa]";
    }
    case "database": {
      return "border-l-[#fbbf24]";
    }
    case "provider":
    case "region": {
      return "border-l-[#94a3b8]";
    }
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return reduced;
}

/** Orthogonal-ish bezier between block centers (Railway/n8n feel). */
function edgePath(sx: number, sy: number, tx: number, ty: number): string {
  const dy = Math.abs(ty - sy);
  const midY = (sy + ty) / 2;
  if (dy < 40) {
    const midX = (sx + tx) / 2;
    return `M ${sx} ${sy} C ${midX} ${sy}, ${midX} ${ty}, ${tx} ${ty}`;
  }
  return `M ${sx} ${sy} C ${sx} ${midY}, ${tx} ${midY}, ${tx} ${ty}`;
}

export function ContinuumMap({
  nodeHealthOverrides,
  edgeHealthOverrides,
  selectedNodeId,
  onSelectNode,
  branchId: branchIdProp,
  onBranchChange,
}: ContinuumMapProps) {
  const reducedMotion = usePrefersReducedMotion();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [internalBranchId, setInternalBranchId] = useState<string>(CANVAS_BRANCHES[0].id);
  const branchId = branchIdProp ?? internalBranchId;
  const resolveBranchChange = onBranchChange ?? setInternalBranchId;
  const branch = CANVAS_BRANCHES.find((b) => b.id === branchId) ?? CANVAS_BRANCHES[0];

  const selectedNode = useMemo(
    () => MAP_NODES.find((n) => n.id === selectedNodeId) ?? null,
    [selectedNodeId],
  );

  return (
    <div className="relative flex min-h-[70vh] flex-1 flex-col overflow-hidden rounded-lg border border-black/[0.08] bg-[#0b0b0f] dark:border-white/[0.08]">
      {/* Canvas chrome: breadcrumb + branch switcher */}
      <div className="z-20 flex items-center justify-between gap-3 border-b border-white/[0.06] bg-[#0f0e14]/95 px-3 py-2 backdrop-blur-md">
        <nav className="flex min-w-0 items-center gap-1.5 text-[12px]" aria-label="Canvas breadcrumb">
          <span className="text-[#6b7280]">Continuum</span>
          <span className="text-[#3f3f46]">/</span>
          <span className="text-[#a1a0ab]">Canvas</span>
          <span className="text-[#3f3f46]">/</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[12px] text-[#f7f7f8] transition-colors duration-150 hover:bg-white/[0.06] hover:transition-none"
              >
                {branch.label}
                <CaretDownIcon className="size-3 text-[#6b7280]" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[12rem]">
              {CANVAS_BRANCHES.map((option) => (
                <DropdownMenuItem
                  key={option.id}
                  onClick={() => resolveBranchChange(option.id)}
                  className="font-mono text-xs"
                >
                  {option.label}
                  {option.id === branchId ? " ·" : ""}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          {selectedNode != null && (
            <>
              <span className="text-[#3f3f46]">/</span>
              <span className="truncate text-[#f7f7f8]">{selectedNode.label}</span>
            </>
          )}
        </nav>
        <span className="shrink-0 font-mono text-[10px] tabular-nums text-[#6b7280]">
          {MAP_NODES.length} services · {MAP_EDGES.length} links
        </span>
      </div>

      <div ref={scrollerRef} className="relative min-h-0 flex-1 overflow-auto">
        <div
          className="relative"
          style={{ width: VIEWBOX.width, height: VIEWBOX.height, minWidth: "100%" }}
        >
          {/* Dot grid */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage: "radial-gradient(rgba(255,255,255,0.07) 1px, transparent 1px)",
              backgroundSize: "20px 20px",
            }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "radial-gradient(ellipse 55% 40% at 50% 35%, rgba(85,63,131,0.22), transparent 70%)",
            }}
          />

          {/* Edges */}
          <svg
            className="pointer-events-none absolute inset-0"
            width={VIEWBOX.width}
            height={VIEWBOX.height}
            viewBox={`0 0 ${VIEWBOX.width} ${VIEWBOX.height}`}
          >
            {MAP_EDGES.map((edge, index) => {
              const source = nodeById.get(edge.source);
              const target = nodeById.get(edge.target);
              if (source == null || target == null) {
                throw new Error(`Edge "${edge.id}" references unknown node.`);
              }
              const health = edgeHealthOverrides?.get(edge.id) ?? edge.health;
              const active = health === "active" || health === "critical" || health === "degraded";
              // Connect bottom of source to top of target
              const sx = source.x;
              const sy = source.y + NODE_SIZE.height / 2 - 4;
              const tx = target.x;
              const ty = target.y - NODE_SIZE.height / 2 + 4;
              const d = edgePath(sx, sy, tx, ty);
              return (
                <g key={edge.id}>
                  <path
                    d={d}
                    fill="none"
                    stroke={edgeStroke(health)}
                    strokeWidth={active ? 2 : 1.25}
                    strokeLinecap="round"
                    style={
                      reducedMotion || edge.kind === "traffic"
                        ? undefined
                        : { animation: `cx-flow 1.4s linear ${index * -0.1}s infinite`, strokeDasharray: "5 7" }
                    }
                    strokeDasharray={edge.kind === "failover" ? "4 6" : undefined}
                  />
                  {/* Port dots */}
                  <circle cx={sx} cy={sy} r="3" fill="#1c1a28" stroke="rgba(255,255,255,0.25)" strokeWidth="1" />
                  <circle cx={tx} cy={ty} r="3" fill="#1c1a28" stroke="rgba(255,255,255,0.25)" strokeWidth="1" />
                  {edge.label != null && (
                    <text
                      x={(sx + tx) / 2}
                      y={(sy + ty) / 2 - 6}
                      textAnchor="middle"
                      fill="#6b7280"
                      fontSize="9"
                      fontFamily="ui-monospace, monospace"
                    >
                      {edge.label}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>

          {/* HTML service blocks */}
          {MAP_NODES.map((node) => {
            const health = nodeHealthOverrides?.get(node.id) ?? node.health;
            const status = healthToStatus(health);
            const selected = selectedNodeId === node.id;
            const Icon = kindIcon(node.kind);
            const left = node.x - NODE_SIZE.width / 2;
            const top = node.y - NODE_SIZE.height / 2;

            return (
              <button
                key={node.id}
                type="button"
                onClick={() => onSelectNode?.(node.id)}
                aria-pressed={selected}
                className={[
                  "absolute flex flex-col justify-between rounded-lg border border-l-[3px] px-3 py-2.5 text-left shadow-[0_12px_40px_rgba(0,0,0,0.45)] outline-none transition-[border-color,box-shadow,transform] duration-150 hover:transition-none",
                  kindAccent(node.kind),
                  selected
                    ? "z-10 border-white/25 bg-[#252233] ring-2 ring-[#7c6cff]/50"
                    : "border-white/[0.08] bg-[#1c1a28] hover:border-white/20 hover:bg-[#221f30]",
                  "focus-visible:ring-2 focus-visible:ring-[#7c6cff]/60",
                ].join(" ")}
                style={{
                  left,
                  top,
                  width: NODE_SIZE.width,
                  height: NODE_SIZE.height,
                }}
              >
                <div className="flex items-center gap-2">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-white/[0.04] text-[#a1a0ab]">
                    <Icon className="size-3.5" weight="duotone" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[12px] font-medium tracking-tight text-[#f7f7f8]">
                    {node.label}
                  </span>
                  <StatusDot status={status} />
                </div>
                <div className="flex items-center justify-between gap-2 pl-8">
                  <span className="text-[9px] uppercase tracking-[0.14em] text-[#6b7280]">
                    {node.kind === "provider" ? "cloud" : node.kind}
                  </span>
                  {node.subtitle != null && (
                    <span className="truncate font-mono text-[10px] tabular-nums text-[#a1a0ab]">
                      {node.subtitle}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <style>{`
        @keyframes cx-flow {
          to { stroke-dashoffset: -24; }
        }
      `}</style>
    </div>
  );
}
