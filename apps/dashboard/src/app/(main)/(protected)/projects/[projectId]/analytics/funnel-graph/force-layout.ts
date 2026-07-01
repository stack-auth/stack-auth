/**
 * Force-directed graph layout using a simple velocity-Verlet simulation.
 *
 * Forces:
 * - Repulsion between all node pairs (Coulomb-like)
 * - Attraction along edges proportional to edge weight (spring)
 * - Centering force to keep the graph from drifting
 */

export type GraphNode = {
  id: string,
  label: string,
  x: number,
  y: number,
};

export type GraphEdge = {
  from: string,
  to: string,
  count: number,
  /** Logarithmic weight: Math.log2(count + 1) */
  weight: number,
};

type SimNode = {
  id: string,
  label: string,
  x: number,
  y: number,
  vx: number,
  vy: number,
};

const REPULSION_STRENGTH = 50000;
const ATTRACTION_STRENGTH = 0.002;
const CENTERING_STRENGTH = 0.005;
const DAMPING = 0.85;
const ITERATIONS = 500;
const MIN_DISTANCE = 80;
const MAX_NODES = 200;

export function computeForceLayout(nodes: GraphNode[], edges: GraphEdge[]): GraphNode[] {
  if (nodes.length === 0) return [];
  if (nodes.length > MAX_NODES) {
    throw new Error(`Too many nodes for force layout (${nodes.length} > ${MAX_NODES}). Consider filtering the data.`);
  }

  // Initialize positions in a circle with generous spacing
  const simNodes: SimNode[] = nodes.map((node, i) => {
    const angle = (2 * Math.PI * i) / nodes.length;
    const radius = Math.max(300, nodes.length * 40);
    return {
      id: node.id,
      label: node.label,
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      vx: 0,
      vy: 0,
    };
  });

  const nodeIndex = new Map<string, number>();
  for (let i = 0; i < simNodes.length; i++) {
    nodeIndex.set(simNodes[i]!.id, i);
  }

  // Precompute max weight for normalization
  const maxWeight = edges.reduce((max, e) => Math.max(max, e.weight), 1);

  for (let iter = 0; iter < ITERATIONS; iter++) {
    // Adaptive cooling: reduce force influence as iterations progress
    const alpha = 1 - iter / ITERATIONS;
    const coolFactor = alpha * alpha;

    // Repulsion between all pairs (Barnes-Hut would be better for huge
    // graphs, but for ≤500 edges / ~100 nodes this is fine)
    for (let i = 0; i < simNodes.length; i++) {
      for (let j = i + 1; j < simNodes.length; j++) {
        const a = simNodes[i]!;
        const b = simNodes[j]!;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < MIN_DISTANCE) dist = MIN_DISTANCE;

        const force = (REPULSION_STRENGTH * coolFactor) / (dist * dist);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;

        a.vx -= fx;
        a.vy -= fy;
        b.vx += fx;
        b.vy += fy;
      }
    }

    // Attraction along edges (stronger edges pull more)
    for (const edge of edges) {
      const ai = nodeIndex.get(edge.from);
      const bi = nodeIndex.get(edge.to);
      if (ai == null || bi == null) continue;

      const a = simNodes[ai]!;
      const b = simNodes[bi]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 1) continue;

      // Normalized weight so the strongest edges pull the most
      const normalizedWeight = edge.weight / maxWeight;
      // Use spring-like attraction: pull toward ideal distance rather than
      // linearly scaling with current distance
      const idealDist = 150 * (1 - normalizedWeight * 0.7);
      const displacement = dist - idealDist;
      const force = ATTRACTION_STRENGTH * displacement * normalizedWeight * coolFactor;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;

      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }

    // Centering force
    for (const node of simNodes) {
      node.vx -= node.x * CENTERING_STRENGTH * coolFactor;
      node.vy -= node.y * CENTERING_STRENGTH * coolFactor;
    }

    // Apply velocity with damping
    for (const node of simNodes) {
      node.vx *= DAMPING;
      node.vy *= DAMPING;
      node.x += node.vx;
      node.y += node.vy;
    }
  }

  return simNodes.map((n) => ({
    id: n.id,
    label: n.label,
    x: n.x,
    y: n.y,
  }));
}
