import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { parseBase64Image } from "./lib/images";

export const s3 = new S3Client({
  region: getEnvVariable("STACK_S3_REGION"),
  endpoint: getEnvVariable("STACK_S3_ENDPOINT"),
  forcePathStyle: true,
  credentials: {
    accessKeyId: getEnvVariable("STACK_S3_ACCESS_KEY_ID"),
    secretAccessKey: getEnvVariable("STACK_S3_SECRET_ACCESS_KEY"),
  },
});

export const S3_BUCKET = getEnvVariable("STACK_S3_BUCKET");
export const S3_ENDPOINT = getEnvVariable("STACK_S3_ENDPOINT");

export function getS3PublicUrl(key: string): string {
  return `${S3_ENDPOINT}/${S3_BUCKET}/${key}`;
}

export async function uploadBase64Image({
  input,
  maxBytes = 1024 * 300,
  folderName,
}: {
  input: string,
  maxBytes?: number,
  folderName: string,
}) {
  const { buffer, metadata } = await parseBase64Image(input, { maxBytes });

  const key = `${folderName}/${crypto.randomUUID()}.${metadata.format}`;

  const command = new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
    Body: buffer,
  });

  await s3.send(command);

  return {
    key,
    url: getS3PublicUrl(key),
  };
}

export function checkImageString(input: string) {
  return {
    isBase64Image: /^data:image\/[a-z]+;base64,/.test(input),
    isUrl: /^https?:\/\//.test(input),
  };
}

export async function uploadAndGetImageUpdateInfo(
  input: string | null | undefined,
  folderName: 'user-profile-images' | 'team-profile-images' | 'team-member-profile-images'
) {
  let profileImageKey: string | null | undefined = undefined;
  let profileImageUrl: string | null | undefined = undefined;
  if (input) {
    const checkResult = checkImageString(input);
    if (checkResult.isBase64Image) {
      const { key } = await uploadBase64Image({ input, folderName });
      profileImageKey = key;
    } else if (checkResult.isUrl) {
      profileImageUrl = input;
    } else {
      throw new StatusError(StatusError.BadRequest, "Invalid profile image URL");
    }

    return {
      profileImageKey,
      profileImageUrl,
    };
  } else if (input === null) {
    return {
      profileImageKey: null,
      profileImageUrl: null,
    };
  } else {
    return {
      profileImageKey: undefined,
      profileImageUrl: undefined,
    };
  }
}
