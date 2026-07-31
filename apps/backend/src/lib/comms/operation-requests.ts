import type { PrismaTransaction } from "@/lib/types";
import { stringCompare } from "@hexclave/shared/dist/utils/strings";
import { createHash } from "node:crypto";

export async function lockIdempotencyKey(
  tx: PrismaTransaction,
  options: {
    namespace: "contact-merge" | "conversation-operation",
    tenancyId: string,
    idempotencyKey: string,
  },
): Promise<void> {
  // A unique constraint only turns a concurrent replay into a database error.
  // The transaction-scoped lock makes the loser wait and then execute the normal
  // semantic replay check, without retaining any lock after commit/rollback.
  await tx.$queryRaw`
    SELECT pg_advisory_xact_lock(
      hashtextextended(
        ${`${options.namespace}:${options.tenancyId}:${options.idempotencyKey}`},
        0
      )
    )
  `;
}

function canonicalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalizeJson);
  }
  if (value != null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => stringCompare(left, right))
        .map(([key, child]) => [key, canonicalizeJson(child)]),
    );
  }
  return value;
}

export function operationRequestFingerprint(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalizeJson(value)))
    .digest("hex");
}

/**
 * PostgreSQL and Prisma can return equivalent JSON objects with a different key
 * order. Idempotency checks care about the JSON value, not its serialization.
 */
export function operationMetadataMatches(stored: unknown, requested: unknown): boolean {
  return JSON.stringify(canonicalizeJson(stored ?? null))
    === JSON.stringify(canonicalizeJson(requested ?? null));
}

export function sortedStringArraysEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((value, index) => value === sortedRight[index]);
}
