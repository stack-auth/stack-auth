import { PrismaClientTransaction } from "@/prisma-client";
import { encodeBase64 } from "@stackframe/stack-shared/dist/utils/bytes";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import crypto from "crypto";

/**
 * Deterministically serializes an object to JSON with sorted keys.
 * This ensures the same object always produces the same string regardless of property order.
 */
export function canonicalJsonStringify(obj: unknown): string {
  return JSON.stringify(obj, (_, value) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return Object.keys(value)
        .sort()
        .reduce((sorted: Record<string, unknown>, key) => {
          sorted[key] = value[key];
          return sorted;
        }, {});
    }
    return value;
  });
}

/**
 * Computes a deterministic version ID from a product JSON object.
 * Uses SHA-256 hash of the canonical JSON representation.
 */
export function computeProductVersionId(productJson: unknown): string {
  const canonical = canonicalJsonStringify(productJson);
  const hash = crypto.createHash("sha256").update(canonical).digest();
  return encodeBase64(hash);
}

/**
 * Upserts a ProductVersion record and returns the productVersionId.
 * If a record with the same (tenancyId, productVersionId) exists, it's a no-op.
 */
export async function upsertProductVersion(options: {
  prisma: PrismaClientTransaction,
  tenancyId: string,
  productId: string | null,
  productJson: unknown,
}): Promise<string> {
  const productVersionId = computeProductVersionId(options.productJson);

  await options.prisma.productVersion.upsert({
    where: {
      tenancyId_productVersionId: {
        tenancyId: options.tenancyId,
        productVersionId,
      },
    },
    create: {
      tenancyId: options.tenancyId,
      productVersionId,
      productId: options.productId,
      productJson: options.productJson as object,
    },
    update: {},
  });

  return productVersionId;
}

/**
 * Retrieves a ProductVersion by tenancyId and productVersionId.
 * Throws if not found.
 */
export async function getProductVersion(options: {
  prisma: PrismaClientTransaction,
  tenancyId: string,
  productVersionId: string,
}): Promise<{ productId: string | null, productJson: unknown }> {
  const version = await options.prisma.productVersion.findUnique({
    where: {
      tenancyId_productVersionId: {
        tenancyId: options.tenancyId,
        productVersionId: options.productVersionId,
      },
    },
  });

  if (!version) {
    throw new StackAssertionError(
      "ProductVersion not found. This may indicate a race condition or deleted record.",
      {
        tenancyId: options.tenancyId,
        productVersionId: options.productVersionId,
      }
    );
  }

  return {
    productId: version.productId,
    productJson: version.productJson,
  };
}

import.meta.vitest?.describe("canonicalJsonStringify", (test) => {
  test("produces same output regardless of key order", ({ expect }) => {
    const obj1 = { b: 2, a: 1, c: 3 };
    const obj2 = { a: 1, b: 2, c: 3 };
    const obj3 = { c: 3, b: 2, a: 1 };

    expect(canonicalJsonStringify(obj1)).toBe(canonicalJsonStringify(obj2));
    expect(canonicalJsonStringify(obj2)).toBe(canonicalJsonStringify(obj3));
  });

  test("handles nested objects", ({ expect }) => {
    const obj1 = { outer: { b: 2, a: 1 }, z: 1 };
    const obj2 = { z: 1, outer: { a: 1, b: 2 } };

    expect(canonicalJsonStringify(obj1)).toBe(canonicalJsonStringify(obj2));
  });

  test("preserves array order", ({ expect }) => {
    const obj1 = { arr: [1, 2, 3] };
    const obj2 = { arr: [3, 2, 1] };

    expect(canonicalJsonStringify(obj1)).not.toBe(canonicalJsonStringify(obj2));
  });

  test("different objects produce different output", ({ expect }) => {
    const obj1 = { a: 1 };
    const obj2 = { a: 2 };

    expect(canonicalJsonStringify(obj1)).not.toBe(canonicalJsonStringify(obj2));
  });
});

import.meta.vitest?.describe("computeProductVersionId", (test) => {
  test("produces same hash for same object with different key order", ({ expect }) => {
    const obj1 = { b: 2, a: 1, c: 3 };
    const obj2 = { a: 1, b: 2, c: 3 };

    expect(computeProductVersionId(obj1)).toBe(computeProductVersionId(obj2));
  });

  test("produces different hash for different objects", ({ expect }) => {
    const obj1 = { a: 1 };
    const obj2 = { a: 2 };

    expect(computeProductVersionId(obj1)).not.toBe(computeProductVersionId(obj2));
  });

  test("hash is deterministic", ({ expect }) => {
    const obj = { foo: "bar", nested: { x: 1, y: 2 } };

    const hash1 = computeProductVersionId(obj);
    const hash2 = computeProductVersionId(obj);

    expect(hash1).toBe(hash2);
  });
});
