import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client, S3ServiceException } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import { HexclaveAssertionError, StatusError } from "@hexclave/shared/dist/utils/errors";
import { ImageProcessingError, parseBase64Image } from "./lib/images";

const S3_REGION = getEnvVariable("STACK_S3_REGION", "");
const S3_ENDPOINT = getEnvVariable("STACK_S3_ENDPOINT", "");
const S3_PUBLIC_ENDPOINT = getEnvVariable("STACK_S3_PUBLIC_ENDPOINT", "");
const S3_BUCKET = getEnvVariable("STACK_S3_BUCKET", "");
const S3_PRIVATE_BUCKET = getEnvVariable("STACK_S3_PRIVATE_BUCKET", "");
const S3_ACCESS_KEY_ID = getEnvVariable("STACK_S3_ACCESS_KEY_ID", "");
const S3_SECRET_ACCESS_KEY = getEnvVariable("STACK_S3_SECRET_ACCESS_KEY", "");

const HAS_S3 = !!S3_REGION && !!S3_ENDPOINT && !!S3_BUCKET && !!S3_ACCESS_KEY_ID && !!S3_SECRET_ACCESS_KEY;

if (!HAS_S3) {
  console.warn("S3 bucket is not configured. File upload features will not be available.");
}

if (HAS_S3 && !S3_PRIVATE_BUCKET) {
  console.warn("S3 private bucket is not configured (STACK_S3_PRIVATE_BUCKET). Session recordings and deployment source uploads will not be available.");
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

export async function uploadBytes(options: {
  key: string,
  body: Uint8Array,
  contentType?: string,
  contentEncoding?: string,
  private?: boolean,
}) {
  if (!s3Client) {
    throw new HexclaveAssertionError("S3 is not configured");
  }

  const bucket = options.private ? S3_PRIVATE_BUCKET : S3_BUCKET;
  if (!bucket) {
    throw new HexclaveAssertionError(options.private ? "S3 private bucket is not configured" : "S3 bucket is not configured");
  }

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: options.key,
    Body: options.body,
    ...(options.contentType ? { ContentType: options.contentType } : {}),
    ...(options.contentEncoding ? { ContentEncoding: options.contentEncoding } : {}),
  });

  await s3Client.send(command);

  return {
    key: options.key,
  };
}

function getS3Target(privateBucket: boolean): { client: S3Client, bucket: string } {
  if (!s3Client) {
    throw new HexclaveAssertionError("S3 is not configured");
  }
  const bucket = privateBucket ? S3_PRIVATE_BUCKET : S3_BUCKET;
  if (!bucket) {
    throw new HexclaveAssertionError(privateBucket ? "S3 private bucket is not configured" : "S3 bucket is not configured");
  }
  return { client: s3Client, bucket };
}

/**
 * Grants temporary write access to one exact object key without exposing the
 * backend's S3/R2 credentials. Callers must send the returned content type
 * because it is part of the signature.
 */
export async function createPresignedUploadUrl(options: {
  key: string,
  expiresInSeconds: number,
  contentType: string,
  private?: boolean,
}): Promise<string> {
  const { client, bucket } = getS3Target(options.private === true);
  return await getSignedUrl(
    client,
    new PutObjectCommand({
      Bucket: bucket,
      Key: options.key,
      ContentType: options.contentType,
    }),
    { expiresIn: options.expiresInSeconds },
  );
}

export async function headBytes(options: { key: string, private?: boolean }): Promise<{
  byteLength: number,
  eTag: string,
} | null> {
  const { client, bucket } = getS3Target(options.private === true);
  try {
    const response = await client.send(new HeadObjectCommand({
      Bucket: bucket,
      Key: options.key,
    }));
    if (response.ContentLength == null) {
      throw new HexclaveAssertionError("S3 headObject response is missing ContentLength");
    }
    if (response.ETag == null) {
      throw new HexclaveAssertionError("S3 headObject response is missing ETag");
    }
    return {
      byteLength: response.ContentLength,
      eTag: response.ETag,
    };
  } catch (error) {
    if (error instanceof S3ServiceException && error.$metadata.httpStatusCode === 404) {
      return null;
    }
    throw error;
  }
}

async function readBodyToBytes(body: unknown): Promise<Uint8Array> {
  if (body instanceof Uint8Array) return body;
  if (Buffer.isBuffer(body)) return new Uint8Array(body);

  // Web ReadableStream (some runtimes)
  if (typeof body === "object" && body !== null && "transformToByteArray" in body && typeof (body as any).transformToByteArray === "function") {
    return (body as any).transformToByteArray();
  }

  // Node.js Readable or any AsyncIterable<Uint8Array>
  if (typeof body === "object" && body !== null && Symbol.asyncIterator in (body as any)) {
    const chunks: Buffer[] = [];
    for await (const chunk of body as any) {
      if (chunk instanceof Uint8Array) {
        chunks.push(Buffer.from(chunk));
      } else if (Buffer.isBuffer(chunk)) {
        chunks.push(chunk);
      } else {
        throw new HexclaveAssertionError("Unexpected S3 body chunk type");
      }
    }
    return new Uint8Array(Buffer.concat(chunks));
  }

  throw new HexclaveAssertionError("Unexpected S3 body type");
}

export async function downloadBytes(options: { key: string, private?: boolean, ifMatch?: string }): Promise<Uint8Array> {
  const { client, bucket } = getS3Target(options.private === true);

  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: options.key,
    IfMatch: options.ifMatch,
  });

  const res = await client.send(command);
  if (!res.Body) {
    throw new HexclaveAssertionError("S3 getObject returned empty body");
  }

  return await readBodyToBytes(res.Body);
}

export async function deleteBytes(options: { key: string, private?: boolean }): Promise<void> {
  const { client, bucket } = getS3Target(options.private === true);
  await client.send(new DeleteObjectCommand({
    Bucket: bucket,
    Key: options.key,
  }));
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
    throw new HexclaveAssertionError("S3 is not configured");
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
