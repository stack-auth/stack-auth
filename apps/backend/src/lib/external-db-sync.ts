import { Tenancy } from "@/lib/tenancies";
import { getPrismaClientForTenancy, PrismaClientTransaction } from "@/prisma-client";
import type { CompleteConfig } from "@stackframe/stack-shared/dist/config/schema";
import { Client } from 'pg';

export function getExternalDatabases(config: CompleteConfig) {
  return config.dbSync.externalDatabases;
}

async function pushRowsToExternalDb(
  externalClient: Client,
  tableName: string,
  newRows: any[],
  upsertQuery?: string,
) {
  if (!upsertQuery) {
    throw new Error(
      `Cannot sync table "${tableName}": No upsertQuery configured.`
    );
  }

  if (newRows.length === 0) return;
  const placeholderMatches = upsertQuery.match(/\$\d+/g) ?? [];
  const expectedParamCount =
    placeholderMatches.length === 0
      ? 0
      : Math.max(...placeholderMatches.map((m) => Number(m.slice(1))));

  if (expectedParamCount === 0) {
    throw new Error(
      `upsertQuery for table "${tableName}" contains no positional parameters ($1, $2, ...).` +
        ` Your mapping must use parameterized SQL.`
    );
  }
  const sampleRow = newRows[0];
  const { tenancyId: _ignore, ...restSample } = sampleRow;
  const orderedKeys = Object.keys(restSample);

  if (orderedKeys.length !== expectedParamCount) {
    throw new Error(
      ` Column count mismatch for table "${tableName}".\n` +
        `→ upsertQuery expects ${expectedParamCount} parameters.\n` +
        `→ internalDbFetchQuery returned ${orderedKeys.length} columns (excluding tenancyId).\n` +
        `Fix your SELECT column order or your SQL parameter order.`
    );
  }

  for (const row of newRows) {
    const { tenancyId, ...rest } = row;
    const rowKeys = Object.keys(rest);

    const validShape =
      rowKeys.length === orderedKeys.length &&
      rowKeys.every((k, i) => k === orderedKeys[i]);

    if (!validShape) {
      throw new Error(
        `  Row shape mismatch for table "${tableName}".\n` +
          `Expected column order: [${orderedKeys.join(", ")}]\n` +
          `Received column order: [${rowKeys.join(", ")}]\n` +
          `Your SELECT must be explicit, ordered, and NEVER use SELECT *.\n` +
          `Fix the SELECT in internalDbFetchQuery immediately.`
      );
    }
  }
  for (const row of newRows) {
    const { tenancyId, ...rest } = row;
    await externalClient.query(upsertQuery, Object.values(rest));
  }
}


async function syncMapping(
  externalClient: Client,
  mappingId: string,
  mapping: CompleteConfig["dbSync"]["externalDatabases"][string]["mappings"][string],
  internalPrisma: PrismaClientTransaction,
  dbId: string,
  tenancyId: string,
) {

  const rawSourceTables: any = (mapping as any).sourceTables;
  const sourceTables: string[] = rawSourceTables
    ? Object.values(rawSourceTables)
    : [];

  const rawTargetPk: any = (mapping as any).targetTablePrimaryKey;
  const targetTablePrimaryKey: string[] = rawTargetPk
    ? Object.values(rawTargetPk)
    : [];

  if (sourceTables.length === 0) {
    console.error(
      ` Invalid configuration for mapping #${mappingId}: 'sourceTables' resolved to an empty list.`,
    );
    return;
  }

  if (targetTablePrimaryKey.length === 0) {
    console.error(
      ` Invalid configuration for mapping #${mappingId}: 'targetTablePrimaryKey' resolved to an empty list.`,
    );
    return;
  }

  const fetchQuery = mapping.internalDbFetchQuery;
  if (!fetchQuery || !mapping.targetTable) {
    return;
  }

  const tableName = mapping.targetTable;

  if (mapping.targetTableSchema) {
    const checkTableQuery = `
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public'
        AND table_name = $1
      );
    `;
    const res = await externalClient.query(checkTableQuery, [tableName]);
    if (!res.rows[0].exists) {
      try {
        await externalClient.query(mapping.targetTableSchema);
      } catch (err: any) {
        if (err.code !== '23505' || err.constraint !== 'pg_type_typname_nsp_index') {
          throw err;
        }
      }
    }
  }

  const rows = await internalPrisma.$queryRawUnsafe<any[]>(fetchQuery, tenancyId);

  await pushRowsToExternalDb(
    externalClient,
    tableName,
    rows,
    mapping.externalDbUpdateQuery,
  );
}


async function syncDatabase(
  dbId: string,
  dbConfig: CompleteConfig["dbSync"]["externalDatabases"][string],
  internalPrisma: PrismaClientTransaction,
  tenancyId: string,
) {

  const mappings = dbConfig.mappings;

  const isArray = Array.isArray(mappings);
  const mappingCount = mappings
    ? (isArray ? (mappings as any[]).length : Object.keys(mappings as Record<string, unknown>).length)
    : 0;

  if (!dbConfig.connectionString) {
    return;
  }

  const externalClient = new Client({
    connectionString: dbConfig.connectionString,
  });

  try {
    await externalClient.connect();

    if (!mappings || mappingCount === 0) {
      return;
    }

    for (const [mappingId, mapping] of Object.entries(mappings)) {
      await syncMapping(
        externalClient,
        mappingId,
        mapping as any,
        internalPrisma,
        dbId,
        tenancyId,
      );
    }

  } catch (error: any) {
    console.error(`Error syncing external DB ${dbId}:`, error);
  } finally {
    await externalClient.end();
  }
}


export async function syncExternalDatabases(tenancy: Tenancy) {
  const externalDatabases = getExternalDatabases(tenancy.config);
  if (Object.keys(externalDatabases).length === 0) {
    return;
  }

  const internalPrisma = await getPrismaClientForTenancy(tenancy);

  for (const [dbId, dbConfig] of Object.entries(externalDatabases)) {
    await syncDatabase(dbId, dbConfig, internalPrisma, tenancy.id);
  }
}
