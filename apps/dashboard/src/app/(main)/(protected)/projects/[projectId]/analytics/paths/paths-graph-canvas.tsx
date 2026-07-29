"use client";

import type React from "react";
import { DesignButton } from "@/components/design-components";
import { cn } from "@/lib/utils";
import { ArrowsOutIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GraphEdge, GraphNode } from "./force-layout";

const CARD_HEIGHT = 54;
const VIEW_PADDING = 56;

function edgeOpacity(count: number, maxCount: number): number {
  if (maxCount === 0) return 0.08;
  return 0.08 + 0.52 * Math.sqrt(count / maxCount);
}

function edgeWidth(count: number, maxCount: number): number {
  if (maxCount === 0) return 0.5;
  return 0.6 + 2.4 * Math.sqrt(count / maxCount);
}

/**
 * Compute edge path with bundling offset for parallel edges.
 * Uses rectangular node bounds for connection points.
 */
function getEdgePath(from: GraphNode, to: GraphNode, bundleOffset: number) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 1) return null;

  const ndx = dx / dist;
  const ndy = dy / dist;

  // Ray-rectangle intersection for exit/entry points (per-node width)
  const hwFrom = from.width / 2;
  const hwTo = to.width / 2;
  const hh = CARD_HEIGHT / 2;

  const tFromX = ndx !== 0 ? hwFrom / Math.abs(ndx) : Infinity;
  const tFromY = ndy !== 0 ? hh / Math.abs(ndy) : Infinity;
  const tFrom = Math.min(tFromX, tFromY);
  const fromX = from.x + ndx * tFrom;
  const fromY = from.y + ndy * tFrom;

  const tToX = ndx !== 0 ? hwTo / Math.abs(ndx) : Infinity;
  const tToY = ndy !== 0 ? hh / Math.abs(ndy) : Infinity;
  const tTo = Math.min(tToX, tToY);
  const toX = to.x - ndx * tTo;
  const toY = to.y - ndy * tTo;

  // Perpendicular offset for bundling + subtle curve
  const nx = -ndy;
  const ny = ndx;
  const curvature = Math.min(dist * 0.08, 15) + bundleOffset * 8;
  const cx = (fromX + toX) / 2 + nx * curvature;
  const cy = (fromY + toY) / 2 + ny * curvature;

  return { fromX, fromY, toX, toY, cx, cy };
}

export function PathsGraphCanvas({
  nodes,
  edges,
  weakEdges,
  totalNodeCount,
  totalEdgeCount,
  totalTransitionCount,
  visibleTransitionCount,
}: {
  nodes: GraphNode[],
  edges: GraphEdge[],
  weakEdges: GraphEdge[],
  totalNodeCount: number,
  totalEdgeCount: number,
  totalTransitionCount: number,
  visibleTransitionCount: number,
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0, tx: 0, ty: 0 });
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (el == null) return;
    const obs = new ResizeObserver((entries) => {
      const entry = entries[0];
      setContainerSize({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const focusedNode = selectedNode ?? hoveredNode;
  const maxCount = useMemo(() => edges.reduce((m, e) => Math.max(m, e.count), 0), [edges]);

  const nodeStats = useMemo(() => {
    const stats = new Map<string, { inbound: number, outbound: number }>();
    for (const n of nodes) {
      stats.set(n.id, { inbound: 0, outbound: 0 });
    }
    for (const e of [...edges, ...weakEdges]) {
      const from = stats.get(e.from);
      const to = stats.get(e.to);
      if (from != null) from.outbound += e.count;
      if (to != null) to.inbound += e.count;
    }
    return stats;
  }, [edges, nodes, weakEdges]);

  const highlightedEdges = useMemo(() => {
    if (focusedNode == null) return null;
    const set = new Set<string>();
    for (const e of edges) {
      if (e.from === focusedNode || e.to === focusedNode) {
        set.add(`${e.from}\0${e.to}`);
      }
    }
    // Also include contextual edges connected to the focused node.
    for (const e of weakEdges) {
      if (e.from === focusedNode || e.to === focusedNode) {
        set.add(`${e.from}\0${e.to}`);
      }
    }
    return set;
  }, [focusedNode, edges, weakEdges]);

  // Contextual edges stay hidden until hover or persistent selection.
  const visibleWeakEdges = useMemo(() => {
    if (focusedNode == null) return [];
    return weakEdges.filter((e) => e.from === focusedNode || e.to === focusedNode);
  }, [focusedNode, weakEdges]);

  const focusedNodeIds = useMemo(() => {
    if (focusedNode == null) return null;
    const ids = new Set([focusedNode]);
    for (const edge of [...edges, ...weakEdges]) {
      if (edge.from === focusedNode) ids.add(edge.to);
      if (edge.to === focusedNode) ids.add(edge.from);
    }
    return ids;
  }, [edges, focusedNode, weakEdges]);

  const focusedConnections = useMemo(() => {
    if (focusedNode == null) return [];
    return [...edges, ...weakEdges]
      .filter((edge) => edge.from === focusedNode || edge.to === focusedNode)
      .sort((left, right) => right.count - left.count)
      .slice(0, 8);
  }, [edges, focusedNode, weakEdges]);

  // Compute bundle offsets for parallel edges
  const edgeBundleOffsets = useMemo(() => {
    const pairCounts = new Map<string, number>();
    const offsets = new Map<string, number>();
    for (const e of edges) {
      const [a, b] = [e.from, e.to].sort();
      const pairKey = `${a}\0${b}`;
      const count = pairCounts.get(pairKey) ?? 0;
      offsets.set(`${e.from}\0${e.to}`, count);
      pairCounts.set(pairKey, count + 1);
    }
    return offsets;
  }, [edges]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setSelectedNode(null);
    setIsPanning(true);
    panStart.current = { x: e.clientX, y: e.clientY, tx: transform.x, ty: transform.y };
  }, [transform.x, transform.y]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning) return;
    const dx = e.clientX - panStart.current.x;
    const dy = e.clientY - panStart.current.y;
    setTransform((t) => ({
      ...t,
      x: panStart.current.tx + dx,
      y: panStart.current.ty + dy,
    }));
  }, [isPanning]);

  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
  }, []);

  useEffect(() => {
    const handleGlobalUp = () => setIsPanning(false);
    window.addEventListener("mouseup", handleGlobalUp);
    return () => window.removeEventListener("mouseup", handleGlobalUp);
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const scaleFactor = e.deltaY > 0 ? 0.9 : 1.1;
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect == null) return;
    const pointerX = e.clientX - rect.left;
    const pointerY = e.clientY - rect.top;
    setTransform((current) => {
      const scale = Math.max(0.2, Math.min(3, current.scale * scaleFactor));
      const worldX = (pointerX - current.x) / current.scale;
      const worldY = (pointerY - current.y) / current.scale;
      return {
        scale,
        x: pointerX - worldX * scale,
        y: pointerY - worldY * scale,
      };
    });
  }, []);

  const nodeMap = useMemo(() => {
    const map = new Map<string, GraphNode>();
    for (const n of nodes) map.set(n.id, n);
    return map;
  }, [nodes]);

  const graphBounds = useMemo(() => {
    if (nodes.length === 0) return null;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const node of nodes) {
      minX = Math.min(minX, node.x - node.width / 2);
      maxX = Math.max(maxX, node.x + node.width / 2);
      minY = Math.min(minY, node.y - CARD_HEIGHT / 2);
      maxY = Math.max(maxY, node.y + CARD_HEIGHT / 2);
    }
    return { minX, maxX, minY, maxY };
  }, [nodes]);

  const fitView = useCallback(() => {
    if (graphBounds == null || containerSize.w === 0 || containerSize.h === 0) return;
    const graphWidth = Math.max(1, graphBounds.maxX - graphBounds.minX);
    const graphHeight = Math.max(1, graphBounds.maxY - graphBounds.minY);
    const scale = Math.min(
      1,
      Math.max(0.2, (containerSize.w - VIEW_PADDING * 2) / graphWidth),
      Math.max(0.2, (containerSize.h - VIEW_PADDING * 2) / graphHeight),
    );
    const centerX = (graphBounds.minX + graphBounds.maxX) / 2;
    const centerY = (graphBounds.minY + graphBounds.maxY) / 2;
    setTransform({
      scale,
      x: containerSize.w / 2 - centerX * scale,
      y: containerSize.h / 2 - centerY * scale,
    });
  }, [containerSize.h, containerSize.w, graphBounds]);

  useEffect(() => {
    fitView();
  }, [fitView]);

  const coverage = totalTransitionCount === 0
    ? 0
    : visibleTransitionCount / totalTransitionCount;

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full select-none overflow-hidden"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onWheel={handleWheel}
      style={{ cursor: isPanning ? "grabbing" : "grab" }}
    >
      <div className="pointer-events-none absolute left-3 top-3 z-10 flex items-center gap-2 rounded-xl border border-border/50 bg-background/85 px-3 py-2 text-[10px] text-muted-foreground shadow-sm backdrop-blur">
        <span className="font-semibold text-foreground">{nodes.length} of {totalNodeCount} pages</span>
        <span aria-hidden>·</span>
        <span>{Math.round(coverage * 100)}% of transitions</span>
      </div>

      {/* Controls */}
      <div
        className="absolute right-3 top-3 z-10 flex gap-1"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <DesignButton
          onClick={fitView}
          variant="secondary"
          size="sm"
          className="gap-1.5 bg-background/85 backdrop-blur"
          aria-label="Fit navigation graph to view"
        >
          <ArrowsOutIcon className="h-3.5 w-3.5" />
          Fit
        </DesignButton>
      </div>

      {focusedNode != null && (
        <div className="pointer-events-none absolute right-3 top-14 z-10 w-64 rounded-xl border border-border/50 bg-background/90 p-3 shadow-md backdrop-blur">
          <p className="truncate font-mono text-[11px] font-semibold text-foreground">
            {nodeMap.get(focusedNode)?.label ?? focusedNode}
          </p>
          <p className="mt-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">
            Connected routes
          </p>
          <div className="mt-2 space-y-1">
            {focusedConnections.map((edge) => {
              const outgoing = edge.from === focusedNode;
              const connectedNode = nodeMap.get(outgoing ? edge.to : edge.from);
              return (
                <div
                  key={`${edge.from}\0${edge.to}`}
                  className="flex items-center gap-2 rounded-lg bg-foreground/[0.035] px-2 py-1.5 text-[10px]"
                >
                  <span className="w-3 shrink-0 text-center text-muted-foreground" aria-hidden>
                    {outgoing ? "→" : "←"}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-foreground">
                    {connectedNode?.label ?? (outgoing ? edge.to : edge.from)}
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums text-foreground">
                    {edge.count.toLocaleString()}
                  </span>
                </div>
              );
            })}
          </div>
          {selectedNode == null && (
            <p className="mt-2 text-[9px] text-muted-foreground">Select the page to pin these routes.</p>
          )}
        </div>
      )}

      {/* Legend */}
      <div className="pointer-events-none absolute bottom-3 left-3 z-10 max-w-sm rounded-xl border border-border/50 bg-background/85 px-3 py-2 text-[10px] leading-relaxed text-muted-foreground shadow-sm backdrop-blur">
        Showing the highest-traffic {edges.length} of {totalEdgeCount} routes. Select a page to reveal secondary connections.
      </div>

      {/* SVG layer for edges */}
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none"
        style={{ overflow: "visible" }}
      >
        <defs>
          <marker
            id="paths-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="4"
            markerHeight="4"
            orient="auto-start-reverse"
          >
            <path d="M 2 1 L 9 5 L 2 9" fill="none" className="stroke-foreground/50" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </marker>
        </defs>
        <g transform={`translate(${transform.x}, ${transform.y}) scale(${transform.scale})`}>
          {edges.map((edge) => {
            const fromNode = nodeMap.get(edge.from);
            const toNode = nodeMap.get(edge.to);
            if (fromNode == null || toNode == null) return null;

            const bundleOffset = edgeBundleOffsets.get(`${edge.from}\0${edge.to}`) ?? 0;
            const path = getEdgePath(fromNode, toNode, bundleOffset);
            if (path == null) return null;

            const isHighlighted = highlightedEdges == null || highlightedEdges.has(`${edge.from}\0${edge.to}`);
            const opacity = isHighlighted
              ? edgeOpacity(edge.count, maxCount)
              : (focusedNode != null ? 0.015 : edgeOpacity(edge.count, maxCount));

            return (
              <path
                key={`${edge.from}\0${edge.to}`}
                d={`M ${path.fromX} ${path.fromY} Q ${path.cx} ${path.cy} ${path.toX} ${path.toY}`}
                fill="none"
                className="stroke-foreground"
                strokeWidth={edgeWidth(edge.count, maxCount)}
                strokeOpacity={opacity}
                markerEnd="url(#paths-arrow)"
              />
            );
          })}

          {/* Weak edges shown on hover */}
          {visibleWeakEdges.map((edge) => {
            const fromNode = nodeMap.get(edge.from);
            const toNode = nodeMap.get(edge.to);
            if (fromNode == null || toNode == null) return null;

            const path = getEdgePath(fromNode, toNode, 0);
            if (path == null) return null;

            return (
              <path
                key={`weak-${edge.from}\0${edge.to}`}
                d={`M ${path.fromX} ${path.fromY} Q ${path.cx} ${path.cy} ${path.toX} ${path.toY}`}
                fill="none"
                className="stroke-foreground"
                strokeWidth={edgeWidth(edge.count, maxCount)}
                strokeOpacity={edgeOpacity(edge.count, maxCount) * 0.6}
                strokeDasharray="3 3"
                markerEnd="url(#paths-arrow)"
              />
            );
          })}

        </g>
      </svg>

      {/* HTML layer for node cards */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
          transformOrigin: "0 0",
        }}
      >
        {nodes.map((node) => {
          const stats = nodeStats.get(node.id);
          const isHovered = hoveredNode === node.id;
          const isSelected = selectedNode === node.id;
          const isDimmed = focusedNodeIds != null && !focusedNodeIds.has(node.id);
          return (
            <button
              type="button"
              key={node.id}
              aria-pressed={isSelected}
              aria-label={`${node.domain}${node.label}, ${node.pageViews.toLocaleString()} page views`}
              className={cn(
                "absolute rounded-lg border px-2.5 py-1.5 pointer-events-auto cursor-pointer text-left transition-[opacity,box-shadow,border-color] duration-150 hover:transition-none",
                "bg-card text-card-foreground border-border shadow-sm",
                (isHovered || isSelected) && "z-10 border-blue-400/60 shadow-md ring-2 ring-blue-500/50",
                isDimmed && "opacity-25",
              )}
              style={{
                left: node.x - node.width / 2,
                top: node.y - CARD_HEIGHT / 2,
                width: node.width,
                height: CARD_HEIGHT,
              }}
              onMouseDown={(event) => event.stopPropagation()}
              onMouseEnter={() => setHoveredNode(node.id)}
              onMouseLeave={() => setHoveredNode(null)}
              onClick={() => setSelectedNode((current) => current === node.id ? null : node.id)}
            >
              <div className="flex items-center gap-1.5">
                {node.domain !== "" && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500/70" aria-hidden />}
                <div className="min-w-0 flex-1 truncate font-mono text-[11px] font-medium leading-tight" title={`${node.domain}${node.label}`}>
                  {node.label}
                </div>
              </div>
              <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                <span title="Page views">{node.pageViews.toLocaleString()} views</span>
                {(isHovered || isSelected) && (
                  <>
                    <span className="text-muted-foreground/50" aria-hidden>·</span>
                    <span title="Inbound transitions">←{stats?.inbound.toLocaleString() ?? 0}</span>
                    <span title="Outbound transitions">{stats?.outbound.toLocaleString() ?? 0}→</span>
                  </>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
