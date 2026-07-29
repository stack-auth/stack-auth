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
import { yupObject, yupRecord, yupString } from "./schema-fields";

export const DEPLOYMENT_ENV_VAR_KEY_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const DEPLOYMENT_SECRET_KEY_REGEX = /^[a-zA-Z0-9_-]+$/;
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
export const SERVICE_OUTPUT_KEYS = ["url"] as const;

export type HexclaveOutputKey = typeof HEXCLAVE_OUTPUT_KEYS[number];
export type ServiceOutputKey = typeof SERVICE_OUTPUT_KEYS[number];

// One env var, discriminated by `type`:
// - absent (plain): a literal `value`.
// - "secret": only the secret's name (`key`) and an optional `default_value`
//   are in the definition; the actual value is stored per project in the
//   dashboard (Project Settings → Secrets) and read at deploy time. A secret
//   with neither a stored value nor a default fails the deploy.
// - "connection": `value` names another service's output (see the regex
//   comment above); resolved server-side at deploy time.
export type DeploymentEnvVarDefinition = {
  type?: "secret" | "connection" | undefined,
  value?: string | undefined,
  key?: string | undefined,
  default_value?: string | undefined,
};

export type DeploymentServiceDefinition = {
  // Which platform runs the service. Only Vercel-backed services exist today,
  // but the field is required so definitions stay unambiguous once more types
  // are added (every write path must state what it's creating).
  type: "vercel",
  framework?: string | undefined,
  install_command?: string | undefined,
  build_command?: string | undefined,
  output_directory?: string | undefined,
  // Relative to the directory containing hexclave.config.ts. Only used
  // client-side (it decides what `hexclave deploy` packages), but stored so
  // the dashboard can display it.
  root_directory?: string | undefined,
  // The command `hexclave dev --service-id <id>` runs for this service.
  dev_command?: string | undefined,
  env: Record<string, DeploymentEnvVarDefinition>,
};

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
    ? schema.defined().matches(DEPLOYMENT_SECRET_KEY_REGEX, "deployment secret keys must contain only letters, numbers, underscores, and hyphens")
    : schema.oneOf([undefined], 'deployment env vars may only have a key when their type is "secret"')),
  default_value: yupString().when("type", ([type], schema) => type === "secret"
    ? schema.optional()
    : schema.oneOf([undefined], 'deployment env vars may only have a default_value when their type is "secret"')),
});

export const deploymentServiceDefinitionSchema = yupObject({
  type: yupString().oneOf(["vercel"]).defined(),
  framework: yupString().optional(),
  install_command: yupString().optional(),
  build_command: yupString().optional(),
  output_directory: yupString().optional(),
  root_directory: yupString().optional(),
  dev_command: yupString().optional(),
  env: yupRecord(
    yupString().matches(DEPLOYMENT_ENV_VAR_KEY_REGEX, "deployment env var keys must start with a letter or underscore and contain only letters, digits, and underscores"),
    deploymentEnvVarSchema.defined(),
  ).defined(),
});

import.meta.vitest?.test("deploymentServiceDefinitionSchema accepts all env var shapes", async ({ expect }) => {
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "vercel",
    root_directory: "./",
    framework: "nextjs",
    dev_command: "pnpm dev",
    env: {
      MY_ENV_VAR: { value: "true" },
      DATABASE_CONNECTION_STRING: { type: "secret", key: "db_connection" },
      OPENAI_API_KEY: { type: "secret", key: "OPENAI", default_value: "sk-dev" },
      NEXT_PUBLIC_HEXCLAVE_PROJECT_ID: { type: "connection", value: "hexclave.projectId" },
    },
  }, { abortEarly: false })).resolves.toBeDefined();
});

import.meta.vitest?.test("deploymentServiceDefinitionSchema rejects invalid shapes", async ({ expect }) => {
  // A secret with an inline value would defeat the whole point of secrets.
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "vercel", env: { A: { type: "secret", key: "a", value: "leaked" } },
  }, { abortEarly: false })).rejects.toThrow(/must not have a value/);
  // A secret without a key can never be filled at deploy time.
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "vercel", env: { A: { type: "secret" } },
  }, { abortEarly: false })).rejects.toThrow(/key/);
  // Plain values may not carry a secret key or default.
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "vercel", env: { A: { value: "x", key: "a" } },
  }, { abortEarly: false })).rejects.toThrow(/only have a key/);
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "vercel", env: { A: { value: "x", default_value: "y" } },
  }, { abortEarly: false })).rejects.toThrow(/only have a default_value/);
  // Connections must point at `<serviceId>.<outputKey>`.
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "vercel", env: { A: { type: "connection", value: "{hexclave.projectId}" } },
  }, { abortEarly: false })).rejects.toThrow(/service output/);
  // Env var keys must be valid POSIX-ish env var names.
  await expect(deploymentServiceDefinitionSchema.validate({
    type: "vercel", env: { "1BAD": { value: "x" } },
  }, { abortEarly: false })).rejects.toThrow(/env var keys/);
  // The service type is required.
  await expect(deploymentServiceDefinitionSchema.validate({
    framework: "nextjs", env: {},
  }, { abortEarly: false })).rejects.toThrow(/type/);
});

// Type-level check that the yup schema stays assignable to the hand-written
// definition type (yup's InferType makes optional fields `| undefined`, which
// matches under exactOptionalPropertyTypes only if the shapes agree).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _assertEnvVarSchemaMatchesType: DeploymentEnvVarDefinition = undefined as unknown as yup.InferType<typeof deploymentEnvVarSchema>;
