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
  | { ref: string }; // "<service_key>.<output_key>"

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

export type ContainerConfig = {
  type: ServiceKind,
  // Public allocates Fly ingress and guarantees a built-in fly.dev URL.
  visibility: "public" | "private",
  // TCP is private-only and exposes a raw Flycast port. HTTP receives the
  // existing HTTP/TLS handlers and may be public or private.
  transport: "http" | "tcp",
  min_instances: number,
  max_instances: number, // >= min_instances; v1 cap: 5. Always 0/1 for "server".
  // The single port the container listens on. Readiness = port accepts connections.
  port: number,
  // Absent = the container filesystem is entirely ephemeral. Keyed by VOLUME ID, which
  // names the Fly volume (see flyVolumeName): the id, not the service, identifies the
  // disk, so the same id under a different service moves the mount there. At most one
  // entry — a Fly machine mounts at most one volume.
  persistent_volumes?: Record<string, VolumeConfig>,
};

export type ServiceSpec = {
  config: ContainerConfig,
  // { upload_id } is the INPUT form; the stored spec is rewritten to { image } on build success.
  // dockerfile_path (tarball-root-relative) selects the Dockerfile to build from; absent =
  // the builder auto-detects the build with Railpack (https://railpack.com).
  source: { upload_id: string, dockerfile_path?: string } | { image: string },
  env: Record<string, EnvValue>,
  // No `domains` field — hostnames attach via the domain routes.
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
  // internal_host, internal_url — known at creation, always present. url — null until a domain verifies.
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

export type BuildStatus = "queued" | "running" | "succeeded" | "failed" | "canceled";

export type Build = {
  id: string, // ULID (time-ordered)
  revision: string,
  status: BuildStatus,
  has_logs: boolean, // false for no-artifact revisions (rescale, env edit, { image } deploy)
  error: string | null,
  started_at_millis: number,
  finished_at_millis: number | null,
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

export type StoredBuild = Build & {
  ns: string,
  key: string,
  // Set for real Fly builds so live logs can be proxied from the builder machine and the
  // lazy backstop can detect a dead builder. Null for mock/no-artifact builds.
  builder_app: string | null,
  builder_machine_id: string | null,
  // The pushed image ref (registry.fly.io/<app>@sha256:...) once succeeded.
  image: string | null,
  // The consumed upload slot, so the object can be deleted once the build succeeds
  // (the bucket lifecycle rule on uploads/ is the backstop). Null for no-artifact builds.
  upload_id: string | null,
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
