"use client";

import { cn } from "@/lib/utils";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GraphEdge, GraphNode } from "./force-layout";

type ViewBox = {
  x: number,
  y: number,
  width: number,
  height: number,
};

const NODE_RADIUS = 6;
const LABEL_FONT_SIZE = 11;
const PADDING = 80;

function computeViewBox(nodes: GraphNode[]): ViewBox {
  if (nodes.length === 0) return { x: -500, y: -500, width: 1000, height: 1000 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    if (n.x < minX) minX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.x > maxX) maxX = n.x;
    if (n.y > maxY) maxY = n.y;
  }
  return {
    x: minX - PADDING,
    y: minY - PADDING,
    width: (maxX - minX) + PADDING * 2,
    height: (maxY - minY) + PADDING * 2,
  };
}

function edgeOpacity(weight: number, maxWeight: number): number {
  if (maxWeight === 0) return 0.2;
  // Map weight to 0.1..0.9
  return 0.1 + 0.8 * (weight / maxWeight);
}

function edgeWidth(weight: number, maxWeight: number): number {
  if (maxWeight === 0) return 1;
  // Map weight to 1..6
  return 1 + 5 * (weight / maxWeight);
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

  const viewBox = useMemo(() => computeViewBox(nodes), [nodes]);
  const maxWeight = useMemo(() => edges.reduce((m, e) => Math.max(m, e.weight), 0), [edges]);

  // Node degree for sizing
  const nodeDegree = useMemo(() => {
    const degree = new Map<string, number>();
    for (const e of edges) {
      degree.set(e.from, (degree.get(e.from) ?? 0) + e.count);
      degree.set(e.to, (degree.get(e.to) ?? 0) + e.count);
    }
    return degree;
  }, [edges]);

  const maxDegree = useMemo(() => {
    let max = 0;
    for (const d of nodeDegree.values()) {
      if (d > max) max = d;
    }
    return max;
  }, [nodeDegree]);

  const nodeRadius = useCallback((id: string) => {
    const deg = nodeDegree.get(id) ?? 0;
    if (maxDegree === 0) return NODE_RADIUS;
    return NODE_RADIUS + 8 * (deg / maxDegree);
  }, [nodeDegree, maxDegree]);

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
    setTransform((t) => ({ ...t, x: panStart.current.tx + dx, y: panStart.current.ty + dy }));
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

  // Compute arrow marker offset for each edge to stop at node boundary
  const arrowId = "funnel-arrow";

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
        <div>Node size = total traffic</div>
        <div>Edge thickness = log(transitions)</div>
        <div>Scroll to zoom, drag to pan</div>
      </div>

      <svg
        className="w-full h-full"
        viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <marker
            id={arrowId}
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

        <g transform={`translate(${transform.x}, ${transform.y}) scale(${transform.scale})`}>
          {/* Edges */}
          {edges.map((edge) => {
            const fromNode = nodeMap.get(edge.from);
            const toNode = nodeMap.get(edge.to);
            if (fromNode == null || toNode == null) return null;

            const isHighlighted = highlightedEdges == null || highlightedEdges.has(`${edge.from}\0${edge.to}`);
            const opacity = isHighlighted
              ? edgeOpacity(edge.weight, maxWeight)
              : (hoveredNode != null ? 0.05 : edgeOpacity(edge.weight, maxWeight));

            // Shorten line to stop at node radius
            const dx = toNode.x - fromNode.x;
            const dy = toNode.y - fromNode.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < 1) return null;

            const fromR = nodeRadius(edge.from);
            const toR = nodeRadius(edge.to);
            const startX = fromNode.x + (dx / dist) * fromR;
            const startY = fromNode.y + (dy / dist) * fromR;
            const endX = toNode.x - (dx / dist) * (toR + 4);
            const endY = toNode.y - (dy / dist) * (toR + 4);

            return (
              <line
                key={`${edge.from}\0${edge.to}`}
                x1={startX}
                y1={startY}
                x2={endX}
                y2={endY}
                className="stroke-foreground"
                strokeWidth={edgeWidth(edge.weight, maxWeight)}
                strokeOpacity={opacity}
                markerEnd={`url(#${arrowId})`}
              />
            );
          })}

          {/* Nodes */}
          {nodes.map((node) => {
            const r = nodeRadius(node.id);
            const isHovered = hoveredNode === node.id;
            const isDimmed = hoveredNode != null && !isHovered &&
              !highlightedEdges?.has(`${hoveredNode}\0${node.id}`) &&
              !highlightedEdges?.has(`${node.id}\0${hoveredNode}`);

            return (
              <g
                key={node.id}
                onMouseEnter={() => setHoveredNode(node.id)}
                onMouseLeave={() => setHoveredNode(null)}
                className="cursor-pointer"
                opacity={isDimmed ? 0.2 : 1}
              >
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={r}
                  className={cn(
                    "fill-blue-500 stroke-blue-600",
                    isHovered && "fill-blue-400 stroke-blue-500"
                  )}
                  strokeWidth={isHovered ? 2 : 1}
                />
                <text
                  x={node.x}
                  y={node.y + r + LABEL_FONT_SIZE + 2}
                  textAnchor="middle"
                  className="fill-foreground"
                  fontSize={LABEL_FONT_SIZE}
                  fontFamily="monospace"
                >
                  {node.label}
                </text>
                {/* Invisible larger hit area for easier hovering */}
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={r + 8}
                  fill="transparent"
                />
              </g>
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
                  y={my - 6}
                  textAnchor="middle"
                  className="fill-foreground"
                  fontSize={10}
                  fontWeight="bold"
                >
                  {edge.count.toLocaleString()}
                </text>
              );
            })
          }
        </g>
      </svg>
    </div>
  );
}
