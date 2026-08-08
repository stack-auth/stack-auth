import { createHmac } from "node:crypto";
import { getConfig } from "./config.js";
import { serviceRevisionKey } from "./spec-crypto.js";
import type { ServiceSpec } from "./types.js";

// The revision identifies a desired state: config + source + env, canonically serialized.
// Region/machine size are runtime policy and deliberately excluded, so a policy change
// never triggers a rebuild/redeploy on its own. Env is hashed in its ORIGINAL EnvValue
// form ({ref} unresolved) — a ref whose target output changes does not change the
// revision; the backend re-applies and the machines converge under the same revision.
export function computeRevision(spec: ServiceSpec, rootKey: Buffer = getConfig().dataEncryptionRootKey): string {
  const canonical = {
    config: {
      visibility: spec.config.visibility,
      transport: spec.config.transport,
      min_instances: spec.config.min_instances,
      max_instances: spec.config.max_instances,
      port: spec.config.port,
      // It MUST be included: without it a volume-only change —
      // adding, resizing, or removing a disk — produces the same revision, so applyServiceSpec
      // takes the unchanged path, keeps the PREVIOUS spec, and silently drops the change.
      ...(spec.config.volume !== undefined ? { volume: spec.config.volume } : {}),
    },
    source: spec.source,
    env: Object.fromEntries(Object.entries(spec.env).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)),
  };
  // A plain digest turns the stored revision into an offline oracle for low-entropy secret
  // values when the rest of the spec is known. The purpose-derived HMAC key keeps revisions
  // deterministic for reconciliation without disclosing such a verifier in the bucket or DB.
  return createHmac("sha256", serviceRevisionKey(rootKey)).update(JSON.stringify(canonical)).digest("hex").slice(0, 12);
}
