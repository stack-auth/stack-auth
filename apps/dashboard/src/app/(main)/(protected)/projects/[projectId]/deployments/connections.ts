// Environment-variable references and the connection lines they imply.
//
// A reference is written `{serviceName.outputKey}` inside an env var value,
// exactly like Railway's `${{ service.VAR }}`. Data flows from the referenced
// service (the source of the output) into the service that owns the env var
// (the target), so a connection line is drawn source → target.

import { NODE_HEIGHT, NODE_WIDTH, type BoardService } from "./board-model";

// Matches a whole-value or inline reference token. Service and output names use
// the same character class as our service names / output keys.
const REFERENCE_REGEX = /\{([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_]+)\}/g;

export type ParsedReference = {
  serviceName: string,
  outputKey: string,
  raw: string,
};

export function parseReferences(value: string): ParsedReference[] {
  const results: ParsedReference[] = [];
  for (const match of value.matchAll(REFERENCE_REGEX)) {
    results.push({ serviceName: match[1], outputKey: match[2], raw: match[0] });
  }
  return results;
}

export function isPureReference(value: string): boolean {
  const refs = parseReferences(value);
  return refs.length === 1 && refs[0].raw === value.trim();
}

export type Connection = {
  id: string,
  fromId: string,
  toId: string,
  // Number of distinct env vars on the target that reference the source; drives
  // the little count pill on the connection line.
  count: number,
};

// Derive the set of connections from every env var reference on the board.
// Deduplicated per (source, target) pair; self-references are ignored.
export function deriveConnections(services: BoardService[]): Connection[] {
  const byName = new Map(services.map((s) => [s.name, s]));
  const counts = new Map<string, Connection>();

  for (const target of services) {
    for (const envVar of target.envVars) {
      for (const ref of parseReferences(envVar.value)) {
        const source = byName.get(ref.serviceName);
        if (!source || source.id === target.id) continue;
        const id = `${source.id}->${target.id}`;
        const existing = counts.get(id);
        if (existing) {
          existing.count += 1;
        } else {
          counts.set(id, { id, fromId: source.id, toId: target.id, count: 1 });
        }
      }
    }
  }

  return [...counts.values()];
}

export type Point = { x: number, y: number };

export type EdgeAnchors = {
  start: Point,
  end: Point,
  // True when the target sits to the left of the source, so the edge leaves the
  // source from its left side and enters the target on its right.
  reversed: boolean,
};

// Anchor points on the node edges. Nodes have a fixed footprint (NODE_WIDTH x
// NODE_HEIGHT), so anchors are pure geometry — no DOM measurement needed, which
// keeps drag updates cheap and jitter-free.
export function getEdgeAnchors(from: BoardService, to: BoardService): EdgeAnchors {
  const fromCenterX = from.x + NODE_WIDTH / 2;
  const toCenterX = to.x + NODE_WIDTH / 2;
  const reversed = toCenterX < fromCenterX;
  const midY = NODE_HEIGHT / 2;
  const start: Point = { x: reversed ? from.x : from.x + NODE_WIDTH, y: from.y + midY };
  const end: Point = { x: reversed ? to.x + NODE_WIDTH : to.x, y: to.y + midY };
  return { start, end, reversed };
}

export type ConnectorStyle = "curved" | "orthogonal" | "straight";

// Build the SVG path `d` for an edge given the visual variant's connector style.
export function buildEdgePath(anchors: EdgeAnchors, style: ConnectorStyle): string {
  const { start, end, reversed } = anchors;
  switch (style) {
    case "straight": {
      return `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
    }
    case "orthogonal": {
      // Stepped H → V → H routing with the vertical leg at the midpoint.
      const midX = (start.x + end.x) / 2;
      return `M ${start.x} ${start.y} L ${midX} ${start.y} L ${midX} ${end.y} L ${end.x} ${end.y}`;
    }
    case "curved":
    default: {
      // Horizontal-tangent cubic bezier, like Railway's service graph. The
      // control-point reach grows with horizontal distance and is nudged out
      // when the edge doubles back on itself.
      const dx = Math.abs(end.x - start.x);
      const reach = Math.max(48, dx * 0.5);
      const dir = reversed ? -1 : 1;
      const c1: Point = { x: start.x + reach * dir, y: start.y };
      const c2: Point = { x: end.x - reach * dir, y: end.y };
      return `M ${start.x} ${start.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${end.x} ${end.y}`;
    }
  }
}
