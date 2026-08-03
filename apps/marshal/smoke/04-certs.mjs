// Smoke 4: certs + public IP GraphQL with the org token — addCertificate, status query,
// duplicate-hostname error (our 409), deleteCertificate, allocate/release shared_v4 + v6.
import { flyGraphql, log } from "./lib.mjs";

const TARGET = "hxc-smoke-target";
const CALLER = "hxc-smoke-caller";
const HOSTNAME = "smoke-marshal.hexclave-nonexistent-test.dev";

// 1. Allocate public IPs (shared v4 + dedicated v6) on target
for (const type of ["shared_v4", "v6"]) {
  const r = await flyGraphql(`
    mutation($input: AllocateIPAddressInput!) {
      allocateIpAddress(input: $input) { ipAddress { id address type region } app { sharedIpAddress } }
    }`, { input: { appId: TARGET, type } });
  log(`allocate ${type}: [${r.ms}ms]`, JSON.stringify(r.json));
}

// 2. List IPs
const ips = await flyGraphql(`
  query($app: String!) { app(name: $app) { sharedIpAddress ipAddresses { nodes { id address type region } } } }`,
  { app: TARGET });
log("ips:", JSON.stringify(ips.json));

// 3. addCertificate
const add = await flyGraphql(`
  mutation($appId: ID!, $hostname: String!) {
    addCertificate(appId: $appId, hostname: $hostname) {
      certificate { id hostname configured acmeDnsConfigured acmeAlpnConfigured certificateAuthority dnsProvider dnsValidationHostname dnsValidationTarget clientStatus isApex source }
    }
  }`, { appId: TARGET, hostname: HOSTNAME });
log(`addCertificate: [${add.ms}ms]`, JSON.stringify(add.json));

// 4. Duplicate hostname on ANOTHER app -> expect "Hostname already exists" error
const dup = await flyGraphql(`
  mutation($appId: ID!, $hostname: String!) {
    addCertificate(appId: $appId, hostname: $hostname) { certificate { id } }
  }`, { appId: CALLER, hostname: HOSTNAME });
log(`duplicate addCertificate:`, JSON.stringify(dup.json));

// 4b. Re-add SAME hostname on SAME app -> idempotent or error?
const readd = await flyGraphql(`
  mutation($appId: ID!, $hostname: String!) {
    addCertificate(appId: $appId, hostname: $hostname) { certificate { id hostname } }
  }`, { appId: TARGET, hostname: HOSTNAME });
log(`re-add same app:`, JSON.stringify(readd.json));

// 5. Cert status query (what GET /services reads)
const status = await flyGraphql(`
  query($app: String!, $hostname: String!) {
    app(name: $app) {
      certificate(hostname: $hostname) {
        id hostname configured acmeDnsConfigured clientStatus check
        dnsValidationHostname dnsValidationTarget isApex
        issued { nodes { type expiresAt } }
      }
      certificates { nodes { id hostname clientStatus configured } }
    }
  }`, { app: TARGET, hostname: HOSTNAME });
log("cert status:", JSON.stringify(status.json));

// 6. deleteCertificate
const del = await flyGraphql(`
  mutation($appId: ID!, $hostname: String!) {
    deleteCertificate(appId: $appId, hostname: $hostname) { certificate { id hostname } }
  }`, { appId: TARGET, hostname: HOSTNAME });
log(`deleteCertificate: [${del.ms}ms]`, JSON.stringify(del.json));

// 7. Release public IPs (keep flycast private_v6!)
const nodes = ips.json.data.app.ipAddresses.nodes;
for (const ip of nodes) {
  if (ip.type === "private_v6") continue;
  const r = await flyGraphql(`
    mutation($input: ReleaseIPAddressInput!) { releaseIpAddress(input: $input) { app { name } } }`,
    { input: { appId: TARGET, ipAddressId: ip.id } });
  log(`release ${ip.type} ${ip.address}:`, JSON.stringify(r.json));
}
// Shared v4 doesn't appear in ipAddresses; try releasing by ip string
const shared = ips.json.data.app.sharedIpAddress;
if (shared) {
  const r = await flyGraphql(`
    mutation($input: ReleaseIPAddressInput!) { releaseIpAddress(input: $input) { app { name sharedIpAddress } } }`,
    { input: { appId: TARGET, ip: shared } });
  log(`release shared_v4 ${shared}:`, JSON.stringify(r.json));
}
log("DONE");
