import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from "@prisma/client";
import { OrganizationRenderedConfig } from "@stackframe/stack-shared/dist/config/schema";
import { getNodeEnvironment } from '@stackframe/stack-shared/dist/utils/env';
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { globalVar } from "@stackframe/stack-shared/dist/utils/globals";
import { deepPlainEquals, filterUndefined, typedFromEntries, typedKeys } from "@stackframe/stack-shared/dist/utils/objects";
import { ignoreUnhandledRejection } from "@stackframe/stack-shared/dist/utils/promises";
import { Result } from "@stackframe/stack-shared/dist/utils/results";
import { isPromise } from "util/types";
import { Tenancy } from "./lib/tenancies";
import { traceSpan } from "./utils/telemetry";

export type PrismaClientTransaction = PrismaClient | Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
const prismaClientsStore = (globalVar.__stack_prisma_clients as undefined) || {
  global: new PrismaClient(),
  neon: new Map<string, PrismaClient>(),
  postgres: new Map<string, {
    client: PrismaClient,
    schema: string | null,
  }>(),
};
if (getNodeEnvironment().includes('development')) {
  globalVar.__stack_prisma_clients = prismaClientsStore;  // store globally so fast refresh doesn't recreate too many Prisma clients
}

export const globalPrismaClient = prismaClientsStore.global;

function getNeonPrismaClient(connectionString: string) {
  let neonPrismaClient = prismaClientsStore.neon.get(connectionString);
  if (!neonPrismaClient) {
    const adapter = new PrismaNeon({ connectionString });
    neonPrismaClient = new PrismaClient({ adapter });
    prismaClientsStore.neon.set(connectionString, neonPrismaClient);
  }
  return neonPrismaClient;
}

export function getPrismaClientForTenancy(tenancy: Tenancy) {
  return getPrismaClientForSourceOfTruth(tenancy.completeConfig.sourceOfTruth, tenancy.branchId);
}

export function getPrismaSchemaForTenancy(tenancy: Tenancy) {
  return getPrismaSchemaForSourceOfTruth(tenancy.completeConfig.sourceOfTruth, tenancy.branchId);
}

function getPostgresPrismaClient(connectionString: string) {
  let postgresPrismaClient = prismaClientsStore.postgres.get(connectionString);
  if (!postgresPrismaClient) {
    const schema = (new URL(connectionString)).searchParams.get('schema');
    const adapter = new PrismaPg({ connectionString }, schema ? { schema } : undefined);
    postgresPrismaClient = {
      client: new PrismaClient({ adapter }),
      schema: schema ?? null,
    };
    prismaClientsStore.postgres.set(connectionString, postgresPrismaClient);
  }
  return postgresPrismaClient;
}

export function getPrismaClientForSourceOfTruth(sourceOfTruth: OrganizationRenderedConfig["sourceOfTruth"], branchId: string) {
  switch (sourceOfTruth.type) {
    case 'neon': {
      if (!(branchId in sourceOfTruth.connectionStrings)) {
        throw new Error(`No connection string provided for Neon source of truth for branch ${branchId}`);
      }
      return getNeonPrismaClient(sourceOfTruth.connectionStrings[branchId]);
    }
    case 'postgres': {
      return getPostgresPrismaClient(sourceOfTruth.connectionString).client;
    }
    case 'hosted': {
      return globalPrismaClient;
    }
    default: {
      // @ts-expect-error sourceOfTruth should be never, otherwise we're missing a switch-case
      throw new StackAssertionError(`Unknown source of truth type: ${sourceOfTruth.type}`);
    }
  }
}

export function getPrismaSchemaForSourceOfTruth(sourceOfTruth: OrganizationRenderedConfig["sourceOfTruth"], branchId: string) {
  switch (sourceOfTruth.type) {
    case 'postgres': {
      return getPostgresPrismaClient(sourceOfTruth.connectionString).schema ?? 'public';
    }
    default: {
      return 'public';
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

export async function retryTransaction<T>(client: PrismaClient, fn: (tx: PrismaClientTransaction) => Promise<T>): Promise<T> {
  // disable serializable transactions for now, later we may re-add them
  const enableSerializable = false as boolean;

  return await traceSpan('Prisma transaction', async (span) => {
    const res = await Result.retry(async (attemptIndex) => {
      return await traceSpan(`transaction attempt #${attemptIndex}`, async (attemptSpan) => {
        const attemptRes = await (async () => {
          try {
            return Result.ok(await client.$transaction(async (tx, ...args) => {
              let res;
              try {
                res = await fn(tx, ...args);
              } catch (e) {
                // we don't want to retry errors that happened in the function, because otherwise we may be retrying due
                // to other (nested) transactions failing
                // however, we make an exception for "Transaction already closed", as those are (annoyingly) thrown on
                // the actual query, not the $transaction function itself
                if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2028") { // Transaction already closed
                  throw new TransactionErrorThatShouldBeRetried(e);
                }
                throw new TransactionErrorThatShouldNotBeRetried(e);
              }
              if (getNodeEnvironment() === 'development' || getNodeEnvironment() === 'test') {
                // In dev/test, let's just fail the transaction with a certain probability, if we haven't already failed multiple times
                // this is to test the logic that every transaction is retryable
                if (attemptIndex < 3 && Math.random() < 0.5) {
                  throw new TransactionErrorThatShouldBeRetried(new Error("Test error for dev/test. This should automatically be retried."));
                }
              }
              return res;
            }, {
              isolationLevel: enableSerializable && attemptIndex < 4 ? Prisma.TransactionIsolationLevel.Serializable : undefined,
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
            if ([
              "Transaction failed due to a write conflict or a deadlock. Please retry your transaction",
              "Transaction already closed: A commit cannot be executed on an expired transaction. The timeout for this transaction",
            ].some(s => e instanceof Prisma.PrismaClientKnownRequestError && e.message.includes(s))) {
              // transaction timeout, retry
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
    }, 5, {
      exponentialDelayBase: getNodeEnvironment() === 'development' || getNodeEnvironment() === 'test' ? 3 : 250,
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
    };
  },
  all: <T extends readonly any[]>(queries: { [K in keyof T]: RawQuery<T[K]> }): RawQuery<T> => {
    const supportedPrismaClients = queries.reduce((acc, q) => {
      return acc.filter(c => q.supportedPrismaClients.includes(c));
    }, allSupportedPrismaClients as RawQuery<any>["supportedPrismaClients"]);
    if (supportedPrismaClients.length === 0) {
      throw new StackAssertionError("The queries must have at least one overlapping supported Prisma client");
    }

    return {
      supportedPrismaClients,
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
  return await traceSpan({
    description: `raw SQL quer${queries.length === 1 ? "y" : `ies (${queries.length} total)`}`,
    attributes: {
      "stack.raw-queries.length": queries.length,
      ...Object.fromEntries(queries.flatMap((q, index) => [
        [`stack.raw-queries.${index}.text`, q.sql.text],
        [`stack.raw-queries.${index}.params`, JSON.stringify(q.sql.values)],
      ])),
    },
  }, async () => {
    if (queries.length === 0) return [] as any;

    // Prisma does a query for every rawQuery call by default, even if we batch them with transactions
    // So, instead we combine all queries into one, and then return them as a single JSON result
    const combinedQuery = RawQuery.all(queries);

    // TODO: check that combinedQuery supports the prisma client that created tx

    // Supabase's index advisor only analyzes rows that start with "SELECT" (for some reason)
    // Since ours starts with "WITH", we prepend a SELECT to it
    const sqlQuery = Prisma.sql`SELECT * FROM (${combinedQuery.sql}) AS _`;
    const rawResult = await tx.$queryRaw(sqlQuery);

    const postProcessed = combinedQuery.postProcess(rawResult as any);
    // If the postProcess is async, postProcessed is a Promise. If that Promise is rejected, it will cause an unhandled promise rejection.
    // We don't want that, because Vercel crashes on unhandled promise rejections.
    if (isPromise(postProcessed)) {
      ignoreUnhandledRejection(postProcessed);
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

export function sqlQuoteIdent(id: string) {
  // accept letters, numbers, underscore, $, and dash (adjust as needed)
  if (!/^[A-Za-z_][A-Za-z0-9_\-$]*$/.test(id)) {
    throw new Error(`Invalid identifier: ${id}`);
  }
  // escape embedded double quotes just in case
  return Prisma.raw(`"${id.replace(/"/g, '""')}"`);
}
