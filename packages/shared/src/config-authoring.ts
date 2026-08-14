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
// The author-facing shape of the deploy file's `deployment` export. These types
// are camelCase and deliberately NOT the wire shape in ./deployments (which is
// snake_case): the CLI evaluates this, validates it with precise per-field
// errors, and serializes it. They exist so `export const deployment:
// HexclaveDeploymentConfig = { ... }` gets completion and catches typos in the
// editor — the CLI still re-validates everything at runtime, because the deploy
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
  /**
   * The URL of one of the service's ports, with the scheme taken from that
   * port's `protocol` — a URL names ONE port, which is why this is a call.
   *
   * `url()` requires the target to declare exactly one HTTP port; `url(9090)`
   * names one when it declares several. A PUBLIC port resolves to the service's
   * public URL (its platform URL, or a verified custom domain); a private one
   * resolves to its private-network address.
   */
  url: (port?: number) => HexclaveDeploymentReference,
  /**
   * The service's private-network hostname, without a port. Always available,
   * including before the target has ever been deployed.
   *
   * There is deliberately no port output: its value is a number you already
   * wrote in the target's `ports`, so pair this with a literal (e.g.
   * `DATABASE_PORT: "5432"`) for raw TCP clients.
   */
  hostname: () => HexclaveDeploymentReference,
};

/** The context object passed to the `services` function. */
export type HexclaveDeploymentContext = {
  /** True during `hexclave dev`. Guard connection values with it — `service()` returns null there. */
  isDev: boolean,
  /**
   * References a project secret by key. Values are set per project under
   * Project Settings → Secrets and resolved server-side at deploy time.
   *
   * The optional default is NOT dev-only. It is never stored server-side, but it
   * travels with each deploy request and fills the secret whenever the project
   * has no stored value for that key — on production deploys as well as
   * `hexclave dev`. A key with a default is also excluded from the preflight
   * that fails a deploy on missing secrets, since it can always be satisfied.
   * Treat anything you pass here as a value you are willing to ship: to force a
   * real secret to be set, omit the default.
   */
  secret: (key: string, defaultValue?: string) => HexclaveDeploymentReference,
  /**
   * References another service of this PROJECT — service ids are unique across
   * every deployment source, so a service deployed from another repository is
   * referenced exactly like one next door. Returns null during `hexclave dev`.
   */
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

/** How one port the container listens on is exposed. */
export type HexclavePort = {
  /**
   * Exposes this port to the internet and gives the service a platform URL,
   * even without a custom domain. Defaults to false.
   *
   * A public port must be the service's ONLY port. This is a Fly.io limitation:
   * its proxy serves every declared port on every address the app has, so a
   * "private" sibling of a public port would be on the internet too. Put other
   * ports on their own service and reach them with `hostname()`.
   */
  public?: boolean,
  /**
   * "tcp" is a raw port — no TLS termination, no HTTP routing — for databases
   * and other daemons. TCP ports are private-only; reach them with `hostname()`
   * and the port number. Defaults to "http".
   */
  protocol?: "http" | "tcp",
};

type HexclaveServiceBase = {
  /**
   * The ports the container listens on, keyed by port number:
   * `ports: { 3000: { public: true }, 5432: { protocol: "tcp" } }`. The service
   * is public exactly when one of them is.
   *
   * Each port is reachable on the private network at its own number; the public
   * one is additionally served on 80/443. Note that a URL names a single port,
   * so a service with several needs `url(9090)` rather than a bare `url()`.
   *
   * Use `ports: {}` for a worker that only makes outbound connections. It gets
   * no URL and can hold no custom domain, and since the platform only wakes a
   * stopped machine on inbound traffic, it should be `type: "server"` (or a
   * "serverless" with `minInstances` above zero) or it will never run.
   */
  ports: Record<number, HexclavePort>,
  /** Source directory, relative to the deploy file. Defaults to the deploy file's own directory. */
  rootDirectory?: string,
  /** Dockerfile to build, relative to `rootDirectory`. Omit to auto-detect the build with Railpack. */
  dockerfilePath?: string,
  /** Run locally by `hexclave dev --service-id`. Never sent to the server. */
  devCommand?: string,
  /** Environment variables. Values may be literals, `null` to omit, or references from the context object. */
  env?: Record<string, HexclaveEnvVarValue>,
};

/**
 * A single always-one-instance service, and the only kind that may hold a
 * persistent volume.
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
  /**
   * 1 (the default) keeps the single instance up. 0 lets it SUSPEND when idle,
   * so it resumes with its memory intact and without a cold start on the next
   * connection — but a suspended service can only be woken by inbound traffic,
   * so a worker (`ports: {}`) needs 1.
   *
   * The Free plan requires 0.
   */
  minInstances?: 0 | 1,
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
 * The `deployment` export of a deploy file (hexclave.deploy.ts) — the services
 * deployed together by one `hexclave deploy` — or of hexclave.config.ts.
 *
 * It is a FUNCTION of the deployment context, so it can reach secrets,
 * connections and the managed backend's outputs:
 *
 * ```ts
 * // hexclave.deploy.ts
 * import type { HexclaveDeploymentConfig } from "@hexclave/js";
 *
 * // Identifies this file as a deployment source. Required here, and unique
 * // across every deploy file that deploys into the same project.
 * export const id = "backend";
 *
 * export const deployment: HexclaveDeploymentConfig = ({ secret, service, hexclave }) => ({
 *   services: {
 *     api: {
 *       type: "server",
 *       ports: { 3000: {} },
 *       persistentVolumes: { uploads: { path: "/data", sizeGb: 10 } },
 *       env: { DB_URL: service("db").url(5432), PROJECT_ID: hexclave.projectId },
 *     },
 *     web: { type: "serverless", ports: { 3000: { public: true } }, maxInstances: 3, env: { KEY: secret("API_KEY") } },
 *   },
 * });
 * ```
 *
 * Deployments normally live in their own file so that one Hexclave project can
 * be deployed from several repositories, each shipping the services it owns and
 * each deploying on its own schedule. The same export is accepted in
 * hexclave.config.ts for a project that has only one; those services belong to a
 * deployment source named after that file.
 */
export type HexclaveDeploymentConfig = (context: HexclaveDeploymentContext) => {
  services: Record<string, HexclaveService>,
};
