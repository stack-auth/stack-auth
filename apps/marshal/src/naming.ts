import { createHash } from "node:crypto";

// Fly app names are global across ALL of Fly (not per-org), ≤30 chars for reliable cert
// issuance, lowercase alnum + hyphen. The env char + truncated ns/key keep names readable;
// the 6-hex hash over the full (env, ns, key) triple is what actually prevents collisions
// after truncation/sanitization.

function sanitize(value: string, maxLength: number): string {
  const cleaned = value.toLowerCase().replace(/[^a-z0-9]/g, "");
  return (cleaned || "x").slice(0, maxLength);
}

function hashHex(parts: string[], length: number): string {
  return createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, length);
}

// hxc-<env1>-<ns8>-<key8>-<hash6> — at most 4+2+9+9+6 = 30 chars.
export function appNameForService(envId: string, ns: string, key: string): string {
  return `hxc-${sanitize(envId, 1)}-${sanitize(ns, 8)}-${sanitize(key, 8)}-${hashHex([envId, ns, key], 6)}`;
}

// One custom 6PN network per namespace: cross-tenant traffic is unroutable (smoke-verified:
// .flycast/.internal are NXDOMAIN from another network).
export function networkForNamespace(envId: string, ns: string): string {
  return `hxcn-${sanitize(envId, 1)}-${hashHex([envId, ns], 12)}`;
}

// The builder app is per environment, on its own network (it never needs to reach tenant
// apps — only R2, the registry, and Marshal's public webhook).
export function builderAppName(envId: string): string {
  return `hxc-${sanitize(envId, 8)}-builder`;
}

export function builderNetworkName(envId: string): string {
  return `hxcn-${sanitize(envId, 8)}-builder`;
}

export function internalHostForService(envId: string, ns: string, key: string): string {
  return `${appNameForService(envId, ns, key)}.flycast`;
}
