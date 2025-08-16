import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';

function throwErr(message: string): never {
  throw new Error(message);
}

const s3Client = new S3Client({
  region: process.env.S3_REGION || throwErr("S3_REGION is not set"),
  endpoint: process.env.S3_ENDPOINT || throwErr("S3_ENDPOINT is not set"),
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID || throwErr("S3_ACCESS_KEY_ID is not set"),
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || throwErr("S3_SECRET_ACCESS_KEY is not set"),
  },
  forcePathStyle: true,
});

const BUCKET_NAME = process.env.S3_CHECKPOINT_BUCKET ?? throwErr("S3_CHECKPOINT_BUCKET is not set");

export async function uploadCheckpoint(checkpoint: Buffer): Promise<string> {
  const key = `checkpoint-${uuidv4()}`;

  await s3Client.send(new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: checkpoint,
    ContentType: 'application/octet-stream',
  }));

  return key;
}

export async function downloadCheckpoint(storageId: string): Promise<Buffer | null> {
  try {
    const response = await s3Client.send(new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: storageId,
    }));

    if (!response.Body) {
      return null;
    }

    const chunks: Uint8Array[] = [];
    for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  } catch (error) {
    console.error('Failed to download checkpoint:', error);
    return null;
  }
}
