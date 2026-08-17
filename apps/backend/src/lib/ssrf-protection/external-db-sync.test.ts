import { StatusError } from "@hexclave/shared/dist/utils/errors";
import dnsPromises from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assertSafeExternalPostgresConnectionString, getSafeExternalPostgresClientOptions } from "./external-db-sync";

async function withProductionExternalDbSsrfProtection<T>(callback: () => Promise<T>): Promise<T> {
  vi.stubEnv("NODE_ENV", "production");
  try {
    return await callback();
  } finally {
    vi.unstubAllEnvs();
  }
}

function mockDnsLookup(addresses: LookupAddress[]) {
  return vi.spyOn(dnsPromises, "lookup").mockResolvedValue(addresses as never);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("assertSafeExternalPostgresConnectionString", () => {
  it("rejects malformed or non-Postgres connection strings in all environments", async () => {
    await expect(assertSafeExternalPostgresConnectionString("not-a-url")).rejects.toThrow(StatusError);
    await expect(assertSafeExternalPostgresConnectionString("https://db.example.com/database")).rejects.toThrow(StatusError);
  });

  it("blocks private and metadata IP literal targets in production", async () => {
    await withProductionExternalDbSsrfProtection(async () => {
      await expect(assertSafeExternalPostgresConnectionString("postgres://user:pass@127.0.0.1:5432/db")).rejects.toThrow(StatusError);
      await expect(assertSafeExternalPostgresConnectionString("postgres://user:pass@169.254.169.254:5432/db")).rejects.toThrow(StatusError);
      await expect(assertSafeExternalPostgresConnectionString("postgres://user:pass@[::1]:5432/db")).rejects.toThrow(StatusError);
      await expect(assertSafeExternalPostgresConnectionString("postgres://user:pass@[::ffff:7f00:1]:5432/db")).rejects.toThrow(StatusError);
    });
  });

  it("allows private targets when the operator escape hatch is set", async () => {
    await withProductionExternalDbSsrfProtection(async () => {
      vi.stubEnv("HEXCLAVE_ALLOW_EXTERNAL_DB_SYNC_PRIVATE_HOSTS", "true");
      await expect(assertSafeExternalPostgresConnectionString("postgres://user:pass@127.0.0.1:5432/db")).resolves.toBeUndefined();
    });
  });
});

describe("getSafeExternalPostgresClientOptions", () => {
  it("returns the raw connection string unchanged when protection is not enforced (dev/test)", async () => {
    const connectionString = "postgres://user:pass@10.0.0.1:5432/db";
    await expect(getSafeExternalPostgresClientOptions(connectionString)).resolves.toEqual({
      connectionString,
      connectionTimeoutMillis: 10_000,
    });
  });

  it("connects to public IP literals directly without pinning (no rebinding window)", async () => {
    await withProductionExternalDbSsrfProtection(async () => {
      const connectionString = "postgres://user:pass@8.8.8.8:5432/db";
      await expect(getSafeExternalPostgresClientOptions(connectionString)).resolves.toEqual({
        connectionString,
        connectionTimeoutMillis: 10_000,
      });
    });
  });

  it("pins hostnames to a validated resolved address with the hostname preserved as SNI servername", async () => {
    await withProductionExternalDbSsrfProtection(async () => {
      mockDnsLookup([{ address: "93.184.216.34", family: 4 }]);
      const options = await getSafeExternalPostgresClientOptions(
        "postgres://user:pass@db.example.com:6432/mydb?sslmode=require",
      );
      expect(options).toMatchObject({
        host: "93.184.216.34",
        port: 6432,
        user: "user",
        password: "pass",
        database: "mydb",
        connectionTimeoutMillis: 10_000,
      });
      expect(options.ssl).toEqual({ servername: "db.example.com" });
      expect(options.connectionString).toBeUndefined();
    });
  });

  it("preserves plaintext (no TLS) when the connection string has no ssl parameters", async () => {
    await withProductionExternalDbSsrfProtection(async () => {
      mockDnsLookup([{ address: "93.184.216.34", family: 4 }]);
      const options = await getSafeExternalPostgresClientOptions("postgres://user:pass@db.example.com/mydb");
      expect(options.host).toBe("93.184.216.34");
      expect(options.ssl).toBeUndefined();
    });
  });

  it("maps sslmode=disable to no TLS and sslmode=no-verify to unverified TLS", async () => {
    await withProductionExternalDbSsrfProtection(async () => {
      mockDnsLookup([{ address: "93.184.216.34", family: 4 }]);
      const disabled = await getSafeExternalPostgresClientOptions("postgres://u:p@db.example.com/d?sslmode=disable");
      expect(disabled.ssl).toBe(false);

      const noVerify = await getSafeExternalPostgresClientOptions("postgres://u:p@db.example.com/d?sslmode=no-verify");
      expect(noVerify.ssl).toEqual({ servername: "db.example.com", rejectUnauthorized: false });
    });
  });

  it("rejects hostnames that resolve to an internal address", async () => {
    await withProductionExternalDbSsrfProtection(async () => {
      mockDnsLookup([{ address: "10.0.0.5", family: 4 }]);
      await expect(
        getSafeExternalPostgresClientOptions("postgres://user:pass@sneaky.example.com/db"),
      ).rejects.toThrow(StatusError);
    });
  });

  it("rejects localhost hostnames in production", async () => {
    await withProductionExternalDbSsrfProtection(async () => {
      await expect(
        getSafeExternalPostgresClientOptions("postgres://user:pass@db.localhost/db"),
      ).rejects.toThrow(StatusError);
    });
  });
});
