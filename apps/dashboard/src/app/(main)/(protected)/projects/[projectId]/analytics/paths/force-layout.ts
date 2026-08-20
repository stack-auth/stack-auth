
export type GraphNode = {
  id: string,
  label: string,
  domain: string,
  pageViews: number,
  width: number,
  x: number,
  y: number,
};

export type GraphEdge = {
  from: string,
  to: string,
  count: number,
  weight: number,
};

const CARD_HEIGHT = 60;
const ITERATIONS = 500;
const GRAVITY = 0.005;
const REPULSION_SCALE = 8000;
const X_CONSTRAINT_STRENGTH = 0.25;
const DAMPING = 0.85;
const MIN_DIST = 50;

function stableUnitValue(value: string, salt: number): number {
  let hash = 2166136261 ^ salt;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function findLandingPages(nodes: GraphNode[], edges: GraphEdge[]): Set<string> {
  const inbound = new Map<string, number>();
  const outbound = new Map<string, number>();
  for (const n of nodes) {
    inbound.set(n.id, 0);
    outbound.set(n.id, 0);
  }
  for (const e of edges) {
    outbound.set(e.from, (outbound.get(e.from) ?? 0) + e.count);
    inbound.set(e.to, (inbound.get(e.to) ?? 0) + e.count);
  }

  const rootPatterns = ["/", "/index", "/home", "/landing"];
  const landings = new Set<string>();

  for (const n of nodes) {
    const out = outbound.get(n.id) ?? 0;
    const inn = inbound.get(n.id) ?? 0;
    if (rootPatterns.some((p) => n.id === p || (n.id.endsWith("/") && n.id.slice(0, -1) === p))) {
      landings.add(n.id);
      continue;
    }
    if (out > inn * 1.3 && out > 30) {
      landings.add(n.id);
    }
  }

  if (landings.size === 0) {
    const sorted = [...nodes].sort((a, b) => (outbound.get(b.id) ?? 0) - (outbound.get(a.id) ?? 0));
    for (const node of sorted.slice(0, 3)) {
      landings.add(node.id);
    }
  }

  return landings;
}

function computeDistanceFromLandings(
  nodes: GraphNode[],
  edges: GraphEdge[],
  landings: Set<string>,
): Map<string, number> {
  const adj = new Map<string, { to: string }[]>();
  for (const n of nodes) {
    adj.set(n.id, []);
  }
  for (const e of edges) {
    adj.get(e.from)?.push({ to: e.to });
  }

  const distances = new Map<string, number[]>();
  for (const n of nodes) {
    distances.set(n.id, []);
  }

  for (const landing of landings) {
    const dist = new Map<string, number>();
    const queue: string[] = [landing];
    dist.set(landing, 0);

    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined) break;
      const currentDist = dist.get(current);
      if (currentDist === undefined) continue;
      const neighbors = adj.get(current) ?? [];
      for (const { to } of neighbors) {
        if (!dist.has(to)) {
          dist.set(to, currentDist + 1);
          queue.push(to);
        }
      }
    }

    for (const [nodeId, d] of dist) {
      distances.get(nodeId)?.push(d);
    }
  }

  const avgDist = new Map<string, number>();
  let maxDist = 0;
  for (const [nodeId, dists] of distances) {
    if (dists.length === 0) continue;
    const avg = dists.reduce((a, b) => a + b, 0) / dists.length;
    avgDist.set(nodeId, avg);
    maxDist = Math.max(maxDist, avg);
  }
  for (const n of nodes) {
    if (!avgDist.has(n.id)) avgDist.set(n.id, maxDist + 1);
  }

  return avgDist;
}

type SimNode = {
  id: string,
  label: string,
  width: number,
  x: number,
  y: number,
  vx: number,
  vy: number,
  targetX: number,
};

export function computeLayout(nodes: GraphNode[], edges: GraphEdge[]): GraphNode[] {
  if (nodes.length === 0) return [];

  const landings = findLandingPages(nodes, edges);
  const distFromLanding = computeDistanceFromLandings(nodes, edges, landings);

  const maxDist = Math.max(...distFromLanding.values(), 1);
  const xSpread = Math.max(720, Math.min(2200, (maxDist + 1) * 320));

  const simNodes: SimNode[] = nodes.map((n, i) => {
    const dist = distFromLanding.get(n.id) ?? 0;
    const targetX = (dist / maxDist) * xSpread;
    const ySpread = Math.max(560, Math.sqrt(nodes.length) * 220);
    return {
      id: n.id,
      label: n.label,
      width: n.width,
      x: targetX + (stableUnitValue(n.id, 17) - 0.5) * 80,
      y: (i / nodes.length - 0.5) * ySpread + (stableUnitValue(n.id, 29) - 0.5) * 50,
      vx: 0,
      vy: 0,
      targetX,
    };
  });

  const nodeIndex = new Map<string, number>();
  for (const [i, node] of simNodes.entries()) {
    nodeIndex.set(node.id, i);
  }

  const maxWeight = edges.reduce((m, e) => Math.max(m, e.weight), 1);

  const collisionPadX = 30;
  const collisionPadY = 25;
  const collisionH = CARD_HEIGHT / 2 + collisionPadY;

  for (let iter = 0; iter < ITERATIONS; iter++) {
    const alpha = 1 - iter / ITERATIONS;
    const cool = 0.1 + 0.9 * alpha;

    for (let i = 0; i < simNodes.length; i++) {
      for (let j = i + 1; j < simNodes.length; j++) {
        const a = simNodes[i];
        const b = simNodes[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        let dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < MIN_DIST) dist = MIN_DIST;

        const repForce = REPULSION_SCALE * cool / (dist * dist);
        const fx = (dx / dist) * repForce;
        const fy = (dy / dist) * repForce;

        a.vx -= fx;
        a.vy -= fy;
        b.vx += fx;
        b.vy += fy;

        const collisionW = (a.width + b.width) / 2 + collisionPadX;
        const overlapX = collisionW - Math.abs(dx);
        const overlapY = collisionH * 2 - Math.abs(dy);
        if (overlapX > 0 && overlapY > 0) {
          const pushX = (overlapX / 2) * Math.sign(dx || 1) * 0.8;
          const pushY = (overlapY / 2) * Math.sign(dy || 1) * 0.8;
          a.x -= pushX;
          b.x += pushX;
          a.y -= pushY;
          b.y += pushY;
        }
      }
    }

    for (const edge of edges) {
      const ai = nodeIndex.get(edge.from);
      const bi = nodeIndex.get(edge.to);
      if (ai == null || bi == null) continue;

      const a = simNodes[ai];
      const b = simNodes[bi];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 1) continue;

      const strength = 0.008 * (edge.weight / maxWeight) * cool;
      const fy = dy * strength;
      const fx = dx < 0 ? -(dx * strength) : dx * strength;

      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }

    for (const edge of edges) {
      const ai = nodeIndex.get(edge.from);
      const bi = nodeIndex.get(edge.to);
      if (ai == null || bi == null) continue;

      const a = simNodes[ai];
      const b = simNodes[bi];
      const dy = b.y - a.y;

      const relWeight = edge.weight / maxWeight;
      const alignStrength = 0.012 * relWeight * relWeight * cool;
      const fy = dy * alignStrength;

      a.vy += fy;
      b.vy -= fy;
    }

    for (const node of simNodes) {
      const xDiff = node.targetX - node.x;
      node.vx += xDiff * X_CONSTRAINT_STRENGTH * cool;
    }

    for (const node of simNodes) {
      node.vy -= node.y * GRAVITY * cool;
    }

    for (const node of simNodes) {
      node.vx *= DAMPING;
      node.vy *= DAMPING;
      node.x += node.vx;
      node.y += node.vy;
    }
  }

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  return simNodes.flatMap((n) => {
    const original = nodeById.get(n.id);
    if (original === undefined) return [];
    return [{ ...original, x: n.x, y: n.y }];
  });
}
