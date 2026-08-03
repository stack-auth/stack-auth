import { createHash } from "node:crypto";
import type { ServiceSpec } from "./types.js";

// The revision identifies a desired state: config + source + env, canonically serialized.
// Region/machine size are runtime policy and deliberately excluded, so a policy change
// never triggers a rebuild/redeploy on its own. Env is hashed in its ORIGINAL EnvValue
// form ({ref} unresolved) — a ref whose target output changes does not change the
// revision; the backend re-applies and the machines converge under the same revision.
export function computeRevision(spec: ServiceSpec): string {
  const canonical = {
    config: {
      min_instances: spec.config.min_instances,
      max_instances: spec.config.max_instances,
      port: spec.config.port,
    },
    source: spec.source,
    env: Object.fromEntries(Object.entries(spec.env).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)),
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex").slice(0, 12);
}
