import { afterEach, describe, expect, it, vi } from "vitest";
import { replenishPool, resetPoolForTests, tenantProjectForNamespace, waitForScheduledReplenishmentForTests } from "./project-pool.js";
import type { TenantProject, TenantProjectManager } from "./gcp/projects.js";
import type { PoolProjectEntry } from "./types.js";

// The store is faked at the module boundary, exactly like reconciliation-lock.test.ts: the
// bucket CAS semantics (If-None-Match create, If-Match replace) are what the pool's
// arbitration relies on, so the fake reproduces them rather than mocking outcomes.
let pool: Map<string, PoolProjectEntry>;
let assignments: Map<string, string>;
let projectPoolSize: number;
let provisioned: string[];
let deleted: string[];
let activeManager: TenantProjectManager;

function fakeManager(): TenantProjectManager {
  const describe = (projectId: string): TenantProject => ({ projectId, projectNumber: "123456789" });
  return {
    describeActiveProject: vi.fn(async (projectId: string) => describe(projectId)),
    provisionPooledProject: vi.fn(async (projectId: string) => {
      provisioned.push(projectId);
      return describe(projectId);
    }),
    ensureForNamespace: vi.fn(async (ns: string) => {
      const projectId = `hxc-tena-dev-${ns.replace(/[^a-z0-9]/g, "").slice(0, 16)}`;
      provisioned.push(projectId);
      return describe(projectId);
    }),
    deleteDisposableProject: vi.fn(async (projectId: string) => {
      deleted.push(projectId);
      provisioned = provisioned.filter((id) => id !== projectId);
    }),
  } as unknown as TenantProjectManager;
}

vi.mock("./gcp/manager.js", () => ({
  // Replenishment builds its own manager; hand it the fake seeded for the current test.
  createTenantProjectManager: vi.fn(() => activeManager),
}));

vi.mock("./store.js", () => ({
  readTenantProjectAssignment: vi.fn(async (ns: string) => assignments.get(ns) ?? null),
  assignTenantProject: vi.fn(async (ns: string, projectId: string) => {
    if (!assignments.has(ns)) assignments.set(ns, projectId);
    return assignments.get(ns)!;
  }),
  listPoolProjects: vi.fn(async () => [...pool].map(([projectId, entry]) => ({ projectId, entry }))),
  registerPoolProject: vi.fn(async (projectId: string) => {
    if (pool.has(projectId)) return false;
    pool.set(projectId, { state: "ready" });
    return true;
  }),
  claimPoolProject: vi.fn(async (projectId: string, ns: string) => {
    const entry = pool.get(projectId);
    if (entry?.state !== "ready") return false;
    pool.set(projectId, { state: "claimed", ns });
    return true;
  }),
  unclaimPoolProject: vi.fn(async (projectId: string, ns: string) => {
    const entry = pool.get(projectId);
    if (entry?.state !== "claimed" || entry.ns !== ns) return false;
    pool.set(projectId, { state: "ready" });
    return true;
  }),
}));

vi.mock("./config.js", () => ({
  getConfig: vi.fn(() => ({ envId: "dev", gcp: { projectPoolSize, projectPrefix: "hxc-tena" } })),
}));

afterEach(() => {
  resetPoolForTests();
  vi.restoreAllMocks();
});

function seed(initials: { pool?: [string, PoolProjectEntry][], assignments?: [string, string][], size?: number }): void {
  pool = new Map(initials.pool ?? []);
  assignments = new Map(initials.assignments ?? []);
  projectPoolSize = initials.size ?? 0;
  provisioned = [];
  deleted = [];
  activeManager = fakeManager();
}

describe("tenant project pool", () => {
  it("reuses an existing assignment without touching the pool", async () => {
    seed({ assignments: [["ns-1", "hxc-tena-assigned"]], pool: [["hxc-tena-ready", { state: "ready" }]] });
    const manager = fakeManager();

    const project = await tenantProjectForNamespace("ns-1", manager);

    expect(project.projectId).toBe("hxc-tena-assigned");
    expect(vi.mocked(manager.describeActiveProject)).toHaveBeenCalledOnce();
    expect(pool.get("hxc-tena-ready")).toEqual({ state: "ready" });
  });

  it("claims a ready pooled project, assigns it, and schedules replenishment", async () => {
    seed({ pool: [["hxc-tena-ready", { state: "ready" }]], size: 1 });
    const manager = fakeManager();

    const project = await tenantProjectForNamespace("ns-1", manager);
    await waitForScheduledReplenishmentForTests();

    expect(project.projectId).toBe("hxc-tena-ready");
    expect(pool.get("hxc-tena-ready")).toEqual({ state: "claimed", ns: "ns-1" });
    expect(assignments.get("ns-1")).toBe("hxc-tena-ready");
    // The claim consumed the only ready project; the scheduled top-up provisioned a new one.
    expect([...pool.values()].filter((entry) => entry.state === "ready").length).toBe(1);
    expect(provisioned.length).toBe(1);
  });

  it("falls back to lazy deterministic provisioning when the pool is empty, and still records the assignment", async () => {
    seed({ pool: [], size: 0 });
    const manager = fakeManager();

    const project = await tenantProjectForNamespace("ns-1", manager);

    expect(project.projectId).toBe("hxc-tena-dev-ns1");
    expect(vi.mocked(manager.ensureForNamespace)).toHaveBeenCalledWith("ns-1");
    expect(assignments.get("ns-1")).toBe("hxc-tena-dev-ns1");
  });

  it("puts a claim back when it lost the assignment race for its own namespace", async () => {
    seed({ pool: [["hxc-tena-ready", { state: "ready" }], ["hxc-tena-winner", { state: "ready" }]] });
    const manager = fakeManager();
    // A concurrent request for the same namespace claimed the other project and won the
    // assignment race in between the caller's claim and its own assignment write.
    vi.mocked((await import("./store.js")).assignTenantProject).mockImplementationOnce(async () => {
      assignments.set("ns-1", "hxc-tena-winner");
      pool.set("hxc-tena-winner", { state: "claimed", ns: "ns-1" });
      return "hxc-tena-winner";
    });

    const project = await tenantProjectForNamespace("ns-1", manager);
    await waitForScheduledReplenishmentForTests();

    expect(project.projectId).toBe("hxc-tena-winner");
    expect(pool.get("hxc-tena-ready")).toEqual({ state: "ready" });
    expect(pool.get("hxc-tena-winner")).toEqual({ state: "claimed", ns: "ns-1" });
  });

  it("replenishes exactly the deficit of ready projects", async () => {
    seed({
      pool: [["hxc-tena-a", { state: "ready" }], ["hxc-tena-b", { state: "claimed", ns: "other" }]],
      size: 4,
    });

    await replenishPool();

    // 1 ready + 3 newly provisioned/registered = 4 ready; the claimed entry is consumed and
    // never returns to the pool, so the top-up targets the full size in ready entries.
    const ready = [...pool.values()].filter((entry) => entry.state === "ready").length;
    expect(ready).toBe(4);
    expect(provisioned.length).toBe(3);
    expect(deleted).toEqual([]);
  });

  it("tears down a provisioned project when its pool registration loses a race", async () => {
    seed({ size: 1 });
    vi.mocked((await import("./store.js")).registerPoolProject).mockImplementationOnce(async (projectId) => {
      // A replica registered its identically-named random project first.
      pool.set(projectId, { state: "ready" });
      return false;
    });

    await replenishPool();

    expect(deleted.length).toBe(1);
    expect(pool.size).toBe(1);
  });

  it("does nothing when the pool is disabled", async () => {
    seed({ size: 0 });

    await replenishPool();

    expect(provisioned).toEqual([]);
    expect(pool.size).toBe(0);
  });
});
