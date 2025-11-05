import { Prisma } from "@prisma/client";
import { PrismaClientTransaction } from "@/prisma-client";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";

export type CacheGetOrSetOptions<T> = {
  namespace: string,
  cacheKey: string,
  ttlMs: number,
  prisma: PrismaClientTransaction,
  loader: () => Promise<T>,
}

function computeExpiry(ttlMs: number): Date {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw new Error("Cache TTL must be a positive number.");
  }
  return new Date(Date.now() + ttlMs);
}

export async function getOrSetCacheValue<T>(options: CacheGetOrSetOptions<T>): Promise<T> {
  if (!options.namespace) {
    throw new StackAssertionError("Cache namespace must be a non-empty string.");
  }
  if (!options.cacheKey) {
    throw new StackAssertionError("Cache key must be a non-empty string.");
  }

  const existing = await options.prisma.cacheEntry.findUnique({
    where: {
      namespace_cacheKey: {
        namespace: options.namespace,
        cacheKey: options.cacheKey,
      },
    },
  });

  if (existing && existing.expiresAt.getTime() > Date.now()) {
    return existing.payload as T;
  }

  const value = await options.loader();
  const expiresAt = computeExpiry(options.ttlMs);
  const payload = value as Prisma.InputJsonValue;

  await options.prisma.cacheEntry.upsert({
    where: {
      namespace_cacheKey: {
        namespace: options.namespace,
        cacheKey: options.cacheKey,
      },
    },
    create: {
      namespace: options.namespace,
      cacheKey: options.cacheKey,
      payload,
      expiresAt,
    },
    update: {
      payload,
      expiresAt,
    },
  });

  return value;
}
