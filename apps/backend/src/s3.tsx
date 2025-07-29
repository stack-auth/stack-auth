import { S3Client } from "@aws-sdk/client-s3";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";

export const s3 = new S3Client({
  region: getEnvVariable("STACK_S3_REGION"),
  endpoint: getEnvVariable("STACK_S3_ENDPOINT"),
  forcePathStyle: true,
  credentials: {
    accessKeyId: getEnvVariable("STACK_S3_ACCESS_KEY_ID"),
    secretAccessKey: getEnvVariable("STACK_S3_SECRET_ACCESS_KEY"),
  },
});

export const S3_BUCKET = getEnvVariable("STACK_S3_BUCKET", "stack-storage");
export const S3_ENDPOINT = getEnvVariable("STACK_S3_ENDPOINT");

export function getS3PublicUrl(key: string): string {
  return `${S3_ENDPOINT}/${S3_BUCKET}/${key}`;
}
