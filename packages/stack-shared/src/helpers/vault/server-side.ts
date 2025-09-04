import {
  CreateAliasCommand,
  CreateKeyCommand,
  DecryptCommand,
  DescribeKeyCommand,
  GenerateDataKeyCommand,
  KMSClient
} from "@aws-sdk/client-kms";
import { awsCredentialsProvider } from '@vercel/functions/oidc';
import { decodeBase64, encodeBase64 } from "../../utils/bytes";
import { decrypt, encrypt } from "../../utils/crypto";
import { getEnvVariable } from "../../utils/env";
import { Result } from "../../utils/results";


function getKmsClient() {
  const roleArn = getEnvVariable("STACK_AWS_VERCEL_OIDC_ROLE_ARN", "");
  return new KMSClient({
    region: getEnvVariable("STACK_AWS_REGION"),
    endpoint: getEnvVariable("STACK_AWS_KMS_ENDPOINT"),
    credentials: roleArn ? awsCredentialsProvider({
      roleArn,
    }) : {
      accessKeyId: getEnvVariable("STACK_AWS_ACCESS_KEY_ID"),
      secretAccessKey: getEnvVariable("STACK_AWS_SECRET_ACCESS_KEY"),
    },
  });
}

async function getOrCreateKekId(): Promise<string> {
  const id = "alias/stack-data-vault-server-side-kek";
  const kms = getKmsClient();
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
  const kms = getKmsClient();
  const out = await kms.send(new GenerateDataKeyCommand({ KeyId: kekId, KeySpec: "AES_256" }));
  if (!out.Plaintext || !out.CiphertextBlob) throw new Error("GenerateDataKey failed");
  return {
    dekBytes: out.Plaintext,
    edkBytes: out.CiphertextBlob,
  };
}

async function unwrapDEK(edk_b64: string) {
  const edkBytes = decodeBase64(edk_b64);
  const kms = getKmsClient();
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
