import { Prisma } from "@/generated/prisma/client";
import { describe, expect, it } from "vitest";
import { isRetryableTransactionError } from "@/prisma-client";

describe("isRetryableTransactionError", () => {
  it("recognizes the Prisma adapter serialization conflict shape", () => {
    const error = new Error("TransactionWriteConflict", {
      cause: {
        originalCode: "40001",
        originalMessage: "could not serialize access due to read/write dependencies among transactions",
        kind: "TransactionWriteConflict",
      },
    });
    error.name = "DriverAdapterError";

    expect(isRetryableTransactionError(error)).toBe(true);
  });

  it.each(["P2028", "P2034"])("recognizes Prisma error code %s", (code) => {
    const error = new Prisma.PrismaClientKnownRequestError("transaction error", {
      code,
      clientVersion: "test",
    });

    expect(isRetryableTransactionError(error)).toBe(true);
  });

  it("does not retry unrelated Prisma errors", () => {
    const error = new Prisma.PrismaClientKnownRequestError("unique constraint", {
      code: "P2002",
      clientVersion: "test",
    });

    expect(isRetryableTransactionError(error)).toBe(false);
  });

  it("recognizes a raw-query P2010 wrapping the adapter serialization conflict", () => {
    const error = new Prisma.PrismaClientKnownRequestError("raw query error", {
      code: "P2010",
      clientVersion: "test",
      meta: {
        driverAdapterError: {
          cause: { kind: "TransactionWriteConflict" },
        },
      },
    });

    expect(isRetryableTransactionError(error)).toBe(true);
  });

  it("does not retry a P2010 wrapping an unrelated adapter error", () => {
    const error = new Prisma.PrismaClientKnownRequestError("raw query error", {
      code: "P2010",
      clientVersion: "test",
      meta: {
        driverAdapterError: {
          cause: { kind: "UniqueConstraintViolation" },
        },
      },
    });

    expect(isRetryableTransactionError(error)).toBe(false);
  });

  it("does not retry unrelated adapter errors", () => {
    const error = new Error("UniqueConstraintViolation", {
      cause: { kind: "UniqueConstraintViolation" },
    });
    error.name = "DriverAdapterError";

    expect(isRetryableTransactionError(error)).toBe(false);
  });

  it("does not retry an adapter error based on its message alone", () => {
    const error = new Error("TransactionWriteConflict", {
      cause: { kind: "UniqueConstraintViolation" },
    });
    error.name = "DriverAdapterError";

    expect(isRetryableTransactionError(error)).toBe(false);
  });

  it("does not retry plain errors", () => {
    expect(isRetryableTransactionError(new Error("transaction error"))).toBe(false);
  });
});
