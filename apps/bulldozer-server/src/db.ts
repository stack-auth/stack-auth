import postgres from "postgres";

const connectionString = process.env.STACK_DATABASE_CONNECTION_STRING ?? process.env.HEXCLAVE_DATABASE_CONNECTION_STRING;

if (connectionString == null || connectionString.length === 0) {
  throw new Error("Missing STACK_DATABASE_CONNECTION_STRING for Bulldozer Server");
}

export const bulldozerSql = postgres(connectionString, {
  max: 25,
});

export async function queryRaw<T extends readonly unknown[]>(query: string): Promise<T> {
  return await bulldozerSql.unsafe(query) as unknown as T;
}

type SqlParameter = string | number | boolean | Date | null;

export async function queryRawUnsafe<T extends readonly unknown[]>(query: string, params: SqlParameter[] = []): Promise<T> {
  return await bulldozerSql.unsafe(query, params) as unknown as T;
}

export async function executeRaw(query: string): Promise<void> {
  const reservedSql = await bulldozerSql.reserve();
  try {
    await reservedSql.unsafe(query);
  } catch (error) {
    // Bulldozer init/setRow scripts contain explicit transaction blocks. If one
    // fails after BEGIN, Postgres keeps that connection in an aborted transaction
    // until ROLLBACK; never return that poisoned connection to the pool.
    try {
      await reservedSql.unsafe("ROLLBACK");
    } catch (rollbackError) {
      console.error("[Bulldozer Server] Failed to roll back failed raw SQL transaction", rollbackError);
    }
    throw error;
  } finally {
    reservedSql.release();
  }
}
