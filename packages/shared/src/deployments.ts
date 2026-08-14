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
 * resolves before the target exists. `url()` depends on which port it names:
 *
 *  - a PUBLIC port's URL is the platform URL (or a verified custom domain),
 *    which only exists once the service has been provisioned;
 *  - a PRIVATE port's URL is built from the deterministic hostname and the port
 *    written in the reference, so it resolves just as early as hostname();
 *  - a bare `url()` has to read the target's synced definition to learn its sole
 *    HTTP port, so it waits regardless.
 *
 * `targetPortIsPublic` is null when the caller cannot see the target's ports
 * (a reference into a source this deploy file does not contain), in which case
 * the conservative answer is that it waits. Getting this wrong in the other
 * direction would serialize independent deploys, cascade false "skipped" results
 * when the target fails, and reject mutually-wired services as circular.
 */
export function connectionRequiresTargetDeployed(outputKey: string, port: number | null, targetPortIsPublic: boolean | null = null): boolean {
  if (outputKey !== "url") return false;
  if (port === null) return true;
  return targetPortIsPublic !== false;
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
  // The ports the container listens on. There is no separate service-level
  // `visibility`: a service is public exactly when one of its ports says so, so
  // the two can never disagree.
  //
  // May be EMPTY, for a worker that only makes outbound connections. Such a
  // service has no URL of any kind and can hold no custom domain, and it only
  // ever runs if it is always-on (see the schema's note on autostart).
  //
  // Each port is reachable on the private network at its own number, and the
  // service's single HTTP port is additionally served on 80/443 so `url` and
  // custom domain certificates work on the standard ports.
  //
  // A service's ports are ALL public or ALL private. This is a Fly.io
  // limitation, not a design preference: Fly's proxy listener set is per-app
  // rather than per-address, so a private sibling of a public port is reachable
  // from the internet as well. The `public-and-private-ports-are-not-mixed` rule
  // below carries the full explanation, including the `.internal` escape hatch
  // that would lift it.
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
// `public` (default false) is what exposes the port to the internet: it
// allocates Fly ingress and gives the service a platform URL. A public port may
// not sit beside a PRIVATE one — see the `public-and-private-ports-are-not-mixed`
// rule below for why. Several public ports are fine; each answers on its own
// number, and the lowest additionally gets the standard 80/443.
//
// `protocol` (default "http") picks the protocol handler. A "tcp" port is raw
// and private-only: it gets no TLS termination and no HTTP routing, so it
// cannot be the public one — reach it over the private network with hostname()
// and its port number.
export type DeploymentPortDefinition = {
  public?: boolean | undefined,
  protocol?: "http" | "tcp" | undefined,
};

// The ports a service listens on, keyed by port NUMBER — the same shape the
// author writes in the deploy file (`ports: { 3000: { public: true } }`), kept
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

/** A port's protocol, applying the "http" default one place so callers agree. */
export function portProtocol(port: DeploymentPortDefinition): "http" | "tcp" {
  return port.protocol ?? "http";
}

/** One declared port, with the record's key parsed and every default applied. */
export type DeploymentPortEntry = {
  port: number,
  public: boolean,
  protocol: "http" | "tcp",
};

/**
 * The ports as a list, ascending by port number, with defaults applied. Every
 * consumer that has to compare, count or iterate ports goes through this, so the
 * key parsing and the defaults happen in exactly one place — and so the order is
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
    entries.push({ port, public: definition.public === true, protocol: portProtocol(definition) });
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
 * The service's LOWEST-NUMBERED public port, or null when it has none.
 *
 * A service may declare several public ports (see the
 * `public-and-private-ports-are-not-mixed` rule), so "the public port" is no
 * longer well defined — but exactly one of them can own the platform hostname's
 * 80/443, and this is it. Lowest-numbered rather than first-encountered:
 * deploymentPortEntries sorts numerically, so which port gets the standard
 * bindings is a property of the port set and not of JSON key ordering. That
 * determinism is the whole point — the holder is the port the service's bare URL
 * names and the only one a custom domain can front, so an arbitrary pick would
 * silently move both.
 */
export function standardPortsHolderDeploymentPort(ports: DeploymentPorts): DeploymentPortEntry | null {
  return deploymentPortEntries(ports).find((entry) => entry.public) ?? null;
}

/**
 * The port number that additionally answers on the standard 80/443, or null when
 * the service has no single obvious one.
 *
 * The lowest public port when the service is public; otherwise its sole HTTP
 * port, because a PRIVATE service gets public IPs the moment a custom domain is
 * attached and that domain terminates TLS on 443. KEPT IN SYNC WITH
 * standardPortsHolderFor in apps/marshal/src/services.ts.
 */
export function standardPortsHolderPort(ports: DeploymentPorts): number | null {
  return standardPortsHolderDeploymentPort(ports)?.port ?? soleHttpDeploymentPort(ports);
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
 * The cheap example is `{ 80: { public: true }, 443: { public: true } }`: 80 is
 * the holder, claims 80 and 443, and the declared 443 claims 443 again. This is
 * refused rather than resolved by precedence, because every way of resolving it
 * silently drops or retargets a port the author explicitly declared.
 */
export function reservedStandardPortConflicts(ports: DeploymentPorts): number[] {
  const holder = standardPortsHolderPort(ports);
  if (holder === null) return [];
  return deploymentPortEntries(ports)
    .filter((entry) => entry.port !== holder && (entry.port === 80 || entry.port === 443))
    .map((entry) => entry.port);
}

/** Whether the service is reachable from the internet — the replacement for the old `visibility`. */
export function deploymentServiceIsPublic(ports: DeploymentPorts): boolean {
  return standardPortsHolderDeploymentPort(ports) !== null;
}

/**
 * Whether this port is the one that owns the service's standard 80/443, and so
 * the one whose URL carries no `:port` suffix.
 *
 * VERIFIED AGAINST REAL FLY: a non-holder public port is reachable on its own
 * number over BOTH IPv4 and IPv6 — a shared IPv4 forwards every port in the
 * app's `services` list, not only 80/443, which is what an earlier version of
 * this code assumed. So the difference between the holder and the rest is the
 * URL shape and which port a custom domain can front, NOT reachability.
 */
export function deploymentPortOwnsStandardPorts(ports: DeploymentPorts, port: number): boolean {
  return standardPortsHolderDeploymentPort(ports)?.port === port;
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
  ports: yupRecord(
    yupString().matches(DEPLOYMENT_PORT_KEY_REGEX, "deployment service port keys must be port numbers written without a leading zero")
      .test("port-in-range", "deployment service ports must be between 1 and 65535", (value) =>
        value === undefined || (Number(value) >= 1 && Number(value) <= 65535)),
    yupObject({
      public: yupBoolean().default(false).defined(),
      protocol: yupString().oneOf(["http", "tcp"]).default("http").defined(),
    }).defined()
      // Checked per entry so the message can point at the offending port rather
      // than at the service as a whole.
      .test("tcp-is-private", 'a "tcp" port is raw and private-only, so it cannot be public — reach it over the private network with hostname() and its port number', (value) =>
        value.protocol !== "tcp" || !value.public),
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
    // FLY.IO PLATFORM LIMITATION. A service may not MIX public and private ports.
    //
    // A Fly machine's `services` array is the proxy's listener set for the whole
    // APP — an entry says "the proxy accepts <external port> and forwards it to
    // <internal_port>", with no way to scope it to one address. So the proxy
    // serves every declared port on every IP the app holds. The moment a public
    // IP is allocated (a public port, or a custom domain), a "private" sibling
    // port is answering on the public internet: a service with a public web port
    // and a private 5432 puts its database online.
    //
    // Why we are subject to it at all: private service-to-service traffic goes
    // over Flycast (`<app>.flycast`, see hostnameForService in marshal), which
    // is itself the Fly proxy. A private port must therefore have a `services`
    // entry to be reachable — the very entry that the public IP then exposes.
    //
    // The escape hatch, not taken: Fly also offers `<app>.internal`, 6PN DNS
    // straight to the machines' IPv6 addresses, which bypasses the proxy entirely
    // and needs no `services` entry (and so cannot leak). It costs the proxy
    // features Flycast provides on private traffic — autostart/autostop (nothing
    // wakes a stopped machine behind `.internal`), load balancing across slots,
    // and one stable address independent of instance count. Until that trade is
    // made, private ports belong on their own service reached via `hostname()`.
    //
    // SEVERAL PUBLIC PORTS ARE FINE, and this rule deliberately no longer refuses
    // them: nothing leaks when every declared port is one the author asked to
    // publish. Each is reachable on its own number over both IPv4 and IPv6
    // (verified against real Fly — a shared IPv4 forwards every port in the app's
    // `services`, not only 80/443). What the extra ports do NOT get is the
    // standard 80/443 and the custom domain that terminates there; those belong
    // to the standard-ports holder alone (standardPortsHolderDeploymentPort).
    .test("public-and-private-ports-are-not-mixed", "a service may not mix public and private ports — the runtime exposes every declared port on every address the service has, so the private ones would be public too. Move them to their own service.", (value) => {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (value === undefined) return true;
      const entries = Object.values(value);
      return !entries.some((entry) => entry.public === true) || !entries.some((entry) => entry.public !== true);
    })
    // The standard-ports holder claims external 80 and 443 for the whole app, so
    // no OTHER declared port may be numbered 80 or 443 — it would ask for a
    // listener the holder already took. See reservedStandardPortConflicts.
    .test("standard-ports-are-not-claimed-twice", "80 and 443 belong to the port that owns the service's standard bindings (the lowest public port, or the sole HTTP port of a private service), so no other port may be numbered 80 or 443 — the runtime cannot serve one external port from two of them", (value) =>
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      value === undefined || reservedStandardPortConflicts(value).length === 0),
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
    ports: { "3000": {} },
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

import.meta.vitest?.test("deploymentServiceDefinitionSchema defaults each port to a private HTTP port", async ({ expect }) => {
  await expect(deploymentServiceDefinitionSchema.validate({ type: "serverless", ports: { "3000": {} }, env: {} }))
    .resolves.toMatchObject({ ports: { "3000": { public: false, protocol: "http" } } });
  await expect(deploymentServiceDefinitionSchema.validate({ type: "serverless", ports: { "3000": { public: true } }, env: {} }))
    .resolves.toMatchObject({ ports: { "3000": { public: true, protocol: "http" } } });
  // A PRIVATE service may hold several ports of mixed protocols.
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "server", ports: { "8080": {}, "5432": { protocol: "tcp" }, "9090": {} }, env: {},
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

import.meta.vitest?.test("deploymentServiceDefinitionSchema accepts several public ports", async ({ expect }) => {
  // Nothing leaks when every port is one the author asked to publish. The cost
  // is reachability, not exposure: only the lowest gets 80/443 and so IPv4.
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "serverless", ports: { "3000": { public: true }, "4000": { public: true } }, env: {},
  }, { abortEarly: false })).resolves.toBeDefined();
});

import.meta.vitest?.test("deploymentServiceDefinitionSchema refuses a non-canonical port key", async ({ expect }) => {
  // "80" and "080" are one port under two keys: the record makes an exact key
  // impossible to repeat, not a numeric alias, so both entries would be stored
  // and the runtime would declare the port twice.
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "serverless", ports: { "80": { public: true }, "080": { public: true } }, env: {},
  }, { abortEarly: false })).rejects.toThrow(/without a leading zero/);
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "server", ports: { "08080": {} }, env: {},
  }, { abortEarly: false })).rejects.toThrow(/without a leading zero/);
});

import.meta.vitest?.test("deploymentPortEntries drops a non-canonical key rather than double-counting it", ({ expect }) => {
  // The reader runs on STORED rows and must not throw, but it must also not turn
  // one port into two entries — a row written before this rule existed would
  // otherwise still produce duplicate listeners.
  expect(deploymentPortEntries({ "80": { public: true }, "080": { public: true } })).toEqual([
    { port: 80, public: true, protocol: "http" },
  ]);
});

import.meta.vitest?.test("deploymentServiceDefinitionSchema refuses a port that collides with the standard bindings", async ({ expect }) => {
  // The holder claims external 80 and 443 on top of its own number, so a sibling
  // numbered 80 or 443 asks for a listener it has already taken.
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "serverless", ports: { "80": { public: true }, "443": { public: true } }, env: {},
  }, { abortEarly: false })).rejects.toThrow(/no other port may be numbered 80 or 443/);
  // Not only a public-port problem: the sole HTTP port of a PRIVATE service is
  // the holder too, so a raw TCP 443 beside it collides just as hard.
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "server", ports: { "8080": {}, "443": { protocol: "tcp" } }, env: {},
  }, { abortEarly: false })).rejects.toThrow(/no other port may be numbered 80 or 443/);
  // The holder being 80 or 443 itself is fine — it is the one that owns them.
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "serverless", ports: { "80": { public: true }, "3000": { public: true } }, env: {},
  }, { abortEarly: false })).resolves.toBeDefined();
  // Two private HTTP ports leave no holder at all, so nothing is reserved.
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "server", ports: { "80": {}, "443": {} }, env: {},
  }, { abortEarly: false })).resolves.toBeDefined();
});

import.meta.vitest?.test("deploymentServiceDefinitionSchema rejects port sets it could not serve", async ({ expect }) => {
  // Raw TCP has no TLS termination or HTTP routing to make public with.
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "server", ports: { "5432": { protocol: "tcp", public: true } }, env: {},
  }, { abortEarly: false })).rejects.toThrow(/private-only/);
  // A public port cannot have private siblings: the runtime would serve them on
  // the public address too, so a "private" database port would be on the internet.
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "server", ports: { "3000": { public: true }, "5432": { protocol: "tcp" } }, env: {},
  }, { abortEarly: false })).rejects.toThrow(/may not mix public and private ports/);
  // Same rule the other way round — a private HTTP sibling leaks just as well as
  // a TCP one, and neither is saved by the public port being listed first.
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "server", ports: { "3000": { public: true }, "4000": {} }, env: {},
  }, { abortEarly: false })).rejects.toThrow(/may not mix public and private ports/);
  // A duplicate port needs no rule of its own here: an object cannot hold one
  // key twice, which is half of why the record shape is the stored one.
  await expect(deploymentServiceDefinitionSchema.validate({ type: "serverless", ports: { "0": {} }, env: {} })).rejects.toThrow();
  await expect(deploymentServiceDefinitionSchema.validate({ type: "serverless", ports: { "70000": {} }, env: {} })).rejects.toThrow();
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "serverless", ports: Object.fromEntries(Array.from({ length: MAX_PORTS_PER_SERVICE + 1 }, (_, index) => [String(3000 + index), {}])), env: {},
  }, { abortEarly: false })).rejects.toThrow(/at most/);
});

import.meta.vitest?.test("port helpers agree with what the schema allows", ({ expect }) => {
  const mixed = { "3000": { public: true }, "5432": { protocol: "tcp" as const } };
  expect(deploymentServiceIsPublic(mixed)).toBe(true);
  expect(standardPortsHolderDeploymentPort(mixed)?.port).toBe(3000);
  expect(deploymentServiceIsPublic({ "3000": {} })).toBe(false);
  // The standard-ports holder is the LOWEST public port, by number and not by key
  // order — so "443" wins over "8443" however the record was written.
  const twoPublic = { "8443": { public: true }, "443": { public: true } };
  expect(standardPortsHolderDeploymentPort(twoPublic)?.port).toBe(443);
  expect(deploymentPortOwnsStandardPorts(twoPublic, 443)).toBe(true);
  expect(deploymentPortOwnsStandardPorts(twoPublic, 8443)).toBe(false);
  // A lone public port is always the holder.
  expect(deploymentPortOwnsStandardPorts({ "3000": { public: true } }, 3000)).toBe(true);
  // Ambiguous references resolve to null so each layer can phrase its own error.
  // url only counts HTTP ports, so the TCP sibling does not make it ambiguous.
  expect(soleHttpDeploymentPort(mixed)).toBe(3000);
  expect(soleHttpDeploymentPort({ "3000": {}, "4000": {} })).toBe(null);
  expect(portProtocol({})).toBe("http");
  expect(portProtocol({ protocol: "tcp" })).toBe("tcp");
  // Ascending by port NUMBER, not by key order — "80" must not sort after "8080".
  expect(deploymentPortEntries({ "8080": {}, "80": { public: true } })).toEqual([
    { port: 80, public: true, protocol: "http" },
    { port: 8080, public: false, protocol: "http" },
  ]);
  // A hand-edited row with a key that is not a port is skipped, not thrown on:
  // this runs on stored rows, and one bad entry must not take down a listing.
  expect(deploymentPortEntries({ web: {}, "3000": {} })).toEqual([{ port: 3000, public: false, protocol: "http" }]);
  expect(deploymentPortEntry({ "3000": { public: true } }, 3000)?.public).toBe(true);
  expect(deploymentPortEntry({ "3000": {} }, 4000)).toBe(null);
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
    type: "server", ports: { "3000": {} }, persistent_volumes: { data: { path: "/data", size_gb: 10 } }, env: {},
  }, { abortEarly: false })).resolves.toBeDefined();
  // Spelling out the implied 0/1 bounds is allowed; anything else is not.
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "server", ports: { "3000": {} }, min_instances: 0, max_instances: 1,
    persistent_volumes: { app_state: { path: "/var/lib/app/data", size_gb: 1 } }, env: {},
  }, { abortEarly: false })).resolves.toBeDefined();
  // An empty record is the same as having no volume, and stays valid on a
  // serverless service — otherwise `persistent_volumes: {}` written out by a
  // serializer would fail a config that declares no disks at all.
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "serverless", ports: { "3000": {} }, persistent_volumes: {}, env: {},
  }, { abortEarly: false })).resolves.toBeDefined();
});

import.meta.vitest?.test("deploymentServiceDefinitionSchema pins a server service to a single instance", async ({ expect }) => {
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "server", ports: { "3000": {} }, max_instances: 2, env: {},
  }, { abortEarly: false })).rejects.toThrow(/max_instances must be 1/);
  // 0 (suspend when idle) and 1 (stay up) are the only meanings a single
  // instance can have; anything above is a fleet, which "server" is not.
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "server", ports: { "3000": {} }, min_instances: 1, env: {},
  }, { abortEarly: false })).resolves.toBeDefined();
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "server", ports: { "3000": {} }, min_instances: 0, env: {},
  }, { abortEarly: false })).resolves.toBeDefined();
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "server", ports: { "3000": {} }, min_instances: 2, env: {},
  }, { abortEarly: false })).rejects.toThrow(/min_instances must be 0 \(suspend when idle\) or 1/);
  // Serverless keeps the full range.
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "serverless", ports: { "3000": {} }, min_instances: 1, max_instances: 10, env: {},
  }, { abortEarly: false })).resolves.toBeDefined();
});

import.meta.vitest?.test("deploymentServiceDefinitionSchema rejects persistent volumes that cannot work", async ({ expect }) => {
  // A serverless fleet cannot share one disk, whatever its bounds are.
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "serverless", ports: { "3000": {} }, persistent_volumes: { data: { path: "/data", size_gb: 1 } }, env: {},
  }, { abortEarly: false })).rejects.toThrow(/only a "server" service may have persistent volumes/);
  // More than one disk on one machine is beyond what Fly can mount today, and
  // must fail loudly rather than silently mounting whichever came first.
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "server", ports: { "3000": {} }, env: {},
    persistent_volumes: { data: { path: "/data", size_gb: 1 }, cache: { path: "/cache", size_gb: 1 } },
  }, { abortEarly: false })).rejects.toThrow(/at most 1 persistent volume/);
  for (const badId of ["Data", "1data", "my-volume", "_data", "x".repeat(MAX_VOLUME_ID_LENGTH + 1)]) {
    await expect(deploymentServiceDefinitionSchema.validate({
      type: "server", ports: { "3000": {} }, persistent_volumes: { [badId]: { path: "/data", size_gb: 1 } }, env: {},
    }, { abortEarly: false }), `volume id ${JSON.stringify(badId)}`).rejects.toThrow();
  }
  for (const badPath of ["data", "/", "/data/", "/data/../etc", "/data/./x", "/da\\ta", "/da\u0000ta"]) {
    await expect(deploymentServiceDefinitionSchema.validate({
      type: "server", ports: { "3000": {} }, persistent_volumes: { data: { path: badPath, size_gb: 1 } }, env: {},
    }, { abortEarly: false })).rejects.toThrow(/normalized absolute path/);
  }
  // Anchored to the size field: a bare toThrow() would still pass if the size
  // bounds regressed and some unrelated rule happened to reject the shape.
  for (const badSize of [0, -1, 501, 1.5]) {
    await expect(deploymentServiceDefinitionSchema.validate({
      type: "server", ports: { "3000": {} }, persistent_volumes: { data: { path: "/data", size_gb: badSize } }, env: {},
    }, { abortEarly: false })).rejects.toThrow(/size_gb/);
  }
});

import.meta.vitest?.test("deploymentServiceDefinitionSchema rejects invalid shapes", async ({ expect }) => {
  // A secret with an inline value would defeat the whole point of secrets.
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "serverless", ports: { "3000": {} }, env: { A: { type: "secret", key: "a", value: "leaked" } },
  }, { abortEarly: false })).rejects.toThrow(/must not have a value/);
  // A secret without a key can never be filled at deploy time.
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "serverless", ports: { "3000": {} }, env: { A: { type: "secret" } },
  }, { abortEarly: false })).rejects.toThrow(/key/);
  // Plain values may not carry a secret key.
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "serverless", ports: { "3000": {} }, env: { A: { value: "x", key: "a" } },
  }, { abortEarly: false })).rejects.toThrow(/only have a key/);
  // Connections must point at `<serviceId>.<outputKey>`.
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "serverless", ports: { "3000": {} }, env: { A: { type: "connection", value: "{hexclave.projectId}" } },
  }, { abortEarly: false })).rejects.toThrow(/service output/);
  // Env var keys must be valid POSIX-ish env var names.
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "serverless", ports: { "3000": {} }, env: { "1BAD": { value: "x" } },
  }, { abortEarly: false })).rejects.toThrow(/env var keys/);
  // The service type is required.
  await expect(deploymentServiceDefinitionSchema.validate({
    ports: { "3000": {} }, env: {},
  }, { abortEarly: false })).rejects.toThrow(/type/);
  // Ports are required — there is no sensible default to guess.
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "serverless", env: {},
  }, { abortEarly: false })).rejects.toThrow(/ports/);
  // Scaling bounds must be consistent when both are given.
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "serverless", ports: { "3000": {} }, min_instances: 3, max_instances: 1, env: {},
  }, { abortEarly: false })).rejects.toThrow(/greater than or equal to min_instances/);
  // min_instances alone is accepted — max defaults up to min so the spec stays consistent
  // (this is the case that previously slipped through validation and 400'd from the runtime).
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "serverless", ports: { "3000": {} }, min_instances: 2, env: {},
  }, { abortEarly: false })).resolves.toBeDefined();
  // Both bounds are capped at MAX_INSTANCES_PER_SERVICE, and the cap itself is
  // accepted — an off-by-one here would refuse the largest legal fleet.
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "serverless", ports: { "3000": {} }, min_instances: MAX_INSTANCES_PER_SERVICE, max_instances: MAX_INSTANCES_PER_SERVICE, env: {},
  }, { abortEarly: false })).resolves.toBeDefined();
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "serverless", ports: { "3000": {} }, min_instances: MAX_INSTANCES_PER_SERVICE + 1, env: {},
  }, { abortEarly: false })).rejects.toThrow(/min_instances/);
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "serverless", ports: { "3000": {} }, max_instances: MAX_INSTANCES_PER_SERVICE + 1, env: {},
  }, { abortEarly: false })).rejects.toThrow(/max_instances/);
  // dockerfile_path must be a normalized relative path inside the packaged
  // source — mirror of Marshal's validateServiceSpec, checked here so invalid
  // values fail at sync time instead of after an upload is consumed.
  for (const invalidDockerfilePath of [
    "../Dockerfile", "/etc/Dockerfile", ".", "./Dockerfile", "a//b",
    "docker\\Dockerfile", "Dock\terfile", "x".repeat(513),
  ]) {
    await expect(deploymentServiceDefinitionSchema.validate({
      type: "serverless", ports: { "3000": {} }, dockerfile_path: invalidDockerfilePath, env: {},
    }, { abortEarly: false })).rejects.toThrow(/dockerfile_path/);
  }
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "serverless", ports: { "3000": {} }, dockerfile_path: "docker/Dockerfile.web", env: {},
  }, { abortEarly: false })).resolves.toBeDefined();
});

import.meta.vitest?.test("a service's dev command is not part of its definition", async ({ expect }) => {
  // The dev command never leaves the deploy file (see the schema comment), so
  // a client sending one is out of date rather than merely verbose — say so
  // instead of dropping the field on the floor.
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "serverless", ports: { "3000": {} }, dev_command: "pnpm dev", env: {},
  }, { abortEarly: false })).rejects.toThrow(/must not carry a dev_command/);
});

import.meta.vitest?.test("a secret's default value is not part of its definition", async ({ expect }) => {
  // The invariant behind the dashboard's secrets page: a definition can only
  // ever say WHICH secret an env var needs, never what it falls back to. If a
  // default could be stored, "is this secret set?" would stop having a single
  // answer, which is exactly the three-way badge state this replaced.
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "serverless",
    ports: { "3000": {} },
    env: { OPENAI_API_KEY: { type: "secret", key: "OPENAI", default_value: "sk-dev" } },
  }, { abortEarly: false })).rejects.toThrow(/must not carry a default_value/);
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "serverless",
    ports: { "3000": {} },
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
