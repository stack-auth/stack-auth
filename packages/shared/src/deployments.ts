// Shared shapes for the Deployments app. Service definitions used to live in
// the branch config (`deployments-alpha.services`); they now live in the
// backend database and are synced from the `services` export of
// hexclave.config.ts by `hexclave deploy`. This module is the single source of
// truth for the definition shape so the CLI (which evaluates the config file),
// the backend (which stores and deploys definitions), and the SDK (which reads
// them) cannot drift.
//
// Everything here is snake_case: these types are simultaneously the API wire
// shape and the backend's stored JSON shape, and keeping them identical avoids
// a translation layer that would have to be maintained in three places.

import * as yup from "yup";
import { PROJECT_SECRET_KEY_REGEX } from "./project-secrets";
import { yupNumber, yupObject, yupRecord, yupString } from "./schema-fields";

export const DEPLOYMENT_ENV_VAR_KEY_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;
// A connection value is `<serviceId>.<outputKey>` — a typed pointer to another
// service's output (e.g. "hexclave.projectId") that the backend resolves at
// deploy time. This is deliberately its own env var TYPE rather than a
// `{serviceId.outputKey}` interpolation syntax inside plain values: with
// interpolation, a literal value that happens to contain `{...}` would be
// misinterpreted as a reference, so plain values must stay entirely literal.
export const DEPLOYMENT_CONNECTION_VALUE_REGEX = /^[a-zA-Z0-9_-]+\.[A-Za-z0-9_]+$/;

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
// `url` is the public URL and exists only once a custom domain verifies —
// container services are private by default. `internalUrl`/`internalHost` are
// the private-network address (deterministic from the service's identity, so
// they never block a deploy) and are the normal way services talk to each
// other.
export const SERVICE_OUTPUT_KEYS = ["url", "internalUrl", "internalHost"] as const;

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
  // Which platform runs the service. Only container services (run on the
  // Fly-backed Marshal runtime) exist today, but the field is required so
  // definitions stay unambiguous once more types are added (every write path
  // must state what it's creating).
  type: "container",
  // The single HTTP port the container listens on. Readiness = the port
  // accepts connections.
  port: number,
  // Scaling bounds. 1/1 = serverful (one always-on instance, no cold starts);
  // anything else is serverless between the bounds, and min 0 scales to zero.
  // Defaults: min 0, max 1.
  min_instances?: number | undefined,
  max_instances?: number | undefined,
  // Relative to the directory containing hexclave.config.ts. Only used
  // client-side (it decides what `hexclave deploy` packages), but stored so
  // the dashboard can display it.
  root_directory?: string | undefined,
  // The Dockerfile to build from, relative to root_directory. When absent the
  // service is NOT built from a Dockerfile — the remote builder auto-detects
  // the build with Railpack (https://railpack.com) instead.
  dockerfile_path?: string | undefined,
  // A persistent disk mounted into the container. Absent = the container
  // filesystem is entirely ephemeral (the default). Requires
  // `max_instances: 1`: the underlying Fly volume is local NVMe on a single
  // host and attaches to at most one instance, so a fleet would give each
  // instance its own unreplicated copy rather than shared storage.
  volume?: DeploymentVolumeDefinition | undefined,
  env: Record<string, DeploymentEnvVarDefinition>,
};

// `path` is where the disk is mounted inside the container; `size_gb` is the
// provisioned size, which can be grown on a later deploy but never shrunk.
export type DeploymentVolumeDefinition = {
  path: string,
  size_gb: number,
};

export const MIN_VOLUME_SIZE_GB = 1;
export const MAX_VOLUME_SIZE_GB = 500;

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
    ? schema.defined().matches(PROJECT_SECRET_KEY_REGEX, "project secret keys must contain only letters, numbers, underscores, and hyphens")
    : schema.oneOf([undefined], 'deployment env vars may only have a key when their type is "secret"')),
  // `secret(key, default)` fallbacks are a config-file concept that must never
  // be persisted: they travel with the deploy request instead (see
  // deploymentSecretDefaultsSchema). Rejected rather than ignored — this is
  // the schema every write path validates against, so refusing the field here
  // is what makes "a stored definition cannot contain a default" a checkable
  // property instead of a convention. (yupRecord validates values without
  // casting them, so a `.strip()` here would be a silent no-op.)
  default_value: yupString().oneOf([undefined], "deployment env var definitions must not carry a default_value — secret defaults belong to the deploy request, not to the stored definition"),
});

// Fallback values for a service's `secret()` env vars, sent with a DEPLOY
// request and never stored: they are the second argument of `secret(key,
// default)` in the config file's `services` export, which is a purely
// author-side convenience. Keyed by ENV VAR key (not secret key) because
// that's where the default is written — the same secret may be referenced by
// two env vars with different defaults, and the dashboard must never learn
// that any of this exists.
export const deploymentSecretDefaultsSchema = yupRecord(
  yupString().matches(DEPLOYMENT_ENV_VAR_KEY_REGEX, "deployment secret default keys must be env var keys"),
  yupString().defined(),
);

export const deploymentServiceDefinitionSchema = yupObject({
  type: yupString().oneOf(["container"]).defined(),
  port: yupNumber().integer().min(1).max(65535).defined(),
  // min is capped at the same MAX_INSTANCES_CAP (5) as max — an unbounded min would only
  // ever fail downstream.
  min_instances: yupNumber().integer().min(0).max(5).optional(),
  max_instances: yupNumber().integer().min(1).max(5).optional()
    // Compare EFFECTIVE bounds, not just when both are present: `min_instances` alone (no
    // max) defaults max to 1 downstream, so `min: 2` with no max is an invalid spec that
    // must be caught here — otherwise Marshal 400s it after the upload is consumed.
    .test("max-gte-min", "max_instances must be greater than or equal to min_instances (max_instances defaults to 1)", function (value) {
      const minInstances = (this.parent as { min_instances?: number }).min_instances ?? 0;
      const effectiveMax = value ?? Math.max(minInstances, 1);
      return effectiveMax >= minInstances;
    }),
  root_directory: yupString().optional(),
  // Persistent disk. The rules here must be AT LEAST as strict as Marshal's
  // validateServiceSpec so nothing reaches the runtime that it would reject
  // after an upload has already been consumed.
  volume: yupObject({
    // A normalized ABSOLUTE mount point. Relative paths are ambiguous against
    // the image's WORKDIR, and mounting over "/" would shadow the whole image.
    path: yupString().defined().max(512)
      // `path` is `.defined()`, so unlike the optional `dockerfile_path` above
      // there is no undefined case to let through here.
      .test("absolute-path", 'volume.path must be a normalized absolute path inside the container (e.g. "/data") — no trailing slash, no "." or ".." segments, no backslashes or control characters', (value) =>
        value.startsWith("/")
        && value !== "/"
        && !value.endsWith("/")
        && !value.includes("\\")
        // eslint-disable-next-line no-control-regex
        && !/[\x00-\x1f]/.test(value)
        && value.split("/").slice(1).every((segment) => segment !== "" && segment !== "." && segment !== "..")),
    size_gb: yupNumber().integer().min(MIN_VOLUME_SIZE_GB).max(MAX_VOLUME_SIZE_GB).defined(),
  }).optional().default(undefined)
    // Compares the EFFECTIVE max (same defaulting as `max_instances` above), so
    // `min_instances: 2` with no explicit max is caught too.
    .test("volume-requires-single-instance", "a service with a volume must have max_instances: 1 — a volume is local disk on one host and can only be attached to a single instance", function (value) {
      if (value === undefined) return true;
      const parent = this.parent as { min_instances?: number, max_instances?: number };
      const effectiveMax = parent.max_instances ?? Math.max(parent.min_instances ?? 0, 1);
      return effectiveMax === 1;
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
  // reads it straight out of the local config file, and the backend never acts
  // on it, so it is never sent and never stored. Rejected rather than simply
  // absent because yupRecord re-validates its values in a fresh validation
  // whose path no longer starts with "body" — the route handler's
  // unknown-property check therefore does NOT reach inside `services`, so an
  // omitted field would be silently dropped instead of reported (same reason
  // `default_value` below is spelled out).
  dev_command: yupString().oneOf([undefined], "deployment service definitions must not carry a dev_command — the dev command stays in your config file and is never sent to the server (upgrade your Hexclave CLI if this came from `hexclave deploy`)"),
  env: yupRecord(
    yupString().matches(DEPLOYMENT_ENV_VAR_KEY_REGEX, "deployment env var keys must start with a letter or underscore and contain only letters, digits, and underscores"),
    deploymentEnvVarSchema.defined(),
  ).defined(),
});

import.meta.vitest?.test("deploymentServiceDefinitionSchema accepts all env var shapes", async ({ expect }) => {
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "container",
    port: 3000,
    min_instances: 0,
    max_instances: 2,
    root_directory: "./",
    dockerfile_path: "docker/Dockerfile.web",
    env: {
      MY_ENV_VAR: { value: "true" },
      DATABASE_CONNECTION_STRING: { type: "secret", key: "db_connection" },
      OPENAI_API_KEY: { type: "secret", key: "OPENAI" },
      NEXT_PUBLIC_HEXCLAVE_PROJECT_ID: { type: "connection", value: "hexclave.projectId" },
      API_INTERNAL_URL: { type: "connection", value: "api.internalUrl" },
    },
  }, { abortEarly: false })).resolves.toBeDefined();
});

import.meta.vitest?.test("deploymentServiceDefinitionSchema accepts a volume on a single-instance service", async ({ expect }) => {
  // Explicit 1/1 (serverful) and the default 0/1 (scales to zero, volume kept
  // across the stop) are both single-instance and therefore both valid.
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "container", port: 3000, min_instances: 1, max_instances: 1,
    volume: { path: "/data", size_gb: 10 }, env: {},
  }, { abortEarly: false })).resolves.toBeDefined();
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "container", port: 3000, volume: { path: "/var/lib/app/data", size_gb: 1 }, env: {},
  }, { abortEarly: false })).resolves.toBeDefined();
});

import.meta.vitest?.test("deploymentServiceDefinitionSchema rejects volumes that cannot work", async ({ expect }) => {
  for (const scaling of [{ max_instances: 2 }, { min_instances: 2 }, { min_instances: 0, max_instances: 3 }]) {
    await expect(deploymentServiceDefinitionSchema.validate({
      type: "container", port: 3000, ...scaling, volume: { path: "/data", size_gb: 1 }, env: {},
    }, { abortEarly: false })).rejects.toThrow(/must have max_instances: 1/);
  }
  for (const badPath of ["data", "/", "/data/", "/data/../etc", "/data/./x", "/da\\ta", "/da\u0000ta"]) {
    await expect(deploymentServiceDefinitionSchema.validate({
      type: "container", port: 3000, volume: { path: badPath, size_gb: 1 }, env: {},
    }, { abortEarly: false })).rejects.toThrow(/normalized absolute path/);
  }
  // Anchored to the size field: a bare toThrow() would still pass if the size
  // bounds regressed and some unrelated rule happened to reject the shape.
  for (const badSize of [0, -1, 501, 1.5]) {
    await expect(deploymentServiceDefinitionSchema.validate({
      type: "container", port: 3000, volume: { path: "/data", size_gb: badSize }, env: {},
    }, { abortEarly: false })).rejects.toThrow(/size_gb/);
  }
});

import.meta.vitest?.test("deploymentServiceDefinitionSchema rejects invalid shapes", async ({ expect }) => {
  // A secret with an inline value would defeat the whole point of secrets.
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "container", port: 3000, env: { A: { type: "secret", key: "a", value: "leaked" } },
  }, { abortEarly: false })).rejects.toThrow(/must not have a value/);
  // A secret without a key can never be filled at deploy time.
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "container", port: 3000, env: { A: { type: "secret" } },
  }, { abortEarly: false })).rejects.toThrow(/key/);
  // Plain values may not carry a secret key.
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "container", port: 3000, env: { A: { value: "x", key: "a" } },
  }, { abortEarly: false })).rejects.toThrow(/only have a key/);
  // Connections must point at `<serviceId>.<outputKey>`.
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "container", port: 3000, env: { A: { type: "connection", value: "{hexclave.projectId}" } },
  }, { abortEarly: false })).rejects.toThrow(/service output/);
  // Env var keys must be valid POSIX-ish env var names.
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "container", port: 3000, env: { "1BAD": { value: "x" } },
  }, { abortEarly: false })).rejects.toThrow(/env var keys/);
  // The service type is required.
  await expect(deploymentServiceDefinitionSchema.validate({
    port: 3000, env: {},
  }, { abortEarly: false })).rejects.toThrow(/type/);
  // The port is required — there is no sensible default to guess.
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "container", env: {},
  }, { abortEarly: false })).rejects.toThrow(/port/);
  // Scaling bounds must be consistent when both are given.
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "container", port: 3000, min_instances: 3, max_instances: 1, env: {},
  }, { abortEarly: false })).rejects.toThrow(/greater than or equal to min_instances/);
  // min_instances alone is accepted — max defaults up to min so the spec stays consistent
  // (this is the case that previously slipped through validation and 400'd from the runtime).
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "container", port: 3000, min_instances: 2, env: {},
  }, { abortEarly: false })).resolves.toBeDefined();
  // Both bounds are capped at 5.
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "container", port: 3000, min_instances: 6, env: {},
  }, { abortEarly: false })).rejects.toThrow(/min_instances/);
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "container", port: 3000, max_instances: 6, env: {},
  }, { abortEarly: false })).rejects.toThrow(/max_instances/);
  // dockerfile_path must be a normalized relative path inside the packaged
  // source — mirror of Marshal's validateServiceSpec, checked here so invalid
  // values fail at sync time instead of after an upload is consumed.
  for (const invalidDockerfilePath of [
    "../Dockerfile", "/etc/Dockerfile", ".", "./Dockerfile", "a//b",
    "docker\\Dockerfile", "Dock\terfile", "x".repeat(513),
  ]) {
    await expect(deploymentServiceDefinitionSchema.validate({
      type: "container", port: 3000, dockerfile_path: invalidDockerfilePath, env: {},
    }, { abortEarly: false })).rejects.toThrow(/dockerfile_path/);
  }
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "container", port: 3000, dockerfile_path: "docker/Dockerfile.web", env: {},
  }, { abortEarly: false })).resolves.toBeDefined();
});

import.meta.vitest?.test("a service's dev command is not part of its definition", async ({ expect }) => {
  // The dev command never leaves the config file (see the schema comment), so
  // a client sending one is out of date rather than merely verbose — say so
  // instead of dropping the field on the floor.
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "container", port: 3000, dev_command: "pnpm dev", env: {},
  }, { abortEarly: false })).rejects.toThrow(/must not carry a dev_command/);
});

import.meta.vitest?.test("a secret's default value is not part of its definition", async ({ expect }) => {
  // The invariant behind the dashboard's secrets page: a definition can only
  // ever say WHICH secret an env var needs, never what it falls back to. If a
  // default could be stored, "is this secret set?" would stop having a single
  // answer, which is exactly the three-way badge state this replaced.
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "container",
    port: 3000,
    env: { OPENAI_API_KEY: { type: "secret", key: "OPENAI", default_value: "sk-dev" } },
  }, { abortEarly: false })).rejects.toThrow(/must not carry a default_value/);
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "container",
    port: 3000,
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
