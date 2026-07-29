// @vitest-environment jsdom

import type React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import PageClient from "./page-client";

const { queryAnalyticsMock } = vi.hoisted(() => ({
  queryAnalyticsMock: vi.fn(),
}));

vi.mock("../../use-admin-app", () => ({
  useAdminApp: () => ({
    queryAnalytics: queryAnalyticsMock,
  }),
}));

vi.mock("../../app-enabled-guard", () => ({
  AppEnabledGuard: ({ appId, children }: { appId: string, children: React.ReactNode }) => (
    <div data-testid="app-guard" data-app-id={appId}>{children}</div>
  ),
}));

vi.mock("../../page-layout", () => ({
  PageLayout: ({
    title,
    description,
    children,
  }: {
    title: string,
    description: string,
    children: React.ReactNode,
  }) => (
    <main>
      <h1>{title}</h1>
      <p>{description}</p>
      {children}
    </main>
  ),
}));

vi.mock("./paths-graph-canvas", () => ({
  PathsGraphCanvas: ({
    nodes,
    edges,
  }: {
    nodes: { id: string }[],
    edges: { count: number }[],
  }) => (
    <div data-testid="paths-graph">
      {nodes.length} nodes / {edges.reduce((total, edge) => total + edge.count, 0)} transitions
    </div>
  ),
}));

describe("Paths page client", () => {
  afterEach(() => {
    cleanup();
    queryAnalyticsMock.mockReset();
  });

  it("loads and aggregates navigation paths for Analytics-enabled projects", async () => {
    queryAnalyticsMock
      .mockResolvedValueOnce({
        result: [
          { from_path: "/products/123", to_path: "/checkout", cnt: "12" },
          { from_path: "/products/456", to_path: "/checkout", cnt: "8" },
        ],
      })
      .mockResolvedValueOnce({
        result: [
          { path: "/products/123", page_domain: "example.com", views: "30" },
          { path: "/products/456", page_domain: "example.com", views: "20" },
          { path: "/checkout", page_domain: "example.com", views: "10" },
        ],
      });

    render(<PageClient />);

    expect(screen.getByTestId("app-guard").getAttribute("data-app-id")).toBe("analytics");
    expect(screen.getByRole("heading", { name: "Paths" })).toBeTruthy();
    expect(screen.getByText("Explore the routes users take between product events.")).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByTestId("paths-graph").textContent).toBe("2 nodes / 20 transitions");
    });
    expect(queryAnalyticsMock).toHaveBeenCalledTimes(2);
  });
});
