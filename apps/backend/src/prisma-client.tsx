import { Prisma, PrismaClient } from "@prisma/client";
import { withAccelerate } from "@prisma/extension-accelerate";
import { getEnvVariable, getNodeEnvironment } from '@stackframe/stack-shared/dist/utils/env';
import { deepPlainEquals, filterUndefined, typedFromEntries, typedKeys } from "@stackframe/stack-shared/dist/utils/objects";
import { Result } from "@stackframe/stack-shared/dist/utils/results";
import { traceSpan } from "./utils/telemetry";

// In dev mode, fast refresh causes us to recreate many Prisma clients, eventually overloading the database.
// Therefore, only create one Prisma client in dev mode.
const globalForPrisma = global as unknown as { prisma: PrismaClient };

const useAccelerate = getEnvVariable('STACK_ACCELERATE_ENABLED', 'false') === 'true';

// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
export const prismaClient = globalForPrisma.prisma || (useAccelerate ? new PrismaClient().$extends(withAccelerate()) : new PrismaClient());

if (getNodeEnvironment() !== 'production') {
  globalForPrisma.prisma = prismaClient;
}


export async function retryTransaction<T>(fn: (...args: Parameters<Parameters<typeof prismaClient.$transaction>[0]>) => Promise<T>): Promise<T> {
  // disable serializable transactions for now, later we may re-add them
  const enableSerializable = false as boolean;

  return await traceSpan('Prisma transaction', async (span) => {
    const res = await Result.retry(async (attemptIndex) => {
      return await traceSpan(`transaction attempt #${attemptIndex}`, async (attemptSpan) => {
        const attemptRes = await (async () => {
          try {
            return await prismaClient.$transaction(async (...args) => {
              try {
                return Result.ok(await fn(...args));
              } catch (e) {
                if (e instanceof Prisma.PrismaClientKnownRequestError || e instanceof Prisma.PrismaClientUnknownRequestError) {
                  // retry
                  return Result.error(e);
                }
                throw e;
              }
            }, {
              isolationLevel: enableSerializable && attemptIndex < 4 ? Prisma.TransactionIsolationLevel.Serializable : undefined,
            });
          } catch (e) {
            // we don't want to retry as aggressively here, because the error may have been thrown after the transaction was already committed
            // so, we select the specific errors that we know are safe to retry
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
      exponentialDelayBase: 250,
    });

    span.setAttribute("stack.prisma.transaction.success", res.status === "ok");
    span.setAttribute("stack.prisma.transaction.attempts", res.attempts);
    span.setAttribute("stack.prisma.transaction.serializable-enabled", enableSerializable ? "true" : "false");

    return Result.orThrow(res);
  });
}

export type RawQuery<T> = {
  sql: Prisma.Sql,
  postProcess: (rows: any[]) => T,  // Tip: If your postProcess is async, just set T = Promise<any> (compared to doing Promise.all in rawQuery, this ensures that there are no accidental timing attacks)
};

export async function rawQuery<Q extends RawQuery<any>>(query: Q): Promise<Awaited<ReturnType<Q["postProcess"]>>> {
  const result = await rawQueryArray([query]);
  return result[0];
}

export async function rawQueryAll<Q extends Record<string, undefined | RawQuery<any>>>(queries: Q): Promise<{ [K in keyof Q]: Awaited<ReturnType<NonNullable<Q[K]>["postProcess"]>> }> {
  const keys = typedKeys(filterUndefined(queries));
  const result = await rawQueryArray(keys.map(key => queries[key as any] as any));
  return typedFromEntries(keys.map((key, index) => [key, result[index]])) as any;
}

async function rawQueryArray<Q extends RawQuery<any>[]>(queries: Q): Promise<[] & { [K in keyof Q]: Awaited<ReturnType<Q[K]["postProcess"]>> }> {
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
    // So, instead we combine all queries into one using WITH, and then return them as a single JSON result
    const withQuery = Prisma.sql`
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
    `;

    // Supabase's index advisor only analyzes rows that start with "SELECT" (for some reason)
    // Since ours starts with "WITH", we prepend a SELECT to it
    const query = Prisma.sql`SELECT * FROM (${withQuery}) AS _`;

    const rawResult = await prismaClient.$queryRaw(query) as { type: string, json: any }[];
    const unprocessed = new Array(queries.length).fill(null).map(() => [] as any[]);
    for (const row of rawResult) {
      const type = row.type;
      const index = +type.slice(1);
      unprocessed[index].push(row.json);
    }
    const postProcessed = queries.map((q, index) => q.postProcess(unprocessed[index]));
    return postProcessed as any;
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
