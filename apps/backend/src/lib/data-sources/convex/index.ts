import type { DataSourceDriver } from "../types";
import { probeConvex } from "./probe";
import { runConvexStreamSyncs } from "./sync";

/**
 * Convex creates nothing on the customer's deployment — the change feed is read
 * with an opaque cursor we hold ourselves — so there is no teardown. Deleting a
 * source is forgetting a URL and a key.
 */
export const convexDriver: DataSourceDriver = {
  type: "convex",
  probe: probeConvex,
  runStreamSyncs: runConvexStreamSyncs,
};
