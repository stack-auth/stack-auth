// Shared shapes for the Deployments app. Service definitions used to live in
// the branch config (`deployments-alpha.services`); they now live in the
// backend database and are synced from the `services` export of
// hexclave.deploy.ts by `hexclave deploy`. This module is the single source of
// truth for the definition shape so the CLI (which evaluates the deploy file),
// the backend (which stores and deploys definitions), and the SDK (which reads
// them) cannot drift.
//
// Everything here is snake_case: these types are simultaneously the API wire
// shape and the backend's stored JSON shape, and keeping them identical avoids
// a translation layer that would have to be maintained in three places.

import * as yup from "yup";
import { MAX_PROJECT_SECRET_KEY_LENGTH, PROJECT_SECRET_KEY_REGEX } from "./project-secrets";
import { yupArray, yupBoolean, yupNumber, yupObject, yupRecord, yupString } from "./schema-fields";

export const DEPLOYMENT_ENV_VAR_KEY_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;

// A DEPLOYMENT SOURCE is the unit a deploy ships: one deploy file, one source,
// one upload, one build. Its id comes from the deploy file's own `id` export,
// which is what lets one project be deployed from several repositories — each
// with a deploy file of its own, each deploying on its own schedule.
//
// Service ids stay unique per PROJECT rather than per source, so a reference
// never has to name a source: two sources declaring the same service id is a
// conflict, refused at sync.
//
// Dots are allowed because deployments declared in hexclave.config.ts belong to
// a source whose id IS the file name (see CONFIG_FILE_DEPLOYMENT_SOURCE_ID) —
// they appear in no reference, so nothing has to parse them.
export const DEPLOYMENT_SOURCE_ID_REGEX = /^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/;
export const MAX_DEPLOYMENT_SOURCE_ID_LENGTH = 63;
// The source id of deployments declared in hexclave.config.ts, which has no `id`
// export of its own. Named after the file so the dashboard can show where those
// services came from without a special case.
export const CONFIG_FILE_DEPLOYMENT_SOURCE_ID = "hexclave.config.ts";

// A connection value is `<serviceId>.<outputKey>` — a typed pointer to another
// service's output — or `hexclave.<outputKey>` for the managed service. The
// backend resolves it at deploy time. This is deliberately its own env var TYPE
// rather than a `{serviceId.outputKey}` interpolation syntax inside plain
// values: with interpolation, a literal value that happens to contain `{...}`
// would be misinterpreted as a reference, so plain values must stay entirely
// literal.
//
// The optional `:<port>` suffix belongs to `url`, which names the port it wants:
// `api.url:9090`. It is part of the reference rather than a separate field
// because references are single opaque strings everywhere they travel — deploy
// file, stored definition, and the runtime's own env refs.
export const DEPLOYMENT_CONNECTION_VALUE_REGEX = /^[a-zA-Z0-9_][a-zA-Z0-9_-]*\.[A-Za-z0-9_]+(?::[0-9]{1,5})?$/;

/**
 * The managed Hexclave service's slot on the deployments board. A service in
 * the config's `services` export must never shadow it — `service("hexclave")`
 * doesn't exist (the `hexclave` context object replaces it), but the id stays
 * reserved so connection values like "hexclave.projectId" are unambiguous.
 */
export const HEXCLAVE_SERVICE_ID = "hexclave";

// The outputs each service kind exposes. The backend's resolvers and the CLI's
// `service()` / `hexclave` context objects must both stay in sync with these.
// Note there is deliberately no `previewUrl` output: nothing in the current
// flow can create a preview deployment (`hexclave deploy` always targets
// production), so exposing it would be a documented dead end — every deploy
// referencing it would fail with "no successful preview deployment yet".
export const HEXCLAVE_OUTPUT_KEYS = ["projectId", "apiUrl", "jwksUrl", "publishableClientKey", "secretServerKey"] as const;
//
// `url` is a CALL, because a URL names exactly one port: `url()` when a single
// HTTP port makes it unambiguous, `url(9090)` to pick one when the service
// declares several. It resolves to the service's PUBLIC url when that port is
// public (the platform URL, or a verified custom domain) and to its private
// address otherwise, with the scheme taken from the port's protocol.
//
// `hostname` is the service's private DNS name, which resolves to the stable
// private IPv6 address of its app. Pair it with a literal port number for a raw
// TCP client. There is deliberately no port output — its value is a number the
// author already wrote in the target's `ports`, so a plain `"5433"` says the
// same thing without a second way to spell it.
export const SERVICE_OUTPUT_KEYS = ["url", "hostname"] as const;

/**
 * Splits a connection reference into its parts. One parser so the CLI, the
 * backend and the runtime cannot disagree about what `api.url:9090`
 * means. Returns null when the value is not a reference at all.
 */
export function parseConnectionValue(value: string): { serviceId: string, outputKey: string, port: number | null } | null {
  if (!DEPLOYMENT_CONNECTION_VALUE_REGEX.test(value)) return null;
  const colonIndex = value.lastIndexOf(":");
  const port = colonIndex === -1 ? null : Number(value.slice(colonIndex + 1));
  const withoutPort = colonIndex === -1 ? value : value.slice(0, colonIndex);
  // The regex allows a dot on neither side of the separator, so this is unambiguous.
  const dotIndex = withoutPort.indexOf(".");
  return {
    serviceId: withoutPort.slice(0, dotIndex),
    outputKey: withoutPort.slice(dotIndex + 1),
    port,
  };
}

/**
 * Whether a reference actually requires its target to have DEPLOYED.
 *
 * `hostname()` never does: it is a pure function of the service identity and
 * resolves before the target exists. `url()` depends on the TARGET SERVICE:
 *
 *  - a PUBLIC service's URL is the platform URL (or a verified custom domain),
 *    which only exists once the service has been provisioned;
 *  - a PRIVATE service's URL is built from the deterministic hostname and the
 *    port written in the reference, so it resolves just as early as hostname();
 *  - a bare `url()` has to read the target's synced definition to learn its sole
 *    HTTP port, so it waits regardless.
 *
 * `targetIsPublic` is null when the caller cannot answer — a reference into a
 * source this deploy file does not contain, or one naming a port the target does
 * not declare — in which case the conservative answer is that it waits. Getting
 * this wrong in the other direction would serialize independent deploys, cascade
 * false "skipped" results when the target fails, and reject mutually-wired
 * services as circular.
 */
export function connectionRequiresTargetDeployed(outputKey: string, port: number | null, targetIsPublic: boolean | null = null): boolean {
  if (outputKey !== "url") return false;
  if (port === null) return true;
  return targetIsPublic !== false;
}

/** Formats a connection reference. The inverse of parseConnectionValue. */
export function formatConnectionValue(serviceId: string, outputKey: string, port: number | null = null): string {
  return port === null ? `${serviceId}.${outputKey}` : `${serviceId}.${outputKey}:${port}`;
}

export type HexclaveOutputKey = typeof HEXCLAVE_OUTPUT_KEYS[number];
export type ServiceOutputKey = typeof SERVICE_OUTPUT_KEYS[number];

// One env var, discriminated by `type`:
// - absent (plain): a literal `value`.
// - "secret": only the secret's name (`key`) is in the definition; the actual
//   value lives in the project's secret store (see ./project-secrets), set in
//   the dashboard under Project Settings → Secrets and read server-side at
//   deploy time. A secret with no stored value fails the deploy
//   unless the deploy request supplies a default for it (see
//   deploymentSecretDefaultsSchema).
// - "connection": `value` names another service's output (see the regex
//   comment above); resolved server-side at deploy time.
export type DeploymentEnvVarDefinition = {
  type?: "secret" | "connection" | undefined,
  value?: string | undefined,
  key?: string | undefined,
};

export type DeploymentServiceDefinition = {
  // How the service is run on the Fly-backed Marshal runtime.
  //
  // - "server": exactly one instance (max_instances is always 1). With
  //   min_instances 0 it SUSPENDS when idle rather than stopping, so it resumes
  //   with its memory intact and without a cold start; with min_instances 1
  //   (the default) it simply stays up. It is the only type allowed to hold a
  //   persistent volume — a volume is local disk on one host, which only a
  //   single instance can ever mount.
  // - "serverless": scales between min_instances and max_instances and STOPS
  //   (not suspends) on scale-down, so every start is a cold start from a clean
  //   rootfs. Persistent volumes are rejected: a fleet would give each instance
  //   its own unreplicated disk rather than shared storage.
  //
  // The field is required so every write path states what it is creating.
  type: DeploymentServiceType,
  // Whether the service is reachable from the internet. Default false: a service
  // is private unless it says otherwise, and private services reach each other
  // over the project's internal network.
  //
  // Public is a property of the SERVICE and not of one port, because the runtime
  // cannot make it anything else. Fly's proxy listener set is per-app rather than
  // per-address, so every declared port answers on every address the app holds:
  // the moment one port is public they all are. A per-port flag could express
  // "public 3000, private 5432" but the runtime would publish both, so the flag
  // lives where the truth does. (An earlier revision of this branch had the flag
  // on the port and a rule forbidding the mixture; this is the same rule made
  // unrepresentable instead of enforced.)
  //
  // A public service must therefore be all-HTTP: raw TCP cannot be public,
  // because Fly's shared IPv4 tells apps apart by SNI (or Host) and a raw TCP
  // stream carries neither — the edge accepts the connection and then drops it.
  // Lifting that needs a dedicated IPv4 per service, which is a billing decision.
  // VERIFIED against real Fly; see the `public-service-is-all-http` rule below.
  public?: boolean | undefined,
  // The ports the container listens on.
  //
  // May be EMPTY, for a worker that only makes outbound connections. Such a
  // service has no URL of any kind and can hold no custom domain, and it only
  // ever runs if it is always-on (see the schema's note on autostart). A worker
  // may not be `public`: there would be nothing to serve on the ingress it
  // allocates.
  //
  // Each port is reachable at its own number, and the service's standard-ports
  // holder is additionally served on 80/443 so `url` and custom domain
  // certificates work on the standard ports.
  ports: DeploymentPorts,
  // Scaling bounds. On a "serverless" the instance count moves between them and
  // min 0 scales to zero; defaults are min 0, max 1. A "server" holds exactly
  // one instance, so max_instances may only ever be 1 and min_instances is the
  // suspend switch: 1 (the default) stays up, 0 suspends when idle.
  min_instances?: number | undefined,
  max_instances?: number | undefined,
  // Relative to the directory containing hexclave.deploy.ts. Only used
  // client-side (it decides what `hexclave deploy` packages), but stored so
  // the dashboard can display it.
  root_directory?: string | undefined,
  // The Dockerfile to build from, relative to root_directory. When absent the
  // service is NOT built from a Dockerfile — the remote builder auto-detects
  // the build with Railpack (https://railpack.com) instead.
  dockerfile_path?: string | undefined,
  // Persistent disks mounted into the container, keyed by VOLUME ID. Absent or
  // empty = the container filesystem is entirely ephemeral (the default).
  // Only "server" services may declare one.
  //
  // The key names the underlying Fly volume, which lives inside the service's
  // own Fly app. It therefore identifies the disk WITHIN a service: moving an id
  // to another service (or renaming the service) hands the new one a fresh empty
  // disk and strands the old one, detached and still billed. Two services may
  // never hold one id at a time. See MAX_PERSISTENT_VOLUMES_PER_SERVICE for the
  // current one-per-service cap.
  persistent_volumes?: Record<string, DeploymentVolumeDefinition> | undefined,
  env: Record<string, DeploymentEnvVarDefinition>,
};

// How one port the container listens on is exposed.
//
// There is deliberately no `public` here — it is a property of the SERVICE (see
// DeploymentServiceDefinition.public for why the runtime leaves no other
// option). A service's ports are all reachable or none of them are.
//
// `protocol` picks the protocol handler explicitly. A "tcp" port is raw: it may
// only appear on a PRIVATE service, reached over the internal network with
// hostname() and its port number.
export type DeploymentPortDefinition = {
  protocol: "http" | "tcp",
};

// The ports a service listens on, keyed by port NUMBER — the same shape the
// author writes in the deploy file (`ports: { 3000: { protocol: "http" } }`), kept
// all the way through the wire and the database so nothing has to translate
// between two spellings of one thing. Keys are decimal port numbers; JSON has no
// numeric object keys, so they are strings here and parsed at the few points
// that need arithmetic (see deploymentPortEntries).
export type DeploymentPorts = Record<string, DeploymentPortDefinition>;

// `path` is where the disk is mounted inside the container; `size_gb` is the
// provisioned size, which can be grown on a later deploy but never shrunk.
export type DeploymentVolumeDefinition = {
  path: string,
  size_gb: number,
};

export type DeploymentServiceType = "server" | "serverless";
export const DEPLOYMENT_SERVICE_TYPES = ["server", "serverless"] as const;

/** A port's explicitly configured protocol. */
export function portProtocol(port: DeploymentPortDefinition): "http" | "tcp" {
  return port.protocol;
}

/** One declared port, with the record's key parsed. */
export type DeploymentPortEntry = {
  port: number,
  protocol: "http" | "tcp",
};

/**
 * The ports as a list, ascending by port number. Every
 * consumer that has to compare, count or iterate ports goes through this, so the
 * key parsing happens in exactly one place — and so the order is
 * the same everywhere (object key order would otherwise put "80" after "8080"
 * for one caller and not another).
 *
 * Keys that are not port numbers are dropped rather than thrown on: this runs on
 * stored rows, and a hand-edited one must not take down a listing. Every write
 * path validates the shape.
 */
export function deploymentPortEntries(ports: DeploymentPorts): DeploymentPortEntry[] {
  const entries: DeploymentPortEntry[] = [];
  for (const [portKey, definition] of Object.entries(ports)) {
    if (!DEPLOYMENT_PORT_KEY_REGEX.test(portKey)) continue;
    const port = Number(portKey);
    if (port < 1 || port > 65535) continue;
    entries.push({ port, protocol: portProtocol(definition) });
  }
  return entries.sort((a, b) => a.port - b.port);
}

// A port key in its ONE canonical spelling: decimal, no leading zero.
//
// Leading zeros are what make a "duplicate port" possible in a record keyed by
// port: "80" and "080" are different object keys but the same port, so both
// survive as entries and the runtime emits two identical external listeners for
// them. Rejecting the non-canonical spelling makes that impossible by
// construction rather than by a cross-entry duplicate check — the same reason
// the ports are a record and not an array.
//
// KEPT IN SYNC WITH the key check in apps/marshal/src/services.ts and the
// `hexclave_deployment_ports_entries_valid` CHECK function in the deployments
// migration. Five digits max is the width of 65535; the range is checked
// separately so an out-of-range port reports as a range error, not a shape one.
export const DEPLOYMENT_PORT_KEY_REGEX = /^[1-9][0-9]{0,4}$/;

/**
 * The port number that additionally answers on the standard 80/443, or null when
 * the service has no single obvious one.
 *
 * For a PUBLIC service it is the LOWEST-numbered HTTP port. Lowest rather than
 * first-encountered: deploymentPortEntries sorts numerically, so the holder is a
 * property of the port set and not of JSON key ordering. That determinism is the
 * whole point — the holder is the port the service's bare URL names and the only
 * one a custom domain can front, so an arbitrary pick would silently move both.
 *
 * For a PRIVATE service it is the sole HTTP port, because a private service gets
 * public IPs the moment a custom domain is attached and that domain terminates
 * TLS on 443. Null when there are several, which is what makes such a service
 * ineligible to hold a domain at all.
 *
 * KEPT IN SYNC WITH standardPortsHolderFor in apps/marshal/src/services.ts.
 */
export function standardPortsHolderPort(ports: DeploymentPorts, isPublic: boolean): number | null {
  if (!isPublic) return soleHttpDeploymentPort(ports);
  // Filtered to HTTP defensively: a public service may declare no TCP port, so
  // on any valid definition this is simply the lowest port.
  const httpPorts = deploymentPortEntries(ports).filter((entry) => entry.protocol === "http");
  return httpPorts.length === 0 ? null : httpPorts[0].port;
}

/**
 * Whether this port is the one that owns the service's standard 80/443, and so
 * the one whose URL carries no `:port` suffix.
 *
 * VERIFIED AGAINST REAL FLY: every other port of a public service is reachable
 * on its own number over BOTH IPv4 and IPv6 — a shared IPv4 forwards any port,
 * so long as the traffic carries SNI or a Host header for the proxy to route on.
 * The difference between the holder and the rest is the URL shape and which port
 * a custom domain can front, NOT reachability.
 */
export function deploymentPortOwnsStandardPorts(ports: DeploymentPorts, isPublic: boolean, port: number): boolean {
  return standardPortsHolderPort(ports, isPublic) === port;
}

/**
 * Declared ports that collide with the external listeners the standard-ports
 * holder reserves, as a sorted list (empty when there is no conflict).
 *
 * The holder does not only answer on its own number — it also claims external 80
 * and 443, which is what makes the platform URL and any custom domain
 * certificate work. Those are listeners on the WHOLE app: the runtime emits one
 * entry per declared port, so a *different* port that is itself numbered 80 or
 * 443 asks for an external listener the holder has already taken. Two entries
 * claiming one external port is a config the runtime cannot serve — it is
 * rejected outright, or routes one of them somewhere the author did not ask for.
 *
 * The cheap example is a public service with
 * `{ 80: { protocol: "http" }, 443: { protocol: "http" } }`: 80 is the
 * holder, claims 80 and 443, and the declared 443 claims 443 again. This is
 * refused rather than resolved by precedence, because every way of resolving it
 * silently drops or retargets a port the author explicitly declared.
 */
export function reservedStandardPortConflicts(ports: DeploymentPorts, isPublic: boolean): number[] {
  const holder = standardPortsHolderPort(ports, isPublic);
  if (holder === null) return [];
  return deploymentPortEntries(ports)
    .filter((entry) => entry.port !== holder && (entry.port === 80 || entry.port === 443))
    .map((entry) => entry.port);
}

/**
 * The port a bare `url()` refers to, or null when the service leaves it
 * ambiguous (several HTTP ports) or impossible (none). Callers phrase their own
 * error — the CLI wants a config-file diagnostic, the backend an HTTP status —
 * which is why this returns null rather than throwing.
 */
export function soleHttpDeploymentPort(ports: DeploymentPorts): number | null {
  const httpPorts = deploymentPortEntries(ports).filter((entry) => entry.protocol === "http");
  return httpPorts.length === 1 ? httpPorts[0].port : null;
}

/** One port's definition, or null when the service does not declare it. */
export function deploymentPortEntry(ports: DeploymentPorts, port: number): DeploymentPortEntry | null {
  return deploymentPortEntries(ports).find((entry) => entry.port === port) ?? null;
}

// Each declared port becomes its own entry in the Fly machine's `services`
// array. The cap is a bound on the spec rather than a platform limit — a
// container listening on more than this is far likelier to be a config mistake
// than a real fleet, and an unbounded record would be sent to Fly verbatim.
export const MAX_PORTS_PER_SERVICE = 10;

// The most instances one service may scale to. A bound on the spec rather than
// a platform limit: a fleet larger than this is far likelier to be a typo (or a
// misunderstanding of what a Hexclave service is for) than a real intent, and
// each instance is a machine somebody pays for. Both bounds share it — a floor
// above the ceiling could never be satisfied.
export const MAX_INSTANCES_PER_SERVICE = 10;

export const MIN_VOLUME_SIZE_GB = 1;
export const MAX_VOLUME_SIZE_GB = 500;

// A Fly machine mounts at most one volume ("Currently, you may only mount one
// volume per Machine" — Machines API reference), so a second entry could not be
// honoured by the runtime. `persistent_volumes` is a record rather than a
// single object anyway: the shape is what makes the volume ID a first-class
// key, and the cap can lift without a breaking config change if Fly ever allows
// more than one mount.
export const MAX_PERSISTENT_VOLUMES_PER_SERVICE = 1;

// Volume ids become Fly volume names (see appVolumeName in Marshal), which are
// alphanumeric + underscore and at most 30 characters. The id is capped at 26
// so a 4-character prefix still fits, and lowercased so two ids cannot differ
// only by case and then collide once Fly normalizes them.
export const DEPLOYMENT_VOLUME_ID_REGEX = /^[a-z][a-z0-9_]*$/;
export const MAX_VOLUME_ID_LENGTH = 26;

export const deploymentEnvVarSchema = yupObject({
  type: yupString().oneOf(["secret", "connection"]).optional(),
  value: yupString().when("type", ([type], schema) => {
    switch (type) {
      case "secret": {
        return schema.oneOf([undefined], 'deployment env vars with type "secret" must not have a value — set the value in the dashboard under Project Settings → Secrets, or give the secret a default value');
      }
      case "connection": {
        return schema.defined().matches(DEPLOYMENT_CONNECTION_VALUE_REGEX, 'deployment env vars with type "connection" must reference a service output like "hexclave.projectId"');
      }
      default: {
        return schema.defined();
      }
    }
  }),
  key: yupString().when("type", ([type], schema) => type === "secret"
    ? schema.defined().max(MAX_PROJECT_SECRET_KEY_LENGTH, "project secret keys may be at most ${max} characters long").matches(PROJECT_SECRET_KEY_REGEX, "project secret keys must contain only letters, numbers, underscores, and hyphens")
    : schema.oneOf([undefined], 'deployment env vars may only have a key when their type is "secret"')),
  // `secret(key, default)` fallbacks are a config-file concept that must never
  // be persisted: they travel with the deploy request instead (see
  // deploymentSecretDefaultsSchema). Rejected rather than ignored — this is
  // the schema every write path validates against, so refusing the field here
  // is what makes "a stored definition cannot contain a default" a checkable
  // property instead of a convention. (A `.strip()` here would be the
  // alternative, but rejecting is the point: the caller should learn that the
  // field is not storable rather than have it silently disappear.)
  default_value: yupString().oneOf([undefined], "deployment env var definitions must not carry a default_value — secret defaults belong to the deploy request, not to the stored definition"),
});

// Fallback values for a service's `secret()` env vars, sent with a DEPLOY
// request and never stored: they are the second argument of `secret(key,
// default)` in the deploy file's `services` export, which is a purely
// author-side convenience. Keyed by ENV VAR key (not secret key) because
// that's where the default is written — the same secret may be referenced by
// two env vars with different defaults, and the dashboard must never learn
// that any of this exists.
export const deploymentSecretDefaultsSchema = yupRecord(
  yupString().matches(DEPLOYMENT_ENV_VAR_KEY_REGEX, "deployment secret default keys must be env var keys"),
  yupString().defined(),
);

export const deploymentServiceDefinitionSchema = yupObject({
  type: yupString().oneOf([...DEPLOYMENT_SERVICE_TYPES]).defined(),
  // Keyed by port NUMBER, exactly as the deploy file writes it. JSON object keys
  // are strings, so the key schema is what enforces "this is a port number" —
  // and duplicates are impossible by construction, which is one rule fewer than
  // the array shape needed.
  // Public is a property of the SERVICE, not of a port: Fly's proxy listener set
  // is per-app rather than per-address, so every declared port answers on every
  // address the app holds. A per-port flag could SAY "public 3000, private 5432"
  // but the runtime would publish both, so the flag lives where the truth does.
  //
  // The two rules below are what that costs: with the flag on the port, "public
  // TCP" and "public worker" were unrepresentable; on the service they have to be
  // refused instead.
  public: yupBoolean().optional()
    // A public service is all-HTTP. Raw TCP cannot be public because Fly's shared
    // IPv4 tells apps apart by SNI (or Host) and a raw TCP stream carries
    // neither — VERIFIED against real Fly, where the edge accepts the connection
    // and then silently drops it. Lifting this needs a dedicated IPv4 per
    // service, which is a billing decision rather than a code change.
    .test("public-service-is-all-http", 'a public service may not declare a "tcp" port: raw TCP carries no SNI or Host header, so a shared public address cannot tell which service a connection is for. Keep the service private and reach it with hostname() and its port number', function (value) {
      if (value !== true) return true;
      const ports = (this.parent as { ports?: DeploymentPorts }).ports;
      return ports === undefined || deploymentPortEntries(ports).every((entry) => entry.protocol === "http");
    })
    // A worker declares no ports, so there is nothing for public ingress to
    // serve. Refused rather than ignored: it allocates addresses for a service
    // that can never answer on them.
    .test("public-service-serves-something", "a public service must declare at least one port — a service with no ports has nothing to serve on the public address it would be given", function (value) {
      if (value !== true) return true;
      const ports = (this.parent as { ports?: DeploymentPorts }).ports;
      return ports === undefined || deploymentPortEntries(ports).length > 0;
    }),
  ports: yupRecord(
    yupString().matches(DEPLOYMENT_PORT_KEY_REGEX, "deployment service port keys must be port numbers written without a leading zero")
      .test("port-in-range", "deployment service ports must be between 1 and 65535", (value) =>
        value === undefined || (Number(value) >= 1 && Number(value) <= 65535)),
    yupObject({
      protocol: yupString().oneOf(["http", "tcp"]).defined(),
    }).defined()
  ).defined()
    // No lower bound: a service may declare zero ports. That is a worker — a
    // queue consumer, a cron, anything that only makes outbound connections —
    // and it runs with an empty Fly `services` array. Nothing downstream needs a
    // port: `url` resolves to null, and a custom domain is
    // already refused on a service with no HTTP port.
    //
    // It is only USEFUL on an always-on service, because autostart/autostop live
    // on `services` entries: with none, the Fly proxy can never wake a stopped
    // machine. A `type: "server"` with minInstances 1 runs; one that suspends,
    // or a "serverless" with `minInstances: 0`, will sit stopped forever. That is
    // left to the author rather than refused — see the note on serverless status
    // in getServiceState.
    //
    // The `value === undefined` guards below are load-bearing despite what the
    // types say: `.defined()` makes yup TYPE the test input as present, but yup
    // still runs every test on a missing value (that is how `.defined()` itself
    // reports), and under `abortEarly: false` these run alongside it.
    .test("ports-within-cap", `a deployment service may declare at most ${MAX_PORTS_PER_SERVICE} ports`, (value) =>
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      value === undefined || Object.keys(value).length <= MAX_PORTS_PER_SERVICE)
    // The standard-ports holder claims external 80 and 443 for the whole app, so
    // no OTHER declared port may be numbered 80 or 443 — it would ask for a
    // listener the holder already took. See reservedStandardPortConflicts.
    .test("standard-ports-are-not-claimed-twice", "80 and 443 belong to the port that owns the service's standard bindings (the lowest port of a public service, or the sole HTTP port of a private one), so no other port may be numbered 80 or 443 — the runtime cannot serve one external port from two of them", function (value) {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      return value === undefined || reservedStandardPortConflicts(value, (this.parent as { public?: boolean }).public === true).length === 0;
    }),
  // min is capped at the same MAX_INSTANCES_PER_SERVICE as max — an unbounded
  // min would only ever fail downstream. On a "server" it is the SUSPEND switch
  // rather than a fleet size:
  // 1 (the default) keeps its single instance up, and 0 lets it suspend when idle and
  // resume with its memory intact on the next connection.
  min_instances: yupNumber().integer().min(0).max(MAX_INSTANCES_PER_SERVICE).optional()
    .test("server-is-single-instance-min", 'a "server" service holds a single instance, so min_instances must be 0 (suspend when idle) or 1 (always on) — use type "serverless" to scale out', function (value) {
      return (this.parent as { type?: string }).type !== "server" || value === undefined || value === 0 || value === 1;
    }),
  max_instances: yupNumber().integer().min(1).max(MAX_INSTANCES_PER_SERVICE).optional()
    // Compare EFFECTIVE bounds, not just when both are present: `min_instances` alone (no
    // max) defaults max to 1 downstream, so `min: 2` with no max is an invalid spec that
    // must be caught here — otherwise Marshal 400s it after the upload is consumed.
    .test("max-gte-min", "max_instances must be greater than or equal to min_instances (max_instances defaults to 1)", function (value) {
      const minInstances = (this.parent as { min_instances?: number }).min_instances ?? 0;
      const effectiveMax = value ?? Math.max(minInstances, 1);
      return effectiveMax >= minInstances;
    })
    .test("server-is-single-instance", 'a "server" service is always a single instance, so max_instances must be 1 (use type "serverless" to scale out)', function (value) {
      return (this.parent as { type?: string }).type !== "server" || value === undefined || value === 1;
    }),
  root_directory: yupString().optional(),
  // Persistent disks, keyed by volume id. The rules here must be AT LEAST as
  // strict as Marshal's validateServiceSpec so nothing reaches the runtime that
  // it would reject after an upload has already been consumed.
  persistent_volumes: yupRecord(
    yupString()
      .matches(DEPLOYMENT_VOLUME_ID_REGEX, "persistent volume ids must start with a lowercase letter and contain only lowercase letters, digits, and underscores")
      .max(MAX_VOLUME_ID_LENGTH),
    yupObject({
      // A normalized ABSOLUTE mount point. Relative paths are ambiguous against
      // the image's WORKDIR, and mounting over "/" would shadow the whole image.
      path: yupString().defined().max(512)
        // `path` is `.defined()`, so unlike the optional `dockerfile_path` above
        // there is no undefined case to let through here.
        .test("absolute-path", 'persistent volume paths must be a normalized absolute path inside the container (e.g. "/data") — no trailing slash, no "." or ".." segments, no backslashes or control characters', (value) =>
          value.startsWith("/")
          && value !== "/"
          && !value.endsWith("/")
          && !value.includes("\\")
          // eslint-disable-next-line no-control-regex
          && !/[\x00-\x1f]/.test(value)
          && value.split("/").slice(1).every((segment) => segment !== "" && segment !== "." && segment !== "..")),
      size_gb: yupNumber().integer().min(MIN_VOLUME_SIZE_GB).max(MAX_VOLUME_SIZE_GB).defined(),
    }).defined(),
  ).optional().default(undefined)
    .test("at-most-one-persistent-volume", `a service may declare at most ${MAX_PERSISTENT_VOLUMES_PER_SERVICE} persistent volume — mounting more than one disk on a single instance is not supported yet`, (value) =>
      value === undefined || Object.keys(value).length <= MAX_PERSISTENT_VOLUMES_PER_SERVICE)
    // Only a "server" is single-instance-by-construction; a serverless fleet
    // would hand each instance its own unreplicated disk.
    .test("volume-requires-server-type", 'only a "server" service may have persistent volumes — a volume is local disk on one host and can only be attached to a single instance', function (value) {
      if (value === undefined || Object.keys(value).length === 0) return true;
      return (this.parent as { type?: string }).type === "server";
    }),
  // Optional Dockerfile location relative to root_directory; absent = Railpack
  // auto-detected build. Must stay inside the packaged source — it flows into
  // the remote builder as a path within the source tarball. The rules here
  // must be AT LEAST as strict as Marshal's validateServiceSpec: anything the
  // runtime would reject must already fail at sync time, not after an upload
  // has been consumed at deploy time.
  dockerfile_path: yupString().optional().max(512)
    .test("relative-path", 'dockerfile_path must be a normalized relative path inside the service\'s root directory (no leading "/", no "." or ".." segments, no backslashes or control characters)', (value) =>
      value === undefined || (
        value !== ""
        && !value.startsWith("/")
        && !value.includes("\\")
        // eslint-disable-next-line no-control-regex
        && !/[\x00-\x1f]/.test(value)
        && value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..")
      )),
  // `devCommand` is a config-file-only field: `hexclave dev --service-id`
  // reads it straight out of the local deploy file, and the backend never acts
  // on it, so it is never sent and never stored. Rejected rather than simply
  // absent because yupRecord re-validates its values in a fresh validation
  // whose path no longer starts with "body" — the route handler's
  // unknown-property check therefore does NOT reach inside `services`, so an
  // omitted field would be silently dropped instead of reported (same reason
  // `default_value` below is spelled out).
  dev_command: yupString().oneOf([undefined], "deployment service definitions must not carry a dev_command — the dev command stays in your deploy file and is never sent to the server (upgrade your Hexclave CLI if this came from `hexclave deploy`)"),
  env: yupRecord(
    yupString().matches(DEPLOYMENT_ENV_VAR_KEY_REGEX, "deployment env var keys must start with a letter or underscore and contain only letters, digits, and underscores"),
    deploymentEnvVarSchema.defined(),
  ).defined(),
});

import.meta.vitest?.test("deploymentServiceDefinitionSchema accepts all env var shapes", async ({ expect }) => {
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "serverless",
    ports: { "3000": { protocol: "http" } },
    min_instances: 0,
    max_instances: 2,
    root_directory: "./",
    dockerfile_path: "docker/Dockerfile.web",
    env: {
      MY_ENV_VAR: { value: "true" },
      DATABASE_CONNECTION_STRING: { type: "secret", key: "db_connection" },
      OPENAI_API_KEY: { type: "secret", key: "OPENAI" },
      NEXT_PUBLIC_HEXCLAVE_PROJECT_ID: { type: "connection", value: "hexclave.projectId" },
      API_INTERNAL_URL: { type: "connection", value: "api.url:8080" },
    },
  }, { abortEarly: false })).resolves.toBeDefined();
});

import.meta.vitest?.test("deploymentServiceDefinitionSchema requires explicit port protocols and defaults a service to private", async ({ expect }) => {
  await expect(deploymentServiceDefinitionSchema.validate({ type: "serverless", ports: { "3000": {} }, env: {} }))
    .rejects.toThrow(/protocol.*defined/);
  await expect(deploymentServiceDefinitionSchema.validate({ type: "serverless", ports: { "3000": { protocol: "http" } }, env: {} }))
    .resolves.toMatchObject({ ports: { "3000": { protocol: "http" } } });
  await expect(deploymentServiceDefinitionSchema.validate({ type: "serverless", public: true, ports: { "3000": { protocol: "http" } }, env: {} }))
    .resolves.toMatchObject({ public: true, ports: { "3000": { protocol: "http" } } });
  // A PRIVATE service may hold several ports of mixed protocols.
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "server", ports: { "8080": { protocol: "http" }, "5432": { protocol: "tcp" }, "9090": { protocol: "http" } }, env: {},
  }, { abortEarly: false })).resolves.toBeDefined();
});

import.meta.vitest?.test("deploymentServiceDefinitionSchema accepts a portless worker", async ({ expect }) => {
  // Nothing listening: a queue consumer or cron that only dials out. Accepted on
  // either type — a "serverless" one that never scales up is the author's call.
  await expect(deploymentServiceDefinitionSchema.validate({ type: "server", ports: {  }, env: {} }, { abortEarly: false }))
    .resolves.toMatchObject({ ports: {  } });
  await expect(deploymentServiceDefinitionSchema.validate({ type: "serverless", ports: {  }, env: {} }, { abortEarly: false }))
    .resolves.toMatchObject({ ports: {  } });
});

import.meta.vitest?.test("deploymentServiceDefinitionSchema accepts a public service with several ports", async ({ expect }) => {
  // Every port of a public service is reachable, so there is no port the author
  // did not ask to publish. Only the lowest additionally owns 80/443.
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "serverless", public: true, ports: { "3000": { protocol: "http" }, "4000": { protocol: "http" } }, env: {},
  }, { abortEarly: false })).resolves.toBeDefined();
});

import.meta.vitest?.test("deploymentServiceDefinitionSchema refuses a non-canonical port key", async ({ expect }) => {
  // "80" and "080" are one port under two keys: the record makes an exact key
  // impossible to repeat, not a numeric alias, so both entries would be stored
  // and the runtime would declare the port twice.
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "serverless", public: true, ports: { "80": { protocol: "http" }, "080": { protocol: "http" } }, env: {},
  }, { abortEarly: false })).rejects.toThrow(/without a leading zero/);
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "server", ports: { "08080": { protocol: "http" } }, env: {},
  }, { abortEarly: false })).rejects.toThrow(/without a leading zero/);
});

import.meta.vitest?.test("deploymentPortEntries drops a non-canonical key rather than double-counting it", ({ expect }) => {
  // The reader runs on STORED rows and must not throw, but it must also not turn
  // one port into two entries — a row written before this rule existed would
  // otherwise still produce duplicate listeners.
  expect(deploymentPortEntries({ "80": { protocol: "http" }, "080": { protocol: "http" } })).toEqual([{ port: 80, protocol: "http" }]);
});

import.meta.vitest?.test("deploymentServiceDefinitionSchema refuses a port that collides with the standard bindings", async ({ expect }) => {
  // The holder claims external 80 and 443 on top of its own number, so a sibling
  // numbered 80 or 443 asks for a listener it has already taken.
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "serverless", public: true, ports: { "80": { protocol: "http" }, "443": { protocol: "http" } }, env: {},
  }, { abortEarly: false })).rejects.toThrow(/no other port may be numbered 80 or 443/);
  // Not only a public-service problem: the sole HTTP port of a PRIVATE service
  // is the holder too, so a raw TCP 443 beside it collides just as hard.
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "server", ports: { "8080": { protocol: "http" }, "443": { protocol: "tcp" } }, env: {},
  }, { abortEarly: false })).rejects.toThrow(/no other port may be numbered 80 or 443/);
  // The holder being 80 or 443 itself is fine — it is the one that owns them.
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "serverless", public: true, ports: { "80": { protocol: "http" }, "3000": { protocol: "http" } }, env: {},
  }, { abortEarly: false })).resolves.toBeDefined();
  // Two HTTP ports on a private service leave no holder at all, so nothing is reserved.
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "server", ports: { "80": { protocol: "http" }, "443": { protocol: "http" } }, env: {},
  }, { abortEarly: false })).resolves.toBeDefined();
});

import.meta.vitest?.test("deploymentServiceDefinitionSchema refuses a public service the runtime could not serve", async ({ expect }) => {
  // Raw TCP carries no SNI or Host, so a shared public address cannot tell which
  // service a connection is for — VERIFIED against real Fly.
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "server", public: true, ports: { "5432": { protocol: "tcp" } }, env: {},
  }, { abortEarly: false })).rejects.toThrow(/may not declare a "tcp" port/);
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "server", public: true, ports: { "3000": { protocol: "http" }, "5432": { protocol: "tcp" } }, env: {},
  }, { abortEarly: false })).rejects.toThrow(/may not declare a "tcp" port/);
  // A PRIVATE service may declare TCP freely — only public ingress is the problem.
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "server", ports: { "3000": { protocol: "http" }, "5432": { protocol: "tcp" } }, env: {},
  }, { abortEarly: false })).resolves.toBeDefined();
  // Public ingress with nothing behind it. Unrepresentable while the flag lived
  // on a port; refused now that it lives on the service.
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "server", public: true, ports: {}, env: {},
  }, { abortEarly: false })).rejects.toThrow(/must declare at least one port/);
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "server", ports: {}, env: {},
  }, { abortEarly: false })).resolves.toBeDefined();
});

import.meta.vitest?.test("deploymentServiceDefinitionSchema rejects port sets it could not serve", async ({ expect }) => {
  // A duplicate port needs no rule of its own here: an object cannot hold one
  // key twice, and the canonical-spelling rule rules out the numeric aliases.
  await expect(deploymentServiceDefinitionSchema.validate({ type: "serverless", ports: { "0": { protocol: "http" } }, env: {} })).rejects.toThrow();
  await expect(deploymentServiceDefinitionSchema.validate({ type: "serverless", ports: { "70000": { protocol: "http" } }, env: {} })).rejects.toThrow();
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "serverless", ports: Object.fromEntries(Array.from({ length: MAX_PORTS_PER_SERVICE + 1 }, (_, index) => [String(3000 + index), { protocol: "http" }])), env: {},
  }, { abortEarly: false })).rejects.toThrow(/at most/);
});

import.meta.vitest?.test("port helpers agree with what the schema allows", ({ expect }) => {
  const mixed: DeploymentPorts = { "3000": { protocol: "http" }, "5432": { protocol: "tcp" } };
  // The holder of a PRIVATE service is its sole HTTP port; the TCP sibling does
  // not make it ambiguous.
  expect(standardPortsHolderPort(mixed, false)).toBe(3000);
  // The holder of a PUBLIC service is its LOWEST port, by number and not by key
  // order — so "443" wins over "8443" however the record was written.
  const twoPorts: DeploymentPorts = { "8443": { protocol: "http" }, "443": { protocol: "http" } };
  expect(standardPortsHolderPort(twoPorts, true)).toBe(443);
  expect(deploymentPortOwnsStandardPorts(twoPorts, true, 443)).toBe(true);
  expect(deploymentPortOwnsStandardPorts(twoPorts, true, 8443)).toBe(false);
  // The same set on a PRIVATE service has no holder at all: two HTTP ports leave
  // nothing for a certificate to terminate on.
  expect(standardPortsHolderPort(twoPorts, false)).toBe(null);
  // A lone port is always the holder.
  expect(deploymentPortOwnsStandardPorts({ "3000": { protocol: "http" } }, true, 3000)).toBe(true);
  // Ambiguous references resolve to null so each layer can phrase its own error.
  // url only counts HTTP ports, so the TCP sibling does not make it ambiguous.
  expect(soleHttpDeploymentPort(mixed)).toBe(3000);
  expect(soleHttpDeploymentPort({ "3000": { protocol: "http" }, "4000": { protocol: "http" } })).toBe(null);
  expect(portProtocol({ protocol: "http" })).toBe("http");
  expect(portProtocol({ protocol: "tcp" })).toBe("tcp");
  // Ascending by port NUMBER, not by key order — "80" must not sort after "8080".
  expect(deploymentPortEntries({ "8080": { protocol: "http" }, "80": { protocol: "http" } })).toEqual([
    { port: 80, protocol: "http" },
    { port: 8080, protocol: "http" },
  ]);
  // A hand-edited row with a key that is not a port is skipped, not thrown on:
  // this runs on stored rows, and one bad entry must not take down a listing.
  expect(deploymentPortEntries({ web: { protocol: "http" }, "3000": { protocol: "http" } })).toEqual([{ port: 3000, protocol: "http" }]);
  expect(deploymentPortEntry({ "3000": { protocol: "tcp" } }, 3000)?.protocol).toBe("tcp");
  expect(deploymentPortEntry({ "3000": { protocol: "http" } }, 4000)).toBe(null);
});

import.meta.vitest?.test("connection references round-trip, with and without a port", ({ expect }) => {
  expect(parseConnectionValue("api.url")).toEqual({ serviceId: "api", outputKey: "url", port: null });
  expect(parseConnectionValue("api.url:9090")).toEqual({ serviceId: "api", outputKey: "url", port: 9090 });
  // Service ids may contain hyphens; output keys may not contain dots or colons.
  expect(parseConnectionValue("my-api.hostname")).toEqual({ serviceId: "my-api", outputKey: "hostname", port: null });
  expect(parseConnectionValue("hexclave.projectId")).toEqual({ serviceId: "hexclave", outputKey: "projectId", port: null });
  expect(parseConnectionValue("api")).toBe(null);
  expect(parseConnectionValue("api.url:")).toBe(null);
  expect(parseConnectionValue("api.url:123456")).toBe(null);
  expect(formatConnectionValue("api", "url")).toBe("api.url");
  expect(formatConnectionValue("api", "url", 9090)).toBe("api.url:9090");
  for (const value of ["api.url", "api.url:9090", "api.hostname", "hexclave.projectId"]) {
    const parsed = parseConnectionValue(value)!;
    expect(formatConnectionValue(parsed.serviceId, parsed.outputKey, parsed.port)).toBe(value);
  }
});

import.meta.vitest?.test("only a public or unnamed port makes a url reference wait for its target", ({ expect }) => {
  // A private port's URL is as deterministic as the hostname it is built from.
  expect(connectionRequiresTargetDeployed("url", 5432, false)).toBe(false);
  expect(connectionRequiresTargetDeployed("url", 3000, true)).toBe(true);
  // Unknown publicness (a target this deploy file cannot see) waits.
  expect(connectionRequiresTargetDeployed("url", 3000, null)).toBe(true);
  // A bare url() has to read the target's ports to know which one it means.
  expect(connectionRequiresTargetDeployed("url", null, false)).toBe(true);
  expect(connectionRequiresTargetDeployed("hostname", null, null)).toBe(false);
});

import.meta.vitest?.test("deploymentServiceDefinitionSchema accepts a persistent volume on a server service", async ({ expect }) => {
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "server", ports: { "3000": { protocol: "http" } }, persistent_volumes: { data: { path: "/data", size_gb: 10 } }, env: {},
  }, { abortEarly: false })).resolves.toBeDefined();
  // Spelling out the implied 0/1 bounds is allowed; anything else is not.
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "server", ports: { "3000": { protocol: "http" } }, min_instances: 0, max_instances: 1,
    persistent_volumes: { app_state: { path: "/var/lib/app/data", size_gb: 1 } }, env: {},
  }, { abortEarly: false })).resolves.toBeDefined();
  // An empty record is the same as having no volume, and stays valid on a
  // serverless service — otherwise `persistent_volumes: {}` written out by a
  // serializer would fail a config that declares no disks at all.
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "serverless", ports: { "3000": { protocol: "http" } }, persistent_volumes: {}, env: {},
  }, { abortEarly: false })).resolves.toBeDefined();
});

import.meta.vitest?.test("deploymentServiceDefinitionSchema pins a server service to a single instance", async ({ expect }) => {
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "server", ports: { "3000": { protocol: "http" } }, max_instances: 2, env: {},
  }, { abortEarly: false })).rejects.toThrow(/max_instances must be 1/);
  // 0 (suspend when idle) and 1 (stay up) are the only meanings a single
  // instance can have; anything above is a fleet, which "server" is not.
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "server", ports: { "3000": { protocol: "http" } }, min_instances: 1, env: {},
  }, { abortEarly: false })).resolves.toBeDefined();
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "server", ports: { "3000": { protocol: "http" } }, min_instances: 0, env: {},
  }, { abortEarly: false })).resolves.toBeDefined();
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "server", ports: { "3000": { protocol: "http" } }, min_instances: 2, env: {},
  }, { abortEarly: false })).rejects.toThrow(/min_instances must be 0 \(suspend when idle\) or 1/);
  // Serverless keeps the full range.
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "serverless", ports: { "3000": { protocol: "http" } }, min_instances: 1, max_instances: 10, env: {},
  }, { abortEarly: false })).resolves.toBeDefined();
});

import.meta.vitest?.test("deploymentServiceDefinitionSchema rejects persistent volumes that cannot work", async ({ expect }) => {
  // A serverless fleet cannot share one disk, whatever its bounds are.
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "serverless", ports: { "3000": { protocol: "http" } }, persistent_volumes: { data: { path: "/data", size_gb: 1 } }, env: {},
  }, { abortEarly: false })).rejects.toThrow(/only a "server" service may have persistent volumes/);
  // More than one disk on one machine is beyond what Fly can mount today, and
  // must fail loudly rather than silently mounting whichever came first.
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "server", ports: { "3000": { protocol: "http" } }, env: {},
    persistent_volumes: { data: { path: "/data", size_gb: 1 }, cache: { path: "/cache", size_gb: 1 } },
  }, { abortEarly: false })).rejects.toThrow(/at most 1 persistent volume/);
  for (const badId of ["Data", "1data", "my-volume", "_data", "x".repeat(MAX_VOLUME_ID_LENGTH + 1)]) {
    await expect(deploymentServiceDefinitionSchema.validate({
      type: "server", ports: { "3000": { protocol: "http" } }, persistent_volumes: { [badId]: { path: "/data", size_gb: 1 } }, env: {},
    }, { abortEarly: false }), `volume id ${JSON.stringify(badId)}`).rejects.toThrow();
  }
  for (const badPath of ["data", "/", "/data/", "/data/../etc", "/data/./x", "/da\\ta", "/da\u0000ta"]) {
    await expect(deploymentServiceDefinitionSchema.validate({
      type: "server", ports: { "3000": { protocol: "http" } }, persistent_volumes: { data: { path: badPath, size_gb: 1 } }, env: {},
    }, { abortEarly: false })).rejects.toThrow(/normalized absolute path/);
  }
  // Anchored to the size field: a bare toThrow() would still pass if the size
  // bounds regressed and some unrelated rule happened to reject the shape.
  for (const badSize of [0, -1, 501, 1.5]) {
    await expect(deploymentServiceDefinitionSchema.validate({
      type: "server", ports: { "3000": { protocol: "http" } }, persistent_volumes: { data: { path: "/data", size_gb: badSize } }, env: {},
    }, { abortEarly: false })).rejects.toThrow(/size_gb/);
  }
});

import.meta.vitest?.test("deploymentServiceDefinitionSchema rejects invalid shapes", async ({ expect }) => {
  // A secret with an inline value would defeat the whole point of secrets.
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "serverless", ports: { "3000": { protocol: "http" } }, env: { A: { type: "secret", key: "a", value: "leaked" } },
  }, { abortEarly: false })).rejects.toThrow(/must not have a value/);
  // A secret without a key can never be filled at deploy time.
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "serverless", ports: { "3000": { protocol: "http" } }, env: { A: { type: "secret" } },
  }, { abortEarly: false })).rejects.toThrow(/key/);
  // Plain values may not carry a secret key.
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "serverless", ports: { "3000": { protocol: "http" } }, env: { A: { value: "x", key: "a" } },
  }, { abortEarly: false })).rejects.toThrow(/only have a key/);
  // Connections must point at `<serviceId>.<outputKey>`.
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "serverless", ports: { "3000": { protocol: "http" } }, env: { A: { type: "connection", value: "{hexclave.projectId}" } },
  }, { abortEarly: false })).rejects.toThrow(/service output/);
  // Env var keys must be valid POSIX-ish env var names.
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "serverless", ports: { "3000": { protocol: "http" } }, env: { "1BAD": { value: "x" } },
  }, { abortEarly: false })).rejects.toThrow(/env var keys/);
  // The service type is required.
  await expect(deploymentServiceDefinitionSchema.validate({
    ports: { "3000": { protocol: "http" } }, env: {},
  }, { abortEarly: false })).rejects.toThrow(/type/);
  // Ports are required — there is no sensible default to guess.
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "serverless", env: {},
  }, { abortEarly: false })).rejects.toThrow(/ports/);
  // Scaling bounds must be consistent when both are given.
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "serverless", ports: { "3000": { protocol: "http" } }, min_instances: 3, max_instances: 1, env: {},
  }, { abortEarly: false })).rejects.toThrow(/greater than or equal to min_instances/);
  // min_instances alone is accepted — max defaults up to min so the spec stays consistent
  // (this is the case that previously slipped through validation and 400'd from the runtime).
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "serverless", ports: { "3000": { protocol: "http" } }, min_instances: 2, env: {},
  }, { abortEarly: false })).resolves.toBeDefined();
  // Both bounds are capped at MAX_INSTANCES_PER_SERVICE, and the cap itself is
  // accepted — an off-by-one here would refuse the largest legal fleet.
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "serverless", ports: { "3000": { protocol: "http" } }, min_instances: MAX_INSTANCES_PER_SERVICE, max_instances: MAX_INSTANCES_PER_SERVICE, env: {},
  }, { abortEarly: false })).resolves.toBeDefined();
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "serverless", ports: { "3000": { protocol: "http" } }, min_instances: MAX_INSTANCES_PER_SERVICE + 1, env: {},
  }, { abortEarly: false })).rejects.toThrow(/min_instances/);
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "serverless", ports: { "3000": { protocol: "http" } }, max_instances: MAX_INSTANCES_PER_SERVICE + 1, env: {},
  }, { abortEarly: false })).rejects.toThrow(/max_instances/);
  // dockerfile_path must be a normalized relative path inside the packaged
  // source — mirror of Marshal's validateServiceSpec, checked here so invalid
  // values fail at sync time instead of after an upload is consumed.
  for (const invalidDockerfilePath of [
    "../Dockerfile", "/etc/Dockerfile", ".", "./Dockerfile", "a//b",
    "docker\\Dockerfile", "Dock\terfile", "x".repeat(513),
  ]) {
    await expect(deploymentServiceDefinitionSchema.validate({
      type: "serverless", ports: { "3000": { protocol: "http" } }, dockerfile_path: invalidDockerfilePath, env: {},
    }, { abortEarly: false })).rejects.toThrow(/dockerfile_path/);
  }
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "serverless", ports: { "3000": { protocol: "http" } }, dockerfile_path: "docker/Dockerfile.web", env: {},
  }, { abortEarly: false })).resolves.toBeDefined();
});

import.meta.vitest?.test("a service's dev command is not part of its definition", async ({ expect }) => {
  // The dev command never leaves the deploy file (see the schema comment), so
  // a client sending one is out of date rather than merely verbose — say so
  // instead of dropping the field on the floor.
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "serverless", ports: { "3000": { protocol: "http" } }, dev_command: "pnpm dev", env: {},
  }, { abortEarly: false })).rejects.toThrow(/must not carry a dev_command/);
});

import.meta.vitest?.test("a secret's default value is not part of its definition", async ({ expect }) => {
  // The invariant behind the dashboard's secrets page: a definition can only
  // ever say WHICH secret an env var needs, never what it falls back to. If a
  // default could be stored, "is this secret set?" would stop having a single
  // answer, which is exactly the three-way badge state this replaced.
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "serverless",
    ports: { "3000": { protocol: "http" } },
    env: { OPENAI_API_KEY: { type: "secret", key: "OPENAI", default_value: "sk-dev" } },
  }, { abortEarly: false })).rejects.toThrow(/must not carry a default_value/);
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "serverless",
    ports: { "3000": { protocol: "http" } },
    env: { PLAIN: { value: "x", default_value: "y" } },
  }, { abortEarly: false })).rejects.toThrow(/must not carry a default_value/);
});

import.meta.vitest?.test("deploymentSecretDefaultsSchema accepts env-var-keyed defaults", async ({ expect }) => {
  await expect(deploymentSecretDefaultsSchema.validate({
    OPENAI_API_KEY: "sk-dev",
    // An empty default is meaningful — it means "deploy with this var empty",
    // which is different from having no default at all.
    OPTIONAL_FLAG: "",
  }, { abortEarly: false })).resolves.toEqual({ OPENAI_API_KEY: "sk-dev", OPTIONAL_FLAG: "" });
  await expect(deploymentSecretDefaultsSchema.validate({
    "1BAD": "x",
  }, { abortEarly: false })).rejects.toThrow(/env var keys/);
});

// Type-level check that the yup schema stays assignable to the hand-written
// definition type (yup's InferType makes optional fields `| undefined`, which
// matches under exactOptionalPropertyTypes only if the shapes agree).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _assertEnvVarSchemaMatchesType: DeploymentEnvVarDefinition = undefined as unknown as yup.InferType<typeof deploymentEnvVarSchema>;
