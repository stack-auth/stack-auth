import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DomainClaim, PendingDomainClaim } from "./types.js";

let pending: { value: PendingDomainClaim, etag: string } | null = null;
let claimed: { value: DomainClaim, etag: string } | null = null;
const hasDomainVerificationRecord = vi.hoisted(() => vi.fn());
const claimDomain = vi.hoisted(() => vi.fn());
const ensureDomainGateway = vi.hoisted(() => vi.fn());
const ensureDomain = vi.hoisted(() => vi.fn());

vi.mock("./domain-verification.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("./domain-verification.js")>(),
  createDomainVerificationToken: () => "tenant-bound-token",
  hasDomainVerificationRecord,
}));
vi.mock("./reconciliation-lock.js", () => ({
  withReconciliationLease: async (_ns: string, _key: string, fn: (lease: { assertOwned: () => Promise<void> }) => Promise<unknown>) => await fn({ assertOwned: async () => {} }),
}));
vi.mock("./platform-domain-lock.js", () => ({
  withPlatformDomainLease: async (fn: (lease: { assertOwned: () => Promise<void> }) => Promise<unknown>) => await fn({ assertOwned: async () => {} }),
}));
vi.mock("./services.js", () => ({
  assertServiceCanHoldADomain: () => {},
  resolveEnv: async () => ({ ok: true, env: {} }),
}));
vi.mock("./gcp/runtime.js", () => ({ ensureDomainGateway }));
vi.mock("./gcp/context.js", () => ({
  tenantContext: async () => ({
    domains: {
      ensureFrontendDnsRecords: async (hostname: string) => [{ type: "A", name: hostname, value: "203.0.113.10" }],
      ensure: ensureDomain,
    },
  }),
}));
vi.mock("./store.js", () => ({
  readSpec: async () => ({ spec: { config: { ports: { "3000": { protocol: "http" } }, public: true }, env: {} } }),
  readDomainClaim: async () => claimed?.value ?? null,
  readDomainClaimVersioned: async () => claimed,
  readPendingDomainClaimVersioned: async () => pending,
  createPendingDomainClaim: async (value: PendingDomainClaim) => {
    pending = { value, etag: "pending-etag" };
    return pending.etag;
  },
  deletePendingDomainClaim: async () => {
    pending = null;
    return true;
  },
  claimDomain,
  rewriteDomainClaim: vi.fn(),
  releaseDomainClaim: vi.fn(),
}));

import { attachDomain } from "./domains.js";

describe("custom-domain ownership", () => {
  beforeEach(() => {
    pending = null;
    claimed = null;
    hasDomainVerificationRecord.mockReset();
    claimDomain.mockReset();
    ensureDomainGateway.mockReset();
    ensureDomain.mockReset();
    ensureDomainGateway.mockResolvedValue("cloud-run-service");
    ensureDomain.mockResolvedValue({
      hostname: "app.example.com",
      verified: true,
      dnsRecords: [{ type: "A", name: "app.example.com", value: "203.0.113.10" }],
    });
    claimDomain.mockImplementation(async (value: DomainClaim) => {
      claimed = { value, etag: "claim-etag" };
      return true;
    });
  });

  it("does not create a global claim or tenant route until the TXT token verifies", async () => {
    hasDomainVerificationRecord.mockResolvedValueOnce(false);

    await expect(attachDomain("tenant-a", "app.example.com", "web")).resolves.toEqual({
      hostname: "app.example.com",
      service_key: "web",
      verified: false,
      dns_records: [
        { type: "TXT", name: "_hexclave-verification.app.example.com", value: "hexclave-domain-verification=tenant-bound-token" },
        { type: "A", name: "app.example.com", value: "203.0.113.10" },
      ],
    });
    expect(claimDomain).not.toHaveBeenCalled();
    expect(ensureDomainGateway).not.toHaveBeenCalled();
    expect(ensureDomain).not.toHaveBeenCalled();

    hasDomainVerificationRecord.mockResolvedValueOnce(true);
    await expect(attachDomain("tenant-a", "app.example.com", "web")).resolves.toMatchObject({ verified: true });
    expect(claimDomain).toHaveBeenCalledOnce();
    expect(ensureDomain).toHaveBeenCalledOnce();
  });
});
