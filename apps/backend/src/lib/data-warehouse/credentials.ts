/**
 * Credential storage for data sources.
 *
 * Credentials are WRITE-ONLY by construction. They go in through
 * `encryptCredentials`, they come out only inside the sync runtime via
 * `decryptCredentials`, and no API route returns them in any form — the
 * dashboard is told whether a credential is set, never what it is. That is what
 * lets the setup wizard promise, truthfully and at the point of entry, that
 * pasted production secrets are encrypted at rest and never readable back.
 *
 * The envelope is the same KMS scheme the Data Vault uses: a per-value data key
 * encrypted under the KMS CMK, stored alongside the ciphertext.
 */
import { decryptWithKms, encryptWithKms } from "@hexclave/shared/dist/helpers/vault/server-side";
import { HexclaveAssertionError, StatusError } from "@hexclave/shared/dist/utils/errors";
import type { ConnectorConfigField } from "./catalogue/schema";

type ConfigurableConnector = { configFields: ConnectorConfigField[] };

export function getSecretConfigFields(connector: ConfigurableConnector): ConnectorConfigField[] {
  return connector.configFields.filter(field => field.secret);
}

export function getPlainConfigFields(connector: ConfigurableConnector): ConnectorConfigField[] {
  return connector.configFields.filter(field => !field.secret);
}

export type EncryptedCredentials = { edkBase64: string, ciphertextBase64: string };

export function isEncryptedCredentials(value: unknown): value is EncryptedCredentials {
  return value != null
    && typeof value === "object"
    && typeof (value as EncryptedCredentials).edkBase64 === "string"
    && typeof (value as EncryptedCredentials).ciphertextBase64 === "string";
}

export async function encryptCredentials(secrets: Record<string, string>): Promise<EncryptedCredentials> {
  return await encryptWithKms(JSON.stringify(secrets));
}

export async function decryptCredentials(encrypted: unknown): Promise<Record<string, string>> {
  if (!isEncryptedCredentials(encrypted)) {
    throw new StatusError(
      StatusError.BadRequest,
      "This data source has no stored credentials. Reconnect it to provide them again.",
    );
  }
  const plaintext = await decryptWithKms(encrypted);
  const parsed: unknown = JSON.parse(plaintext);
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HexclaveAssertionError("Decrypted data source credentials were not a JSON object");
  }
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value === "string") result[key] = value;
  }
  return result;
}

/**
 * Splits a submitted settings bundle into the parts that go to KMS and the
 * parts that stay readable in Postgres, using the connector's own declaration
 * of which fields are secret. Unknown keys are dropped rather than stored:
 * a connector's manifest is the complete list of what it can be configured
 * with, so anything else is either stale or an injection attempt.
 */
export function partitionSettings(
  connector: ConfigurableConnector,
  submitted: Record<string, string | undefined>,
): { config: Record<string, string>, secrets: Record<string, string> } {
  const config: Record<string, string> = {};
  const secrets: Record<string, string> = {};
  for (const field of connector.configFields) {
    const value = submitted[field.name];
    if (value == null || value === "") continue;
    if (field.secret) {
      secrets[field.name] = value;
    } else {
      config[field.name] = value;
    }
  }
  return { config, secrets };
}

export function assertRequiredSettingsPresent(
  connector: ConfigurableConnector,
  config: Record<string, string | undefined>,
  secrets: Record<string, string | undefined>,
): void {
  const missing = connector.configFields
    .filter(field => field.required)
    .filter(field => {
      const source = field.secret ? secrets : config;
      const value = source[field.name];
      return value == null || value === "";
    })
    .map(field => field.displayName);
  if (missing.length > 0) {
    throw new StatusError(StatusError.BadRequest, `Missing required settings: ${missing.join(", ")}.`);
  }
}

/** Names of the secret fields a source holds, for a "•••• set" style UI. */
export function describeStoredCredentials(connector: ConfigurableConnector, encrypted: unknown): {
  isSet: boolean,
  fieldNames: string[],
} {
  return {
    isSet: isEncryptedCredentials(encrypted),
    fieldNames: getSecretConfigFields(connector).map(field => field.displayName),
  };
}

import.meta.vitest?.test("settings partition by the manifest's own secret flags", ({ expect }) => {
  const connector: ConfigurableConnector = {
    configFields: [
      { name: "api_key", displayName: "API key", required: true, secret: true, type: "string", description: null },
      { name: "subdomain", displayName: "Subdomain", required: true, secret: false, type: "string", description: null },
    ],
  };
  const { config, secrets } = partitionSettings(connector, {
    api_key: "sk_test", subdomain: "acme", not_a_field: "dropped",
  });
  expect(secrets).toEqual({ api_key: "sk_test" });
  expect(config).toEqual({ subdomain: "acme" });
});

import.meta.vitest?.test("missing required settings are named, not silently accepted", ({ expect }) => {
  const connector: ConfigurableConnector = {
    configFields: [
      { name: "api_key", displayName: "API key", required: true, secret: true, type: "string", description: null },
    ],
  };
  expect(() => assertRequiredSettingsPresent(connector, {}, {})).toThrow("API key");
});
