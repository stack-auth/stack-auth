import { Prisma, PrismaClient } from "@/generated/prisma/client";
import { getStackServerApp } from "@/stack";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaPg } from '@prisma/adapter-pg';
import { readReplicas } from '@prisma/extension-read-replicas';
import { CompleteConfig } from "@stackframe/stack-shared/dist/config/schema";
import { getEnvVariable, getNodeEnvironment } from '@stackframe/stack-shared/dist/utils/env';
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { globalVar } from "@stackframe/stack-shared/dist/utils/globals";
import { deepPlainEquals, filterUndefined, typedFromEntries, typedKeys } from "@stackframe/stack-shared/dist/utils/objects";
import { concatStacktracesIfRejected, ignoreUnhandledRejection } from "@stackframe/stack-shared/dist/utils/promises";
import { throwingProxy } from "@stackframe/stack-shared/dist/utils/proxies";
import { Result } from "@stackframe/stack-shared/dist/utils/results";
import { traceSpan } from "@stackframe/stack-shared/dist/utils/telemetry";
import { isUuid } from "@stackframe/stack-shared/dist/utils/uuids";
import net from "node:net";
import { isPromise } from "util/types";
import { runMigrationNeeded } from "./auto-migrations";
import { Tenancy } from "./lib/tenancies";
import { ensurePolyfilled } from "./polyfills";

// just ensure we're polyfilled because this file relies on envvars being expanded
ensurePolyfilled();

export type PrismaClientTransaction =
  | Omit<PrismaClient, "$on">  // $on is not available on extended Prisma clients, so we don't require it here. see: https://www.prisma.io/docs/orm/reference/prisma-client-reference#on
  | Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
const prismaClientsStore = (globalVar.__stack_prisma_clients as undefined) || {
  neon: new Map<string, PrismaClient>(),
  postgres: new Map<string, {
    client: PrismaClient,
    schema: string | null,
  }>(),
};
if (getNodeEnvironment().includes('development')) {
  globalVar.__stack_prisma_clients = prismaClientsStore;  // store globally so fast refresh doesn't recreate too many Prisma clients
}

function getNeonPrismaClient(connectionString: string) {
  let neonPrismaClient = prismaClientsStore.neon.get(connectionString);
  if (!neonPrismaClient) {
    const schema = getSchemaFromConnectionString(connectionString);
    const adapter = new PrismaNeon({ connectionString }, { schema });
    neonPrismaClient = new PrismaClient({ adapter });
    prismaClientsStore.neon.set(connectionString, neonPrismaClient);
  }
  return neonPrismaClient;
}

function getSchemaFromConnectionString(connectionString: string) {
  return (new URL(connectionString)).searchParams.get('schema') ?? "public";
}

async function resolveNeonConnectionString(entry: string): Promise<string> {
  if (!isUuid(entry)) {
    return entry;
  }
  const store = await getStackServerApp().getDataVaultStore('neon-connection-strings');
  const secret = "no client side encryption";
  const value = await store.getValue(entry, { secret });
  if (!value) throw new Error('No Neon connection string found for UUID');
  return value;
}

export async function getPrismaClientForTenancy(tenancy: Tenancy) {
  return await getPrismaClientForSourceOfTruth(tenancy.config.sourceOfTruth, tenancy.branchId);
}

export async function getPrismaSchemaForTenancy(tenancy: Tenancy) {
  return await getPrismaSchemaForSourceOfTruth(tenancy.config.sourceOfTruth, tenancy.branchId);
}


const postgresPrismaClientsStore: Map<string, {
  client: PrismaClient,
  schema: string,
}> = globalVar.__stack_postgres_prisma_clients ??= new Map();
function getPostgresPrismaClient(connectionString: string) {
  let postgresPrismaClient = postgresPrismaClientsStore.get(connectionString);
  if (!postgresPrismaClient) {
    const schema = getSchemaFromConnectionString(connectionString);
    const adapter = new PrismaPg({ connectionString, max: 25 }, schema ? { schema } : undefined);
    postgresPrismaClient = {
      client: new PrismaClient({ adapter }),
      schema,
    };
    postgresPrismaClientsStore.set(connectionString, postgresPrismaClient);
  }
  return postgresPrismaClient;
}

async function tcpPing(host: string, port: number, timeout = 2000) {
  return await new Promise<boolean>((resolve) => {
    const s = net.connect({ host, port }).setTimeout(timeout);

    const done = (result: boolean) => {
      s.destroy();
      resolve(result);
    };

    s.on("connect", () => done(true));
    s.on("timeout", () => done(false));
    s.on("error",  () => done(false));
  });
}

const originalGlobalConnectionString = getEnvVariable("STACK_DATABASE_CONNECTION_STRING", "");
const originalReplicaConnectionString = getEnvVariable("STACK_DATABASE_REPLICA_CONNECTION_STRING", "");

async function resolveConnectionStringWithOrbStack(connectionString: string): Promise<string> {
  if (!connectionString) {
    return connectionString;
  }

  // If we are on a Mac with OrbStack installed, it's much much faster to use the OrbStack-provided domain instead of
  // the container's port forwarding.
  //
  // For this reason, we check whether we can connect to the database using the OrbStack-provided domain, and if so,
  // we use it instead of the original connection string.
  if (getNodeEnvironment() === 'development' && process.platform === 'darwin') {
    const match = connectionString.match(/^postgres:\/\/([^:]+):(.*)@localhost:(\d\d)28\/(.*)$/);
    if (match) {
      const [, user, password, portPrefix, schema] = match;
      const orbStackDomain = `db.stack-dependencies-${portPrefix}.orb.local`;
      const ok = await tcpPing(orbStackDomain, 5432, 50);  // extremely short timeout; OrbStack should be fast to respond, otherwise why are we doing this?
      if (ok) {
        return `postgres://${user}:${password}@${orbStackDomain}:5432/${schema}`;
      }
    }
  }
  return connectionString;
}

let actualGlobalConnectionString: string = globalVar.__stack_actual_global_connection_string ??= await resolveConnectionStringWithOrbStack(originalGlobalConnectionString);
let actualReplicaConnectionString: string = globalVar.__stack_actual_replica_connection_string ??= await resolveConnectionStringWithOrbStack(originalReplicaConnectionString);

export type PrismaClientWithReplica<T extends PrismaClient = PrismaClient> = Omit<T, "$on"> & {
  $replica: () => Omit<T, "$on">,
};

function extendWithReadReplicas<T extends PrismaClient>(client: T, replicaConnectionString: string): PrismaClientWithReplica<T> {
  // Create a separate PrismaClient for the read replica
  const replicaClient = getPostgresPrismaClient(replicaConnectionString).client;
  return client.$extends(readReplicas({
    replicas: [replicaClient],
  })) as PrismaClientWithReplica<T>;
}

function extendWithFakeReadReplica<T extends PrismaClient>(client: T): PrismaClientWithReplica<T> {
  return client.$extends(readReplicas({
    replicas: [client],
  })) as PrismaClientWithReplica<T>;
}

export const { client: globalPrismaClient, schema: globalPrismaSchema }: {
  client: PrismaClientWithReplica<PrismaClient>,
  schema: string,
} = actualGlobalConnectionString
  ? (() => {
    const { client, schema } = getPostgresPrismaClient(actualGlobalConnectionString);
    return {
      client: actualReplicaConnectionString ? extendWithReadReplicas(client, actualReplicaConnectionString) : extendWithFakeReadReplica(client),
      schema,
    };
  })()
  : {
    client: throwingProxy<PrismaClientWithReplica<PrismaClient>>("STACK_DATABASE_CONNECTION_STRING environment variable is not set. Please set it to a valid PostgreSQL connection string, or use a mock Prisma client for testing."),
    schema: throwingProxy<string>("STACK_DATABASE_CONNECTION_STRING environment variable is not set. Please set it to a valid PostgreSQL connection string, or use a mock Prisma client for testing."),
  };

export async function getPrismaClientForSourceOfTruth(sourceOfTruth: CompleteConfig["sourceOfTruth"], branchId: string) {
  switch (sourceOfTruth.type) {
    case 'neon': {
      if (!(branchId in sourceOfTruth.connectionStrings)) {
        throw new Error(`No connection string provided for Neon source of truth for branch ${branchId}`);
      }
      const entry = sourceOfTruth.connectionStrings[branchId];
      const connectionString = await resolveNeonConnectionString(entry);
      const neonPrismaClient = getNeonPrismaClient(connectionString);
      await runMigrationNeeded({ prismaClient: neonPrismaClient, schema: getSchemaFromConnectionString(connectionString), logging: true });
      return extendWithFakeReadReplica(neonPrismaClient);
    }
    case 'postgres': {
      const postgresPrismaClient = getPostgresPrismaClient(sourceOfTruth.connectionString);
      await runMigrationNeeded({ prismaClient: postgresPrismaClient.client, schema: getSchemaFromConnectionString(sourceOfTruth.connectionString), logging: true });
      return extendWithFakeReadReplica(postgresPrismaClient.client);
    }
    case 'hosted': {
      return globalPrismaClient;
    }
  }
}

export async function getPrismaSchemaForSourceOfTruth(sourceOfTruth: CompleteConfig["sourceOfTruth"], branchId: string) {
  switch (sourceOfTruth.type) {
    case 'postgres': {
      return getSchemaFromConnectionString(sourceOfTruth.connectionString);
    }
    case 'neon': {
      if (!(branchId in sourceOfTruth.connectionStrings)) {
        throw new Error(`No connection string provided for Neon source of truth for branch ${branchId}`);
      }
      const entry = sourceOfTruth.connectionStrings[branchId];
      if (isUuid(entry)) {
        const connectionString = await resolveNeonConnectionString(entry);
        return getSchemaFromConnectionString(connectionString);
      }
      return getSchemaFromConnectionString(entry);
    }
    case 'hosted': {
      return globalPrismaSchema;
    }
  }
}


class TransactionErrorThatShouldBeRetried extends Error {
  constructor(cause: unknown) {
    super("This is an internal error used by Stack Auth to rollback Prisma transactions. It should not be visible to you, so please report this.", { cause });
    this.name = 'TransactionErrorThatShouldBeRetried';
  }
}

class TransactionErrorThatShouldNotBeRetried extends Error {
  constructor(cause: unknown) {
    super("This is an internal error used by Stack Auth to rollback Prisma transactions. It should not be visible to you, so please report this.", { cause });
    this.name = 'TransactionErrorThatShouldNotBeRetried';
  }
}

/**
 * @deprecated Prisma transactions are slow and lock the database. Use rawQuery with CTEs instead. Ask Konsti if you're confused or think you need transactions.
 */
export async function retryTransaction<T>(client: Omit<PrismaClient, "$on">, fn: (tx: PrismaClientTransaction) => Promise<T>, options: { level?: "default" | "serializable" } = {}): Promise<T> {
  // serializable transactions are currently off by default, later we may turn them on
  const enableSerializable = options.level === "serializable";

  const isRetryablePrismaError = (e: unknown) => {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      return [
        "P2028", // Serializable/repeatable read conflict
        "P2034", // Transaction already closed (eg. timeout)
      ];
    }
    return false;
  };

  return await traceSpan('Prisma transaction', async (span) => {
    const res = await Result.retry(async (attemptIndex) => {
      return await traceSpan(`transaction attempt #${attemptIndex}`, async (attemptSpan) => {
        const attemptRes = await (async () => {
          try {
            // eslint-disable-next-line no-restricted-syntax
            return Result.ok(await client.$transaction(async (tx, ...args) => {
              let res;
              try {
                res = await fn(tx, ...args);
              } catch (e) {
                // we don't want to retry errors that happened in the function, because otherwise we may be retrying due
                // to other (nested) transactions failing
                // however, we make an exception for "Transaction already closed", as those are (annoyingly) thrown on
                // the actual query, not the $transaction function itself
                if (isRetryablePrismaError(e)) {
                  throw new TransactionErrorThatShouldBeRetried(e);
                }
                throw new TransactionErrorThatShouldNotBeRetried(e);
              }
              if (getNodeEnvironment() === 'development' || getNodeEnvironment() === 'test') {
                // In dev/test, let's just fail the transaction with a certain probability, if we haven't already failed multiple times
                // this is to test the logic that every transaction is retryable
                if (attemptIndex < 2 && Math.random() < 0.5) {
                  throw new TransactionErrorThatShouldBeRetried(new Error("Test error for dev/test. This should automatically be retried."));
                }
              }
              return res;
            }, {
              isolationLevel: enableSerializable ? Prisma.TransactionIsolationLevel.Serializable : undefined,
            }));
          } catch (e) {
            // we don't want to retry too aggressively here, because the error may have been thrown after the transaction was already committed
            // so, we select the specific errors that we know are safe to retry
            if (e instanceof TransactionErrorThatShouldBeRetried) {
              return Result.error(e.cause);
            }
            if (e instanceof TransactionErrorThatShouldNotBeRetried) {
              throw e.cause;
            }
            if (isRetryablePrismaError(e)) {
              return Result.error(e);
            }
            throw e;
          }
        })();
        if (attemptRes.status === "error") {
          attemptSpan.setAttribute("stack.prisma.transaction-retry.error", `${attemptRes.error}`);
        }
        return attemptRes;
      });
    }, 3, {
      exponentialDelayBase: getNodeEnvironment() === 'development' || getNodeEnvironment() === 'test' ? 3 : 1000,
    });

    span.setAttribute("stack.prisma.transaction.success", res.status === "ok");
    span.setAttribute("stack.prisma.transaction.attempts", res.attempts);
    span.setAttribute("stack.prisma.transaction.serializable-enabled", enableSerializable ? "true" : "false");

    return Result.orThrow(res);
  });
}

const allSupportedPrismaClients = ["global", "source-of-truth"] as const;

export type RawQuery<T> = {
  supportedPrismaClients: readonly (typeof allSupportedPrismaClients)[number][],
  sql: Prisma.Sql,
  postProcess: (rows: any[]) => T,  // Tip: If your postProcess is async, just set T = Promise<any> (compared to doing Promise.all in rawQuery, this ensures that there are no accidental timing attacks)
  readOnlyQuery: boolean,  // If true, use the read replica if available
};

export const RawQuery = {
  then: <T, R>(query: RawQuery<T>, fn: (result: T) => R): RawQuery<R> => {
    return {
      supportedPrismaClients: query.supportedPrismaClients,
      sql: query.sql,
      postProcess: (rows) => {
        const result = query.postProcess(rows);
        return fn(result);
      },
      readOnlyQuery: query.readOnlyQuery,
    };
  },
  all: <T extends readonly any[]>(queries: { [K in keyof T]: RawQuery<T[K]> }): RawQuery<T> => {
    const supportedPrismaClients = queries.reduce((acc, q) => {
      return acc.filter(c => q.supportedPrismaClients.includes(c));
    }, allSupportedPrismaClients as RawQuery<any>["supportedPrismaClients"]);
    if (supportedPrismaClients.length === 0) {
      throw new StackAssertionError("The queries must have at least one overlapping supported Prisma client");
    }

    // Only mark combined query as read-only if all individual queries are read-only
    const readOnlyQuery = queries.every(q => q.readOnlyQuery);

    return {
      supportedPrismaClients,
      readOnlyQuery,
      sql: Prisma.sql`
        WITH ${Prisma.join(queries.map((q, index) => {
        return Prisma.sql`${Prisma.raw("q" + index)} AS (
            ${q.sql}
          )`;
      }), ",\n")}

        ${Prisma.join(queries.map((q, index) => {
        return Prisma.sql`
            SELECT
              ${"q" + index} AS type,
              row_to_json(c) AS json
            FROM (SELECT * FROM ${Prisma.raw("q" + index)}) c
          `;
      }), "\nUNION ALL\n")}
      `,
      postProcess: (rows) => {
        const unprocessed = new Array(queries.length).fill(null).map(() => [] as any[]);
        for (const row of rows) {
          const type = row.type;
          const index = +type.slice(1);
          unprocessed[index].push(row.json);
        }
        const postProcessed = queries.map((q, index) => {
          const postProcessed = q.postProcess(unprocessed[index]);
          // If the postProcess is async, postProcessed is a Promise. If that Promise is rejected, it will cause an unhandled promise rejection.
          // We don't want that, because Vercel crashes on unhandled promise rejections.
          if (isPromise(postProcessed)) {
            ignoreUnhandledRejection(postProcessed);
          }
          return postProcessed;
        });
        return postProcessed as any;
      },
    };
  },
  resolve: <T,>(obj: T): RawQuery<T> => {
    return {
      supportedPrismaClients: allSupportedPrismaClients,
      sql: Prisma.sql`SELECT 1`,
      postProcess: (rows) => {
        return obj;
      },
      readOnlyQuery: true,  // resolve is just a static value, doesn't actually write
    };
  },
};

export async function rawQuery<Q extends RawQuery<any>>(tx: PrismaClientTransaction, query: Q): Promise<Awaited<ReturnType<Q["postProcess"]>>> {
  const result = await rawQueryArray(tx, [query]);
  return result[0];
}

export async function rawQueryAll<Q extends Record<string, undefined | RawQuery<any>>>(tx: PrismaClientTransaction, queries: Q): Promise<{ [K in keyof Q]: ReturnType<NonNullable<Q[K]>["postProcess"]> }> {
  const keys = typedKeys(filterUndefined(queries));
  const result = await rawQueryArray(tx, keys.map(key => queries[key as any] as any));
  return typedFromEntries(keys.map((key, index) => [key, result[index]])) as any;
}

async function rawQueryArray<Q extends RawQuery<any>[]>(tx: PrismaClientTransaction, queries: Q): Promise<[] & { [K in keyof Q]: Awaited<ReturnType<Q[K]["postProcess"]>> }> {
  const allReadOnly = queries.length > 0 && queries.every(q => q.readOnlyQuery);
  return await traceSpan({
    description: `raw SQL quer${queries.length === 1 ? "y" : `ies (${queries.length} total)`}`,
    attributes: {
      "stack.raw-queries.length": queries.length,
      "stack.raw-queries.read-only": allReadOnly,
      ...Object.fromEntries(queries.flatMap((q, index) => [
        [`stack.raw-queries.${index}.text`, q.sql.text],
        [`stack.raw-queries.${index}.params`, JSON.stringify(q.sql.values)],
      ])),
    },
  }, async () => {
    if (queries.length === 0) return [] as any;

    // Prisma does a query for every rawQuery call by default, even if we batch them with transactions
    // So, instead we combine all queries into one, and then return them as a single JSON result
    const combinedQuery = RawQuery.all([...queries]);

    // TODO: check that combinedQuery supports the prisma client that created tx

    // Supabase's index advisor only analyzes rows that start with "SELECT" (for some reason)
    // Since ours starts with "WITH", we prepend a SELECT to it.
    // However, we can't do this for data-modifying queries because PostgreSQL requires
    // CTEs with UPDATE/INSERT/DELETE to be at the top level, not inside a subquery.
    const sqlQuery = allReadOnly
      ? Prisma.sql`SELECT * FROM (${combinedQuery.sql}) AS _`
      : combinedQuery.sql;

    // Use the read replica if all queries are read-only and a replica is available
    const queryClient = allReadOnly && '$replica' in tx
      ? (tx as any).$replica()
      : tx;
    // eslint-disable-next-line no-restricted-syntax -- $queryRaw is allowed here
    const rawResult = await queryClient.$queryRaw(sqlQuery);

    const postProcessed = combinedQuery.postProcess(rawResult as any);
    // If the postProcess is async, postProcessed is a Promise. If that Promise is rejected, it will cause an unhandled promise rejection.
    // We don't want that, because Vercel crashes on unhandled promise rejections.
    // We also want to concat the current stack trace to the error, so we can see where the rawQuery function was called
    if (isPromise(postProcessed)) {
      ignoreUnhandledRejection(postProcessed);
      concatStacktracesIfRejected(postProcessed);
    }

    return postProcessed;
  });
}

// not exhaustive
export const PRISMA_ERROR_CODES = {
  VALUE_TOO_LONG: "P2000",
  RECORD_NOT_FOUND: "P2001",
  UNIQUE_CONSTRAINT_VIOLATION: "P2002",
  FOREIGN_CONSTRAINT_VIOLATION: "P2003",
  GENERIC_CONSTRAINT_VIOLATION: "P2004",
} as const;

export function isPrismaError(error: unknown, code: keyof typeof PRISMA_ERROR_CODES): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === PRISMA_ERROR_CODES[code];
}

export function isPrismaUniqueConstraintViolation(error: unknown, modelName: string, target: string | string[]): error is Prisma.PrismaClientKnownRequestError {
  if (!isPrismaError(error, "UNIQUE_CONSTRAINT_VIOLATION")) return false;
  if (!error.meta?.target) return false;
  return error.meta.modelName === modelName && deepPlainEquals(error.meta.target, target);
}

export function sqlQuoteIdentToString(id: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_\-$]*$/.test(id)) {
    throw new Error(`Invalid identifier: ${id}`);
  }
  // escape embedded double quotes just in case
  return `"${id.replace(/"/g, '""')}"`;
}

export function sqlQuoteIdent(id: string) {
  return Prisma.raw(sqlQuoteIdentToString(id));
}
