"use client";

import type React from "react";
import { cn } from "@/lib/utils";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GraphEdge, GraphNode } from "./force-layout";

const CARD_WIDTH = 140;
const CARD_HEIGHT = 52;

function edgeOpacity(count: number, maxCount: number): number {
  if (maxCount === 0) return 0.1;
  return 0.1 + 0.7 * (count / maxCount);
}

function edgeWidth(count: number, maxCount: number): number {
  if (maxCount === 0) return 1;
  // Logarithmic thickness normalized by log of max edge
  const logMax = Math.log2(maxCount + 1);
  if (logMax === 0) return 1;
  return 1 + 4 * (Math.log2(count + 1) / logMax);
}

export function FunnelGraphCanvas({
  nodes,
  edges,
}: {
  nodes: GraphNode[],
  edges: GraphEdge[],
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0, tx: 0, ty: 0 });
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });

  // Track container size
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

  const maxCount = useMemo(() => edges.reduce((m, e) => Math.max(m, e.count), 0), [edges]);

  // Compute per-node stats: total inbound, total outbound
  const nodeStats = useMemo(() => {
    const stats = new Map<string, { inbound: number, outbound: number }>();
    for (const n of nodes) {
      stats.set(n.id, { inbound: 0, outbound: 0 });
    }
    for (const e of edges) {
      const from = stats.get(e.from);
      const to = stats.get(e.to);
      if (from != null) from.outbound += e.count;
      if (to != null) to.inbound += e.count;
    }
    return stats;
  }, [nodes, edges]);

  // Highlighted edges when hovering a node
  const highlightedEdges = useMemo(() => {
    if (hoveredNode == null) return null;
    const set = new Set<string>();
    for (const e of edges) {
      if (e.from === hoveredNode || e.to === hoveredNode) {
        set.add(`${e.from}\0${e.to}`);
      }
    }
    return set;
  }, [hoveredNode, edges]);

  // Pan handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
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

  // Zoom with scroll
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const scaleFactor = e.deltaY > 0 ? 0.9 : 1.1;
    setTransform((t) => ({
      ...t,
      scale: Math.max(0.1, Math.min(5, t.scale * scaleFactor)),
    }));
  }, []);

  // Reset view
  const resetView = useCallback(() => {
    setTransform({ x: 0, y: 0, scale: 1 });
  }, []);

  const nodeMap = useMemo(() => {
    const map = new Map<string, GraphNode>();
    for (const n of nodes) map.set(n.id, n);
    return map;
  }, [nodes]);

  // Center offset: shift graph so center of all nodes is at center of container
  const graphCenter = useMemo(() => {
    if (nodes.length === 0) return { x: 0, y: 0 };
    let cx = 0, cy = 0;
    for (const n of nodes) {
      cx += n.x;
      cy += n.y;
    }
    return { x: cx / nodes.length, y: cy / nodes.length };
  }, [nodes]);

  // The offset to translate node coordinates to screen coordinates (centered in container)
  const offsetX = containerSize.w / 2 - graphCenter.x;
  const offsetY = containerSize.h / 2 - graphCenter.y;

  // Compute edge connection points (from card border to card border)
  const getEdgePath = useCallback((from: GraphNode, to: GraphNode) => {
    const hw = CARD_WIDTH / 2;
    const hh = CARD_HEIGHT / 2;

    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1) return null;

    // Ray-rectangle intersection for exit/entry points
    const ndx = dx / dist;
    const ndy = dy / dist;

    // From-node exit point
    const tFromX = ndx !== 0 ? hw / Math.abs(ndx) : Infinity;
    const tFromY = ndy !== 0 ? hh / Math.abs(ndy) : Infinity;
    const tFrom = Math.min(tFromX, tFromY);
    const fromX = from.x + ndx * tFrom;
    const fromY = from.y + ndy * tFrom;

    // To-node entry point
    const toX = to.x - ndx * tFrom;
    const toY = to.y - ndy * tFrom;

    // Subtle curve perpendicular to the edge
    const nx = -ndy;
    const ny = ndx;
    const curvature = Math.min(dist * 0.08, 15);
    const cx = (fromX + toX) / 2 + nx * curvature;
    const cy = (fromY + toY) / 2 + ny * curvature;

    return { fromX, fromY, toX, toY, cx, cy };
  }, []);

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
      {/* Controls */}
      <div className="absolute top-3 right-3 z-10 flex gap-1">
        <button
          onClick={resetView}
          className="px-2 py-1 rounded-md text-xs bg-background/80 backdrop-blur border border-border/50 hover:bg-muted/50 transition-colors hover:transition-none"
        >
          Reset view
        </button>
      </div>

      {/* Legend */}
      <div className="absolute bottom-3 left-3 z-10 px-3 py-2 rounded-lg bg-background/80 backdrop-blur border border-border/50 text-xs text-muted-foreground space-y-1">
        <div>Edge thickness = log(transitions)</div>
        <div>Scroll to zoom, drag to pan</div>
      </div>

      {/* SVG layer for edges — fills container, uses same coordinate transform */}
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none"
        style={{ overflow: "visible" }}
      >
        <defs>
          <marker
            id="funnel-arrow"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" className="fill-foreground/40" />
          </marker>
        </defs>
        <g transform={`translate(${offsetX + transform.x}, ${offsetY + transform.y}) scale(${transform.scale})`}>
          {edges.map((edge) => {
            const fromNode = nodeMap.get(edge.from);
            const toNode = nodeMap.get(edge.to);
            if (fromNode == null || toNode == null) return null;

            const path = getEdgePath(fromNode, toNode);
            if (path == null) return null;

            const isHighlighted = highlightedEdges == null || highlightedEdges.has(`${edge.from}\0${edge.to}`);
            const opacity = isHighlighted
              ? edgeOpacity(edge.count, maxCount)
              : (hoveredNode != null ? 0.03 : edgeOpacity(edge.count, maxCount));

            return (
              <path
                key={`${edge.from}\0${edge.to}`}
                d={`M ${path.fromX} ${path.fromY} Q ${path.cx} ${path.cy} ${path.toX} ${path.toY}`}
                fill="none"
                className="stroke-foreground"
                strokeWidth={edgeWidth(edge.count, maxCount)}
                strokeOpacity={opacity}
                markerEnd="url(#funnel-arrow)"
              />
            );
          })}

          {/* Edge labels on hover */}
          {hoveredNode != null && edges
            .filter((e) => e.from === hoveredNode || e.to === hoveredNode)
            .map((edge) => {
              const fromNode = nodeMap.get(edge.from);
              const toNode = nodeMap.get(edge.to);
              if (fromNode == null || toNode == null) return null;
              const mx = (fromNode.x + toNode.x) / 2;
              const my = (fromNode.y + toNode.y) / 2;
              return (
                <text
                  key={`label-${edge.from}\0${edge.to}`}
                  x={mx}
                  y={my - 8}
                  textAnchor="middle"
                  className="fill-foreground"
                  fontSize={11}
                  fontWeight="bold"
                >
                  {edge.count.toLocaleString()}
                </text>
              );
            })
          }
        </g>
      </svg>

      {/* HTML layer for node cards */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
          transformOrigin: `${containerSize.w / 2}px ${containerSize.h / 2}px`,
        }}
      >
        {nodes.map((node) => {
          const stats = nodeStats.get(node.id);
          const isHovered = hoveredNode === node.id;
          const isDimmed = hoveredNode != null && !isHovered &&
            !highlightedEdges?.has(`${hoveredNode}\0${node.id}`) &&
            !highlightedEdges?.has(`${node.id}\0${hoveredNode}`);

          return (
            <div
              key={node.id}
              className={cn(
                "absolute rounded-lg border px-2.5 py-1.5 pointer-events-auto cursor-pointer transition-shadow hover:transition-none",
                "bg-card text-card-foreground border-border shadow-sm",
                isHovered && "ring-2 ring-blue-500/50 shadow-md border-blue-400/60",
                isDimmed && "opacity-20",
              )}
              style={{
                left: offsetX + node.x - CARD_WIDTH / 2,
                top: offsetY + node.y - CARD_HEIGHT / 2,
                width: CARD_WIDTH,
                height: CARD_HEIGHT,
              }}
              onMouseEnter={() => setHoveredNode(node.id)}
              onMouseLeave={() => setHoveredNode(null)}
            >
              <div className="text-[11px] font-mono font-medium truncate leading-tight" title={node.label}>
                {node.label}
              </div>
              <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground">
                <span title="Inbound transitions">→ {stats?.inbound.toLocaleString() ?? 0}</span>
                <span title="Outbound transitions">{stats?.outbound.toLocaleString() ?? 0} →</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
