// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PathsGraphCanvas } from "./paths-graph-canvas";

const nodes = [
  { id: "/projects/:id/releases", label: "/projects/:id/releases", domain: "example.com", pageViews: 12, width: 180, x: 0, y: 0 },
  { id: "/checkout", label: "/checkout", domain: "example.com", pageViews: 5, width: 120, x: 300, y: 0 },
];
const edges = [{ from: "/projects/:id/releases", to: "/checkout", count: 5, weight: 5 }];

beforeEach(() => {
  class TestPointerEvent extends MouseEvent {
    readonly pointerId: number;

    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
    }
  }
  vi.stubGlobal("PointerEvent", TestPointerEvent);
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    disconnect() {}
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderCanvas(initialCompareMode = false) {
  return render(
    <PathsGraphCanvas
      nodes={nodes}
      edges={edges}
      weakEdges={[]}
      totalNodeCount={2}
      totalEdgeCount={1}
      totalTransitionCount={5}
      visibleTransitionCount={5}
      initialCompareMode={initialCompareMode}
      comparePaths={async (paths) => paths.map((path) => ({ path, uniqueVisitors: 1 }))}
    />,
  );
}

describe("PathsGraphCanvas", () => {
  it("shows the full domain and normalized path in a selectable wrapped inspector", () => {
    renderCanvas();
    fireEvent.mouseEnter(screen.getByRole("button", { name: "example.com/projects/:id/releases, 12 page views" }));

    const fullPath = screen.getByText("example.com/projects/:id/releases");
    expect(fullPath.className).toContain("select-text");
    expect(fullPath.className).toContain("break-all");
    expect(fullPath.className).not.toContain("truncate");
  });

  it("moves a node with pointer capture and updates its incident path", () => {
    const { container } = renderCanvas();
    const node = screen.getByRole("button", { name: "example.com/projects/:id/releases, 12 page views" });
    node.setPointerCapture = vi.fn();
    node.releasePointerCapture = vi.fn();
    const pathBefore = container.querySelector('path[marker-end="url(#paths-arrow)"]')?.getAttribute("d");

    fireEvent.pointerDown(node, { button: 0, pointerId: 7, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(node, { pointerId: 7, clientX: 120, clientY: 110 });
    fireEvent.pointerUp(node, { pointerId: 7, clientX: 120, clientY: 110 });

    expect(node.style.left).toBe("-70px");
    expect(container.querySelector('path[marker-end="url(#paths-arrow)"]')?.getAttribute("d")).not.toBe(pathBefore);
    expect(screen.getByRole("button", { name: "Reset" })).toBeTruthy();
  });

  it("starts in compare mode and fills ordered editable inputs from node activation", () => {
    renderCanvas(true);
    const node = screen.getByRole("button", { name: "example.com/projects/:id/releases, 12 page views" });
    node.setPointerCapture = vi.fn();
    node.releasePointerCapture = vi.fn();

    fireEvent.pointerDown(node, { button: 0, pointerId: 3, clientX: 20, clientY: 20 });
    fireEvent.pointerUp(node, { pointerId: 3, clientX: 20, clientY: 20 });

    expect(screen.getByRole("button", { name: "Compare paths" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByLabelText("Exact path 1").getAttribute("value")).toBe("/projects/:id/releases");
  });

  it("activates focused nodes from the keyboard", () => {
    renderCanvas();
    const node = screen.getByRole("button", { name: "example.com/projects/:id/releases, 12 page views" });

    fireEvent.keyDown(node, { key: "Enter" });

    expect(node.getAttribute("aria-pressed")).toBe("true");
  });
});
