// The Hexclave Runtime API types, verbatim from the contract. Marshal implements the
// runtime side; apps/backend is the only caller. Everything is snake_case because these
// are wire shapes.

// Opaque discriminator; a future type is a runtime-only change. v1 has "server" and
// "serverless" (see ContainerConfig.type).
export type ServiceType = string;

// Caller-resolved value, or a ref the runtime resolves locally. Refs carry no namespace —
// cross-tenant references are unrepresentable. A ref to a not-yet-provisioned output (only
// a private service's domain-dependent `url` can be missing) makes the service `blocked`;
// the backend re-applies when the blocking output appears.
export type EnvValue =
  | { value: string }
  // "<service_key>.<output_key>", with an optional ":<port>" on `url`.
  | { ref: string };

// A persistent disk mounted into the container. Fly volumes are a slice of local NVMe on
// ONE host: a volume attaches to at most one machine and a machine mounts at most one
// volume, so only a "server" (single-instance by construction) can hold one — enforced in
// validateServiceSpec. size_gb is grow-only; Fly rejects a shrink.
export type VolumeConfig = {
  path: string, // absolute, normalized mount point inside the container
  size_gb: number,
};

// "server"     → one instance, autostop "suspend": it resumes with memory intact and is
//                the only type that may mount a volume.
// "serverless" → scales between bounds, autostop "stop": every start is cold, no volume.
export type ServiceKind = "server" | "serverless";

// How one port the container listens on is exposed. Each becomes its own entry
// in the machine's Fly `services` array.
//
// There is deliberately no per-port `public`: Fly's listener set is per-APP, not
// per-address, so every declared port answers on every address the app holds.
// Visibility is therefore a property of the whole container (see
// ContainerConfig.public) and a per-port flag could only ever lie about it.
//
// A "tcp" port is raw, and only a PRIVATE service may declare one: a shared
// public IPv4 tells apps apart by SNI or Host, and raw TCP carries neither.
export type PortConfig = {
  protocol: "http" | "tcp",
};

// The ports a service listens on, KEYED BY PORT NUMBER (as a decimal string —
// JSON has no numeric keys). The same shape the deploy file writes, kept
// unchanged through the backend so nothing translates between two spellings of
// one thing, and so a duplicate port is impossible by construction.
export type PortsConfig = Record<string, PortConfig>;

// One declared port with its number parsed out, for the many places that have to
// compare, count or iterate ports. Ascending by number, so every caller sees the
// same order (key order would put "80" after "8080" for one caller and not
// another).
export type PortEntry = { port: number, protocol: "http" | "tcp" };

export function portEntries(ports: PortsConfig): PortEntry[] {
  const entries: PortEntry[] = [];
  for (const [portKey, config] of Object.entries(ports)) {
    if (!/^[0-9]{1,5}$/.test(portKey)) continue;
    const port = Number(portKey);
    if (port < 1 || port > 65535) continue;
    entries.push({ port, protocol: config.protocol === "tcp" ? "tcp" : "http" });
  }
  return entries.sort((a, b) => a.port - b.port);
}

export type ContainerConfig = {
  type: ServiceKind,
  min_instances: number,
  max_instances: number, // >= min_instances; v1 cap: 10. Always 0/1 for "server".
  // Whether the service takes public ingress. The whole container, not one port:
  // the Fly proxy serves every declared port on every address the app holds, so
  // there is no such thing as a public port with a private sibling.
  //
  // A public service must be all-HTTP and must declare at least one port; both
  // are enforced in validateServiceSpec.
  public: boolean,
  // May be empty (a worker that only dials out; then `public` must be false).
  // Readiness = a declared port accepts connections.
  ports: PortsConfig,
  // Absent = the container filesystem is entirely ephemeral. Keyed by VOLUME ID, which
  // names the Fly volume (see flyVolumeName): the id, not the service, identifies the
  // disk, so the same id under a different service moves the mount there. At most one
  // entry — a Fly machine mounts at most one volume.
  persistent_volumes?: Record<string, VolumeConfig>,
};

export type ServiceSpec = {
  config: ContainerConfig,
  // Always an already-built image. Images are produced by a DEPLOYMENT, which
  // builds every service of a deployment source from one uploaded tree in one
  // builder machine (see startSourceDeployment); the applies follow the build.
  source: { image: string },
  env: Record<string, EnvValue>,
  // No `domains` field — hostnames attach via the domain routes.
};

// ---------------------------------------------------------------------------
// Deployments: one `hexclave deploy` of one deployment source.

// What to build for one service, and what to run once its image exists.
export type DeploymentTarget = {
  service_key: string,
  // Where the service's code lives inside the uploaded tree. The build CONTEXT
  // is the whole upload (a monorepo service usually has to reach shared code
  // above its own directory); this only scopes where detection starts.
  root_directory?: string,
  // Relative to the ROOT of the upload; absent = the builder auto-detects the
  // build with Railpack (https://railpack.com).
  dockerfile_path?: string,
  // The spec to apply once the image exists; its `source` is filled in with what
  // the build produced.
  spec: Omit<ServiceSpec, "source">,
};

export type DeploymentStatus = "queued" | "building" | "deploying" | "succeeded" | "failed" | "canceled";

// "skipped" = the deployment stopped before reaching it (the build failed, or an
// earlier level did).
export type DeploymentServiceStatus = "pending" | "building" | "deploying" | "deployed" | "failed" | "skipped";

export type DeploymentServiceState = {
  service_key: string,
  status: DeploymentServiceStatus,
  revision: string | null,
  url: string | null,
  error: string | null,
};

export type Deployment = {
  id: string, // ULID (time-ordered)
  source_id: string,
  status: DeploymentStatus,
  has_logs: boolean,
  error: string | null,
  started_at_millis: number,
  finished_at_millis: number | null,
  services: DeploymentServiceState[],
};

export type DnsRecord = { type: string, name: string, value: string };

export type ServiceDomainState = {
  hostname: string,
  verified: boolean,
  dns_records: DnsRecord[],
  error: string | null,
};

export type ServiceStatus =
  | "pending" | "blocked" | "building" | "deploying" | "running"
  | "idle" | "degraded" | "failed" | "stopped";

export type ServiceState = {
  key: string,
  type: ServiceType,
  status: ServiceStatus,
  instances: number, // currently running; 0 while idle; serverful is 0 or 1
  revision: string | null, // currently running
  target_revision: string | null, // converging toward, when different
  // `hostname` — a pure function of the service identity, so always present.
  // `url` — the public URL, null until the service is up (or a domain verifies).
  outputs: Record<string, string | null>,
  domains: ServiceDomainState[],
  error: string | null,
  observed_at_millis: number,
};

export type LogLine = {
  at_millis: number,
  stream: "stdout" | "stderr" | "system",
  instance: string | null, // null for build logs and platform "system" events
  text: string,
};

// ---------------------------------------------------------------------------
// Bucket-stored shapes (internal to Marshal, never returned verbatim)

export type StoredSpec = {
  ns: string,
  key: string,
  // env keeps the original EnvValue forms ({ref} vs {value}); source is rewritten from
  // { upload_id } to { image } on build success so re-applies don't rebuild.
  spec: ServiceSpec,
  revision: string,
  created_at_millis: number,
  updated_at_millis: number,
  // Last machine-apply failure, surfaced as ServiceState.error until a later apply succeeds.
  last_apply_error: string | null,
};

export type StoredDeployment = Omit<Deployment, "services"> & {
  ns: string,
  // Dependency levels of service keys: everything in one level is applied
  // concurrently, and a level starts only once the previous one has converged.
  order: string[][],
  targets: DeploymentTarget[],
  // Per-target state, keyed by service key.
  services: Record<string, DeploymentServiceState>,
  // The image each target's build pushed, keyed by service key; filled in by the
  // build-completion webhook.
  images: Record<string, string>,
  // Set for real Fly builds so live logs can be proxied from the builder machine and the
  // lazy backstop can detect a dead builder. Null for mock builds.
  builder_app: string | null,
  builder_machine_id: string | null,
  // The upload the build consumed, kept for diagnostics; the bytes themselves are
  // copied to a deployment-specific object and the original is deleted once the
  // build owns its copy.
  upload_id: string,
};

export type ReconciliationLease = {
  owner_id: string,
  expires_at_millis: number,
};

// Global hostname-uniqueness registry entry (smoke test showed Fly does NOT enforce
// cross-app hostname uniqueness, so Marshal owns it). Claimed with a conditional PUT.
export type DomainClaim = {
  hostname: string,
  ns: string,
  service_key: string,
  claimed_at_millis: number,
};
