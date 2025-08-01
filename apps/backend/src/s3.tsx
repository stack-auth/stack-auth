import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { StackAssertionError, StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { ImageProcessingError, parseBase64Image } from "./lib/images";

const S3_REGION = getEnvVariable("STACK_S3_REGION", "");
const S3_ENDPOINT = getEnvVariable("STACK_S3_ENDPOINT", "");
const S3_PUBLIC_ENDPOINT = getEnvVariable("STACK_S3_PUBLIC_ENDPOINT", "");
const S3_BUCKET = getEnvVariable("STACK_S3_BUCKET", "");
const S3_ACCESS_KEY_ID = getEnvVariable("STACK_S3_ACCESS_KEY_ID", "");
const S3_SECRET_ACCESS_KEY = getEnvVariable("STACK_S3_SECRET_ACCESS_KEY", "");

const HAS_S3 = !!S3_REGION && !!S3_ENDPOINT && !!S3_BUCKET && !!S3_ACCESS_KEY_ID && !!S3_SECRET_ACCESS_KEY;

if (!HAS_S3) {
  console.warn("S3 bucket is not configured. File upload features will not be available.");
}

const s3Client = HAS_S3 ? new S3Client({
  region: S3_REGION,
  endpoint: S3_ENDPOINT,
  forcePathStyle: true,
  credentials: {
    accessKeyId: S3_ACCESS_KEY_ID,
    secretAccessKey: S3_SECRET_ACCESS_KEY,
  },
}) : undefined;

export function getS3PublicUrl(key: string): string {
  if (S3_PUBLIC_ENDPOINT) {
    return `${S3_PUBLIC_ENDPOINT}/${key}`;
  } else {
    return `${S3_ENDPOINT}/${S3_BUCKET}/${key}`;
  }
}

async function uploadBase64Image({
  input,
  maxBytes = 1_000_000, // 1MB
  folderName,
}: {
  input: string,
  maxBytes?: number,
  folderName: string,
}) {
  if (!s3Client) {
    throw new StackAssertionError("S3 is not configured");
  }

  let buffer: Buffer;
  let format: string;
  try {
    const result = await parseBase64Image(input, { maxBytes });
    buffer = result.buffer;
    format = result.metadata.format;
  } catch (error) {
    if (error instanceof ImageProcessingError) {
      throw new StatusError(StatusError.BadRequest, error.message);
    }
    throw error;
  }

  const key = `${folderName}/${crypto.randomUUID()}.${format}`;

  const command = new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
    Body: buffer,
  });

  await s3Client.send(command);

  return {
    key,
    url: getS3PublicUrl(key),
  };
}

export function checkImageString(input: string) {
  return {
    isBase64Image: /^data:image\/[a-zA-Z0-9]+;base64,/.test(input),
    isUrl: /^https?:\/\//.test(input),
  };
}

export async function uploadAndGetUrl(
  input: string | null | undefined,
  folderName: 'user-profile-images' | 'team-profile-images' | 'team-member-profile-images' | 'project-logos'
) {
  if (input) {
    const checkResult = checkImageString(input);
    if (checkResult.isBase64Image) {
      const { url } = await uploadBase64Image({ input, folderName });
      return url;
    } else if (checkResult.isUrl) {
      return input;
    } else {
      throw new StatusError(StatusError.BadRequest, "Invalid profile image URL");
    }
  } else if (input === null) {
    return null;
  } else {
    return undefined;
  }
}
