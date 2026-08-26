import { HexclaveAssertionError } from "@hexclave/shared/dist/utils/errors";
import { importPKCS8, SignJWT } from "jose";
import { z } from "zod";

const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_CLOUD_SCOPE = "https://www.googleapis.com/auth/cloud-platform";

const serviceAccountSchema = z.object({
  type: z.literal("service_account"),
  project_id: z.string().min(1),
  private_key: z.string().min(1),
  client_email: z.string().email(),
});

const accessTokenResponseSchema = z.object({
  access_token: z.string().min(1),
});

export type SecretMigrationResult = {
  created: string[],
  skippedExisting: string[],
  wouldCreate: string[],
};

export function getGcpSecretId(sourceSecretId: string, destinationEnvironment: "dev" | "prod"): string {
  return `hexclave-secret-${destinationEnvironment}-${sourceSecretId}`;
}

async function getGoogleAccessToken(serviceAccountJson: string): Promise<{
  accessToken: string,
  projectId: string,
}> {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(serviceAccountJson);
  } catch {
    throw new HexclaveAssertionError("The GCP secret migration service-account key is not valid JSON.");
  }

  const parsedServiceAccount = serviceAccountSchema.safeParse(parsedJson);
  if (!parsedServiceAccount.success) {
    throw new HexclaveAssertionError("The GCP secret migration service-account key is missing required fields.");
  }
  const serviceAccount = parsedServiceAccount.data;

  const nowSeconds = Math.floor(Date.now() / 1000);
  const privateKey = await importPKCS8(serviceAccount.private_key, "RS256");
  const assertion = await new SignJWT({
    scope: GOOGLE_CLOUD_SCOPE,
  })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(serviceAccount.client_email)
    .setSubject(serviceAccount.client_email)
    .setAudience(GOOGLE_OAUTH_TOKEN_URL)
    .setIssuedAt(nowSeconds)
    .setExpirationTime(nowSeconds + 60 * 5)
    .sign(privateKey);

  const tokenResponse = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!tokenResponse.ok) {
    throw new HexclaveAssertionError(`GCP rejected the migration service-account credentials with status ${tokenResponse.status}.`);
  }

  const parsedTokenResponse = accessTokenResponseSchema.safeParse(await tokenResponse.json());
  if (!parsedTokenResponse.success) {
    throw new HexclaveAssertionError("GCP returned an invalid access-token response.");
  }

  return {
    accessToken: parsedTokenResponse.data.access_token,
    projectId: serviceAccount.project_id,
  };
}

function getSecretUrl(projectId: string, secretId: string): string {
  return `https://secretmanager.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/secrets/${encodeURIComponent(secretId)}`;
}

async function secretExists(projectId: string, secretId: string, authorization: string): Promise<boolean> {
  const response = await fetch(getSecretUrl(projectId, secretId), {
    headers: { authorization },
  });
  if (response.ok) return true;
  if (response.status === 404) return false;
  throw new HexclaveAssertionError(`GCP failed to check secret ${secretId} with status ${response.status}.`);
}

async function createSecret(projectId: string, secretId: string, authorization: string): Promise<"created" | "already-exists"> {
  const response = await fetch(
    `https://secretmanager.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/secrets?secretId=${encodeURIComponent(secretId)}`,
    {
      method: "POST",
      headers: {
        authorization,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        replication: {
          automatic: {},
        },
        labels: {
          migrated_from: "vercel",
        },
      }),
    },
  );
  if (response.ok) return "created";
  if (response.status === 409) return "already-exists";
  throw new HexclaveAssertionError(`GCP failed to create secret ${secretId} with status ${response.status}.`);
}

async function addSecretVersion(projectId: string, secretId: string, value: string, authorization: string): Promise<void> {
  const response = await fetch(`${getSecretUrl(projectId, secretId)}:addVersion`, {
    method: "POST",
    headers: {
      authorization,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      payload: {
        data: Buffer.from(value, "utf8").toString("base64"),
      },
    }),
  });
  if (!response.ok) {
    throw new HexclaveAssertionError(`GCP failed to add a version to secret ${secretId} with status ${response.status}.`);
  }
}

/**
 * Existing destination secrets are deliberately left untouched. This prevents a retry or accidental
 * invocation from replacing a secret version that may already be serving the GCP deployment.
 */
export async function migrateSecretsToGcp(
  serviceAccountJson: string,
  secrets: readonly { id: string, value: string }[],
  dryRun: boolean,
  expectedProjectId: string,
): Promise<SecretMigrationResult> {
  const { accessToken, projectId } = await getGoogleAccessToken(serviceAccountJson);
  if (projectId !== expectedProjectId) {
    throw new HexclaveAssertionError(`The GCP migration service account belongs to project ${projectId}, but project ${expectedProjectId} was expected.`);
  }
  const authorization = `Bearer ${accessToken}`;
  const result: SecretMigrationResult = {
    created: [],
    skippedExisting: [],
    wouldCreate: [],
  };

  for (const secret of secrets) {
    if (await secretExists(projectId, secret.id, authorization)) {
      result.skippedExisting.push(secret.id);
      continue;
    }
    if (dryRun) {
      result.wouldCreate.push(secret.id);
      continue;
    }

    const createResult = await createSecret(projectId, secret.id, authorization);
    if (createResult === "already-exists") {
      result.skippedExisting.push(secret.id);
      continue;
    }
    await addSecretVersion(projectId, secret.id, secret.value, authorization);
    result.created.push(secret.id);
  }

  return result;
}
