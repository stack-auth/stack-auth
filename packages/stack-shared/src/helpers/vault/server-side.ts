import {
  CreateAliasCommand,
  CreateKeyCommand,
  DecryptCommand,
  DescribeKeyCommand,
  GenerateDataKeyCommand,
  KMSClient
} from "@aws-sdk/client-kms";
import { decodeBase64, encodeBase64 } from "../../utils/bytes";
import { decrypt, encrypt } from "../../utils/crypto";
import { getEnvVariable } from "../../utils/env";
import { Result } from "../../utils/results";


async function getAwsCredentials() {
  // 1. Vercel OIDC: Vercel injects an OIDC token that can be exchanged for AWS credentials
  const vercelRoleArn = getEnvVariable("STACK_AWS_VERCEL_OIDC_ROLE_ARN", "");
  if (vercelRoleArn) {
    const { awsCredentialsProvider } = await import("@vercel/functions/oidc");
    return awsCredentialsProvider({ roleArn: vercelRoleArn });
  }

  // 2. GCP Workload Identity Federation: Cloud Run gets a GCP ID token from the metadata server,
  //    then exchanges it for temporary AWS credentials via STS AssumeRoleWithWebIdentity.
  //    Requires:
  //      - An OIDC identity provider in AWS IAM (issuer: https://accounts.google.com)
  //      - An IAM role with a trust policy allowing the GCP service account
  //      - STACK_AWS_GCP_WIF_ROLE_ARN set to that role's ARN
  //      - STACK_AWS_GCP_WIF_AUDIENCE set to the audience configured in the AWS OIDC provider
  const gcpWifRoleArn = getEnvVariable("STACK_AWS_GCP_WIF_ROLE_ARN", "");
  if (gcpWifRoleArn) {
    const { fromWebToken } = await import("@aws-sdk/credential-provider-web-identity");
    const audience = getEnvVariable("STACK_AWS_GCP_WIF_AUDIENCE", "sts.amazonaws.com");
    // Return a provider that fetches a fresh GCP ID token on each invocation.
    // GCP metadata tokens expire after ~1h, so we can't bake a single token into the closure.
    return async () => {
      return await fromWebToken({
        roleArn: gcpWifRoleArn,
        roleSessionName: "stack-backend-cloudrun",
        webIdentityToken: await fetchGcpIdToken(audience),
      })();
    };
  }

  // 3. Static credentials: fallback for self-hosted / local development
  return {
    accessKeyId: getEnvVariable("STACK_AWS_ACCESS_KEY_ID"),
    secretAccessKey: getEnvVariable("STACK_AWS_SECRET_ACCESS_KEY"),
  };
}

/**
 * Fetches a GCP ID token from the metadata server (available on Cloud Run, GCE, GKE).
 * The token is a Google-signed JWT with the specified audience, suitable for
 * AWS STS AssumeRoleWithWebIdentity.
 */
async function fetchGcpIdToken(audience: string): Promise<string> {
  const metadataUrl = `http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=${encodeURIComponent(audience)}`;
  const response = await fetch(metadataUrl, {
    headers: { "Metadata-Flavor": "Google" },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch GCP ID token: ${response.status} ${await response.text()}`);
  }
  return await response.text();
}

let kmsClientCache: KMSClient | undefined;

async function getKmsClient() {
  if (!kmsClientCache) {
    kmsClientCache = new KMSClient({
      region: getEnvVariable("STACK_AWS_REGION"),
      endpoint: getEnvVariable("STACK_AWS_KMS_ENDPOINT"),
      credentials: await getAwsCredentials(),
    });
  }
  return kmsClientCache;
}

async function getOrCreateKekId(): Promise<string> {
  const id = "alias/stack-data-vault-server-side-kek";
  const kms = await getKmsClient();
  try {
    const describeResult = await kms.send(new DescribeKeyCommand({ KeyId: id }));
    if (describeResult.KeyMetadata?.KeyId) return describeResult.KeyMetadata.KeyId;
  } catch (e) {
    if (e instanceof Error && e.name !== "NotFoundException") {
      throw e;
    }
  }
  const { KeyMetadata } = await kms.send(new CreateKeyCommand({
    KeyUsage: "ENCRYPT_DECRYPT",
    Description: "DataVault KEK"
  }));
  await kms.send(new CreateAliasCommand({ AliasName: id, TargetKeyId: KeyMetadata!.KeyId! }));
  return id;
}

async function genDEK() {
  const kekId = await getOrCreateKekId();
  const kms = await getKmsClient();
  const out = await kms.send(new GenerateDataKeyCommand({ KeyId: kekId, KeySpec: "AES_256" }));
  if (!out.Plaintext || !out.CiphertextBlob) throw new Error("GenerateDataKey failed");
  return {
    dekBytes: out.Plaintext,
    edkBytes: out.CiphertextBlob,
  };
}

async function unwrapDEK(edk_b64: string) {
  const edkBytes = decodeBase64(edk_b64);
  const kms = await getKmsClient();
  const out = await kms.send(new DecryptCommand({ CiphertextBlob: edkBytes }));
  if (!out.Plaintext) throw new Error("KMS Decrypt failed");
  return {
    dekBytes: out.Plaintext,
    edkBytes,
  };
}

export async function encryptWithKms(value: string) {
  const { dekBytes, edkBytes } = await genDEK();
  try {
    const ciphertext = await encrypt({
      purpose: "stack-data-vault-server-side-encryption",
      secret: dekBytes,
      value: new TextEncoder().encode(value),
    });
    return { edkBase64: encodeBase64(edkBytes), ciphertextBase64: encodeBase64(ciphertext) };
  } finally {
    dekBytes.fill(0);
  }
}

export async function decryptWithKms(encrypted: Awaited<ReturnType<typeof encryptWithKms>>) {
  const { dekBytes } = await unwrapDEK(encrypted.edkBase64);
  try {
    const value = Result.orThrow(await decrypt({
      purpose: "stack-data-vault-server-side-encryption",
      secret: dekBytes,
      cipher: decodeBase64(encrypted.ciphertextBase64),
    }));
    return new TextDecoder().decode(value);
  } finally {
    dekBytes.fill(0);
  }
}
