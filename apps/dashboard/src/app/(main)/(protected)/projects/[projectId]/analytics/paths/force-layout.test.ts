import { describe, expect, it } from "vitest";
import { computeLayout, type GraphEdge, type GraphNode } from "./force-layout";

const nodes: GraphNode[] = [
  { id: "/", label: "/", domain: "example.com", pageViews: 100, width: 100, x: 0, y: 0 },
  { id: "/products", label: "/products", domain: "example.com", pageViews: 80, width: 120, x: 0, y: 0 },
  { id: "/checkout", label: "/checkout", domain: "example.com", pageViews: 40, width: 120, x: 0, y: 0 },
];
const edges: GraphEdge[] = [
  { from: "/", to: "/products", count: 70, weight: 70 },
  { from: "/products", to: "/checkout", count: 30, weight: 30 },
];

describe("paths force layout", () => {
  it("returns the same positions for the same navigation graph", () => {
    expect(computeLayout(nodes, edges)).toEqual(computeLayout(nodes, edges));
  });
});
