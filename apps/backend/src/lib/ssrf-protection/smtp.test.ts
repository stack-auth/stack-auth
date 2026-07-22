import dnsPromises from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkSmtpEgressPolicy, shouldEnforceSmtpEgressPolicy } from "./smtp";

function mockDnsLookup(addresses: LookupAddress[]) {
  return vi.spyOn(dnsPromises, "lookup").mockResolvedValue(addresses as never);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("checkSmtpEgressPolicy port allowlist", () => {
  it("rejects disallowed SMTP ports", async () => {
    await expect(checkSmtpEgressPolicy({ host: "203.0.113.10", port: 2526 })).resolves.toMatchObject({
      status: "error",
      violation: { reason: "disallowed-port" },
    });
  });

  it("allows the non-standard-but-permitted port 2525", async () => {
    await expect(checkSmtpEgressPolicy({ host: "8.8.8.8", port: 2525 })).resolves.toEqual({
      status: "ok",
      addresses: ["8.8.8.8"],
      connectHost: "8.8.8.8",
      servername: null,
    });
  });
});

describe("checkSmtpEgressPolicy IP literals", () => {
  it("rejects internal IP literals", async () => {
    const internalHosts = [
      "127.0.0.1",
      "10.0.0.1",
      "172.16.0.1",
      "192.168.0.1",
      "169.254.169.254",
      "::1",
      "::ffff:7f00:1",
      "fd00::1",
      "fe80::1",
    ];

    for (const host of internalHosts) {
      await expect(checkSmtpEgressPolicy({ host, port: 587 })).resolves.toMatchObject({
        status: "error",
        violation: { reason: "internal-ip-literal" },
      });
    }
  });

  it("allows public IP literals and does not set an SNI servername", async () => {
    await expect(checkSmtpEgressPolicy({ host: "8.8.8.8", port: 587 })).resolves.toEqual({
      status: "ok",
      addresses: ["8.8.8.8"],
      connectHost: "8.8.8.8",
      servername: null,
    });
  });
});

describe("checkSmtpEgressPolicy hostnames", () => {
  it("pins the connection to a validated resolved address and keeps the hostname for SNI", async () => {
    mockDnsLookup([{ address: "93.184.216.34", family: 4 }]);
    await expect(checkSmtpEgressPolicy({ host: "smtp.example.com", port: 587 })).resolves.toEqual({
      status: "ok",
      addresses: ["93.184.216.34"],
      connectHost: "93.184.216.34",
      servername: "smtp.example.com",
    });
  });

  it("rejects hostnames that resolve to an internal address", async () => {
    mockDnsLookup([{ address: "10.0.0.5", family: 4 }]);
    await expect(checkSmtpEgressPolicy({ host: "sneaky.example.com", port: 587 })).resolves.toMatchObject({
      status: "error",
      violation: { reason: "internal-resolved-address", addresses: ["10.0.0.5"] },
    });
  });

  it("rejects hostnames when every resolved address is internal even if one is public", async () => {
    mockDnsLookup([
      { address: "93.184.216.34", family: 4 },
      { address: "169.254.169.254", family: 4 },
    ]);
    await expect(checkSmtpEgressPolicy({ host: "mixed.example.com", port: 587 })).resolves.toMatchObject({
      status: "error",
      violation: { reason: "internal-resolved-address", addresses: ["169.254.169.254"] },
    });
  });

  it("reports DNS lookup failures", async () => {
    vi.spyOn(dnsPromises, "lookup").mockRejectedValue(new Error("boom"));
    await expect(checkSmtpEgressPolicy({ host: "broken.example.com", port: 587 })).resolves.toMatchObject({
      status: "error",
      violation: { reason: "dns-lookup-failed" },
    });
  });
});

describe("shouldEnforceSmtpEgressPolicy", () => {
  it("is disabled in development and test", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(shouldEnforceSmtpEgressPolicy()).toBe(false);
    vi.stubEnv("NODE_ENV", "test");
    expect(shouldEnforceSmtpEgressPolicy()).toBe(false);
  });

  it("is enabled in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(shouldEnforceSmtpEgressPolicy()).toBe(true);
  });

  it("can be disabled by the operator escape hatch in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("HEXCLAVE_ALLOW_STANDARD_SMTP_PRIVATE_HOSTS", "true");
    expect(shouldEnforceSmtpEgressPolicy()).toBe(false);
  });
});
