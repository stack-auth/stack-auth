import type { DataSourceConnection, DataSourceDriver } from "../types";
import { quotePgIdentifier, toCredentials, withDataSourceClient } from "./client";
import { probePostgres } from "./probe";
import { getReplicationSlotName, runPostgresStreamSyncs } from "./sync";

/**
 * A logical slot that nobody consumes retains WAL on the source database until
 * the customer's disk fills, so teardown is idempotent and always attempted —
 * never gated on having recorded that a slot exists. A sync that created one and
 * then timed out leaves no record, and the name is derived, so it is always
 * recoverable.
 */
async function dropCdcInfrastructure(connection: DataSourceConnection, dataSourceId: string): Promise<void> {
  const credentials = await toCredentials(connection);
  const slotName = getReplicationSlotName(dataSourceId);
  await withDataSourceClient(credentials, async client => {
    await client.query(
      `SELECT pg_drop_replication_slot($1) WHERE EXISTS (SELECT 1 FROM pg_replication_slots WHERE slot_name = $1)`,
      [slotName],
    );
    await client.query(`DROP PUBLICATION IF EXISTS ${quotePgIdentifier(slotName)}`);
  }, { allowWrites: true });
}

export const postgresDriver: DataSourceDriver = {
  type: "postgres",
  probe: probePostgres,
  runStreamSyncs: runPostgresStreamSyncs,
  teardown: async ({ connection, dataSourceId }) => {
    await dropCdcInfrastructure(connection, dataSourceId);
  },
  // Dropping the last CDC stream must release the slot: otherwise the source
  // keeps pinning WAL for changes nothing will ever read again.
  shouldTeardownOnReconfigure: ({ previousModes, nextModes }) =>
    previousModes.includes("cdc") && !nextModes.includes("cdc"),
};
