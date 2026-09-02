import type { DataSourceType } from "@hexclave/shared/dist/data-sources/modes";
import { convexDriver } from "./convex";
import { postgresDriver } from "./postgres";
import type { DataSourceDriver } from "./types";

/**
 * Every source type Hexclave can pull from.
 *
 * Adding one is a new entry here plus the module it points at. Nothing outside a
 * driver branches on `type`: the scheduler, the lease, the entitlement check,
 * the destination isolation and the per-stream error reporting are shared, and a
 * driver that reimplemented any of them would be a bug rather than a feature.
 */
export const DATA_SOURCE_DRIVERS: Record<DataSourceType, DataSourceDriver> = {
  postgres: postgresDriver,
  convex: convexDriver,
};

export function getDriver(type: DataSourceType): DataSourceDriver {
  return DATA_SOURCE_DRIVERS[type];
}
