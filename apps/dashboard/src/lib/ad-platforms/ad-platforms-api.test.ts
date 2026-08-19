import { beforeEach, describe, expect, test } from "vitest";
import {
  AdPlatformApiError,
  connectAdPlatform,
  disconnectAdPlatform,
  fetchAdPlatformInsights,
  fetchAdPlatformStatus,
} from "./ad-platforms-api";

const PROJECT_ID = "proj_1";
const OTHER_PROJECT_ID = "proj_2";

/**
 * This package's vitest environment is `node`, which has no `localStorage`. Installing a minimal
 * in-memory one lets these tests exercise the module's REAL storage path rather than a seam added
 * for testing — the module reads the global directly, exactly as it does in a browser.
 *
 * Only the four methods the module uses are implemented; anything else would be untested scaffolding.
 */
function installMemoryLocalStorage(): void {
  const entries = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => void entries.set(key, value),
      removeItem: (key: string) => void entries.delete(key),
      clear: () => entries.clear(),
    },
  });
}

beforeEach(() => {
  installMemoryLocalStorage();
});

describe("without localStorage at all", () => {
  test("reads as not connected rather than throwing", async () => {
    // The real case this covers is a server render, where the module runs before hydration. Reading
    // "we cannot tell" as "not connected" is the safe direction: it shows the setup flow rather than
    // sample figures.
    Reflect.deleteProperty(globalThis, "localStorage");
    expect((await fetchAdPlatformStatus(PROJECT_ID, "meta")).connected).toBe(false);
    // Connecting cannot persist either, but must not blow up the click handler that called it.
    await expect(connectAdPlatform(PROJECT_ID, "meta")).resolves.toMatchObject({ connected: true });
  });
});

describe("fetchAdPlatformStatus", () => {
  test("reports not connected before anything is connected", async () => {
    const status = await fetchAdPlatformStatus(PROJECT_ID, "meta");
    expect(status.connected).toBe(false);
    expect(status.accounts).toEqual([]);
    // `configured: true` on purpose — the page must offer the connect flow, not the "an operator
    // needs to set credentials" dead end, which would be a misleading diagnosis.
    expect(status.configured).toBe(true);
  });

  test("marks every status as mock, connected or not", async () => {
    // THE load-bearing assertion of this module: the pages key their "sample data" labelling off
    // this flag, so a status that forgets it would present invented ad figures as the customer's own.
    expect((await fetchAdPlatformStatus(PROJECT_ID, "meta")).mock).toBe(true);
    await connectAdPlatform(PROJECT_ID, "meta");
    expect((await fetchAdPlatformStatus(PROJECT_ID, "meta")).mock).toBe(true);
  });

  test("carries the preview warning in both states, so the UI always has something to show", async () => {
    const disconnected = await fetchAdPlatformStatus(PROJECT_ID, "meta");
    const connected = await connectAdPlatform(PROJECT_ID, "meta");
    for (const status of [disconnected, connected]) {
      expect(status.warnings.map((warning) => warning.code)).toContain("preview_connection");
    }
  });

  test("never claims a capability that could spend money", async () => {
    const status = await connectAdPlatform(PROJECT_ID, "meta");
    expect(status.capabilities.canManage).toBe(false);
    expect(status.capabilities.canManageCatalog).toBe(false);
  });
});

describe("connectAdPlatform", () => {
  test("makes the platform read as connected, with sample accounts", async () => {
    await connectAdPlatform(PROJECT_ID, "meta");
    const status = await fetchAdPlatformStatus(PROJECT_ID, "meta");
    expect(status.connected).toBe(true);
    expect(status.status).toBe("connected");
    expect(status.accounts).toHaveLength(1);
  });

  test("is scoped to one project, so another project does not inherit the connection", async () => {
    await connectAdPlatform(PROJECT_ID, "meta");
    expect((await fetchAdPlatformStatus(OTHER_PROJECT_ID, "meta")).connected).toBe(false);
  });

  test("is scoped to one platform", async () => {
    await connectAdPlatform(PROJECT_ID, "meta");
    expect((await fetchAdPlatformStatus(PROJECT_ID, "google")).connected).toBe(false);
  });

  test("survives a reload, since the flag lives in localStorage rather than component state", async () => {
    await connectAdPlatform(PROJECT_ID, "meta");
    // A fresh read with no in-memory state involved is exactly what a reload does.
    expect((await fetchAdPlatformStatus(PROJECT_ID, "meta")).connected).toBe(true);
  });
});

describe("disconnectAdPlatform", () => {
  test("clears the connection", async () => {
    await connectAdPlatform(PROJECT_ID, "meta");
    const result = await disconnectAdPlatform(PROJECT_ID, "meta");
    expect(result.disconnected).toBe(true);
    expect(result.alreadyDisconnected).toBe(false);
    expect((await fetchAdPlatformStatus(PROJECT_ID, "meta")).connected).toBe(false);
  });

  test("reports an already-disconnected platform as such rather than erroring", async () => {
    expect((await disconnectAdPlatform(PROJECT_ID, "meta")).alreadyDisconnected).toBe(true);
  });

  test("claims the remote revoke succeeded, because there is no remote grant to revoke", async () => {
    // Reporting false here would make the page tell the user to go clean up a Meta grant that never
    // existed — a scarier and less accurate message than saying nothing.
    await connectAdPlatform(PROJECT_ID, "meta");
    expect((await disconnectAdPlatform(PROJECT_ID, "meta")).revokedRemotely).toBe(true);
  });
});

describe("fetchAdPlatformInsights", () => {
  const options = {
    accountId: "act_0000000000",
    level: "campaign" as const,
    objectIds: ["123"],
    since: "2026-07-05",
    until: "2026-08-04",
    timeIncrement: "all" as const,
  };

  test("refuses when the platform is not connected", async () => {
    await expect(fetchAdPlatformInsights(PROJECT_ID, "meta", options)).rejects.toThrow(AdPlatformApiError);
  });

  test("returns a labelled sample row for the requested object", async () => {
    await connectAdPlatform(PROJECT_ID, "meta");
    const result = await fetchAdPlatformInsights(PROJECT_ID, "meta", options);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].objectId).toBe("123");
    expect(result.warnings.map((warning) => warning.code)).toContain("preview_connection");
  });

  test("returns identical numbers on every call", async () => {
    // Deliberately fixed rather than randomised: figures that drift between renders read as live
    // data, which is the precise impression this module must not give.
    await connectAdPlatform(PROJECT_ID, "meta");
    const first = await fetchAdPlatformInsights(PROJECT_ID, "meta", options);
    const second = await fetchAdPlatformInsights(PROJECT_ID, "meta", options);
    expect(first.rows[0]).toEqual(second.rows[0]);
  });

  test("reports no per-day date, so nothing can draw a trend out of it", async () => {
    await connectAdPlatform(PROJECT_ID, "meta");
    const result = await fetchAdPlatformInsights(PROJECT_ID, "meta", options);
    expect(result.rows[0].date).toBeNull();
  });
});
