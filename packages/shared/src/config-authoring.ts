import type { BranchConfigNormalizedOverride } from "./config/schema";

type StackConfigObject = BranchConfigNormalizedOverride;
export const showOnboardingHexclaveConfigValue = "show-onboarding";
/** @deprecated Use `HexclaveConfig` from the `@hexclave/*` package instead — same symbol, new brand name. See https://docs.hexclave.com/migration. */
export type StackConfig = StackConfigObject | typeof showOnboardingHexclaveConfigValue;

// Hexclave alias — same shape, declared separately so it doesn't inherit the deprecation tag.
export type HexclaveConfig = StackConfigObject | typeof showOnboardingHexclaveConfigValue;

type StrictConfigShape<Actual, Expected> =
  Expected extends readonly unknown[]
      ? Actual extends readonly unknown[]
      ? { [K in keyof Actual]: K extends keyof Expected ? StrictConfigShape<Actual[K], Expected[K]> : never }
        : Actual
    : Expected extends object
        ? Actual extends object
        ? Exclude<keyof Actual, keyof Expected> extends never
          ? { [K in keyof Actual]: K extends keyof Expected ? StrictConfigShape<Actual[K], Expected[K]> : never }
            : never
          : Actual
        : Actual;

type StrictStackConfig<T extends StackConfig> =
  T extends StackConfigObject
    ? T & StrictConfigShape<T, StackConfigObject>
    : T;

/** @deprecated Use `defineHexclaveConfig` from the `@hexclave/*` package instead — same symbol, new brand name. See https://docs.hexclave.com/migration. */
export function defineStackConfig(config: StrictStackConfig<StackConfig>): StackConfig {
  return config;
}

/**
 * Defines a Hexclave project configuration as code. See the documentation at https://skill.hexclave.com for more information.
 */
export function defineHexclaveConfig(config: StrictStackConfig<HexclaveConfig>): HexclaveConfig {
  return config;
}

// ============================ deployments ============================
// The author-facing shape of the config file's `deployment` export. These types
// are camelCase and deliberately NOT the wire shape in ./deployments (which is
// snake_case): the CLI evaluates this, validates it with precise per-field
// errors, and serializes it. They exist so `export const deployment:
// HexclaveDeploymentConfig = { ... }` gets completion and catches typos in the
// editor — the CLI still re-validates everything at runtime, because the config
// file is arbitrary user TypeScript that may not be typechecked at all.

/** The value of one env var: a literal, `null` to omit it, or a reference from the context object. */
export type HexclaveEnvVarValue = string | null | undefined | HexclaveDeploymentReference;

/**
 * An opaque reference produced by `secret()`, `service(...).<output>`, or
 * `hexclave.<output>`. It has no usable members: references must be assigned as
 * the WHOLE value of an env var, never interpolated into a string.
 */
// Not exported: it has no runtime value, so exporting it would put a name in the
// package's declarations that resolves to nothing at run time (`undefined` under
// CJS, a link error under ESM). The alias below is what consumers use.
declare const hexclaveDeploymentReference: unique symbol;
export type HexclaveDeploymentReference = { readonly [hexclaveDeploymentReference]: true };

/** The outputs another service exposes to `service("id").<output>`. */
export type HexclaveServiceOutputs = {
  /** The public URL. Only resolves once the service has a public port or a custom domain verifies. */
  url: HexclaveDeploymentReference,
  /**
   * The private-network URL, including the port — a URL names ONE port, which is
   * why this is a call rather than a value.
   *
   * `internalUrl()` requires the target to declare exactly one HTTP port.
   * `internalUrl(9090)` names one when it declares several; the port must exist
   * on the target and speak HTTP.
   */
  internalUrl: (port?: number) => HexclaveDeploymentReference,
  /**
   * The private-network host, without a port. Always available.
   *
   * There is deliberately no `internalPort`: its value is a number you already
   * wrote in the target's `ports`, so pair this with a literal (e.g.
   * `DATABASE_PORT: "5432"`) for raw TCP clients.
   */
  internalHost: HexclaveDeploymentReference,
};

/** The context object passed to the `services` function. */
export type HexclaveDeploymentContext = {
  /** True during `hexclave dev`. Guard connection values with it — `service()` returns null there. */
  isDev: boolean,
  /** References a project secret by key. The optional default is used by `hexclave dev` only and is never stored server-side. */
  secret: (key: string, defaultValue?: string) => HexclaveDeploymentReference,
  /** References another service in this deployment. Returns null during `hexclave dev`. */
  service: (serviceId: string) => HexclaveServiceOutputs,
  /** The managed Hexclave backend's outputs. */
  hexclave: {
    projectId: HexclaveDeploymentReference,
    apiUrl: HexclaveDeploymentReference,
    jwksUrl: HexclaveDeploymentReference,
    publishableClientKey: HexclaveDeploymentReference,
    secretServerKey: HexclaveDeploymentReference,
  },
};

/** One persistent disk. `sizeGb` can be grown on a later deploy but never shrunk. */
export type HexclavePersistentVolume = {
  /** Absolute, normalized mount point inside the container, e.g. "/data". */
  path: string,
  /** Provisioned size in whole gigabytes (1–500). */
  sizeGb: number,
};

/** One port the container listens on. */
export type HexclavePort = {
  /** The port number the container listens on. */
  port: number,
  /**
   * Exposes this port to the internet and gives the service a platform URL,
   * even without a custom domain. Defaults to false.
   *
   * At most one port per service may be public: a hostname's 80/443 reach only
   * one of them, so a second public port could never be served on the standard
   * ports.
   */
  public?: boolean,
  /**
   * "tcp" is a raw port — no TLS termination, no HTTP routing — for databases
   * and other daemons. TCP ports are private-only; reach them with
   * `internalHost` and the port number. Defaults to "http".
   */
  transport?: "http" | "tcp",
};

type HexclaveServiceBase = {
  /**
   * The ports the container listens on, at least one. The service is public
   * exactly when one of these is.
   *
   * Each port is reachable on the private network at its own number; the public
   * one is additionally served on 80/443. Note that a URL names a single port,
   * so a service with several needs `internalUrl(9090)` rather than a bare
   * `internalUrl()`.
   */
  ports: HexclavePort[],
  /** Source directory, relative to the config file. Defaults to the config file's own directory. */
  rootDirectory?: string,
  /** Dockerfile to build, relative to `rootDirectory`. Omit to auto-detect the build with Railpack. */
  dockerfilePath?: string,
  /** Run locally by `hexclave dev --service-id`. Never sent to the server. */
  devCommand?: string,
  /** Environment variables. Values may be literals, `null` to omit, or references from the context object. */
  env?: Record<string, HexclaveEnvVarValue>,
};

/**
 * A single always-one-instance service. It SUSPENDS when idle rather than
 * stopping, so it resumes with its memory intact, and it is the only kind of
 * service that may hold a persistent volume.
 */
export type HexclaveServerService = HexclaveServiceBase & {
  type: "server",
  /**
   * Persistent disks keyed by volume id. At most one is supported today.
   *
   * The id names the disk within this service. Moving it to another service (or
   * renaming this one) does NOT move the data — the new service gets an empty
   * disk and the old one is stranded, detached and still billed. Copy the data
   * out and back if you need to move it.
   */
  persistentVolumes?: Record<string, HexclavePersistentVolume>,
  /** Always 0 for a server; it holds one instance that suspends when idle. */
  minInstances?: 0,
  /** Always 1 for a server. Use `type: "serverless"` to scale out. */
  maxInstances?: 1,
};

/**
 * A service that scales between `minInstances` and `maxInstances` and STOPS on
 * scale-down, so every start is a cold start. It cannot hold a persistent
 * volume: each instance would get its own separate disk.
 */
export type HexclaveServerlessService = HexclaveServiceBase & {
  type: "serverless",
  /** Lower scaling bound, 0–5. Defaults to 0 (scales to zero). */
  minInstances?: number,
  /** Upper scaling bound, 1–5. Defaults to 1. */
  maxInstances?: number,
};

export type HexclaveService = HexclaveServerService | HexclaveServerlessService;

/**
 * The config file's `deployment` export — the services deployed together by one
 * `hexclave deploy`.
 *
 * `services` is usually a function so it can reach secrets, connections, and
 * the managed backend's outputs; a plain record is accepted when none of those
 * are needed.
 *
 * ```ts
 * export const deployment: HexclaveDeploymentConfig = {
 *   services: ({ secret, service, hexclave }) => ({
 *     api: {
 *       type: "server",
 *       ports: [{ port: 3000 }],
 *       persistentVolumes: { uploads: { path: "/data", sizeGb: 10 } },
 *       env: { DB_URL: service("db").internalUrl(), PROJECT_ID: hexclave.projectId },
 *     },
 *     web: { type: "serverless", ports: [{ port: 3000, public: true }], maxInstances: 3, env: { KEY: secret("API_KEY") } },
 *   }),
 * };
 * ```
 */
export type HexclaveDeploymentConfig = {
  services:
    | Record<string, HexclaveService>
    | ((context: HexclaveDeploymentContext) => Record<string, HexclaveService>),
};
