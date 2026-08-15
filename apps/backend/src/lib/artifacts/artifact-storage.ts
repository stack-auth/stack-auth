import { downloadBytes, headBytes, uploadBytesIfAbsent, createPresignedUploadUrl } from "@/s3";
import { HexclaveAssertionError } from "@hexclave/shared/dist/utils/errors";
import { ArtifactServiceError } from "./artifact-errors";

export type ArtifactUploadContentType = "application/javascript" | "application/json";

export type ArtifactStorageObject = {
  key: string,
  body: Uint8Array,
  contentType: ArtifactUploadContentType,
  contentEncoding?: "gzip",
};

export type ArtifactStorageObjectInfo = {
  byteLength: number,
};

export type ArtifactObjectStorage = {
  putImmutableObject(object: ArtifactStorageObject): Promise<boolean>;
  createUploadUrl(options: {
    key: string,
    contentType: ArtifactUploadContentType,
    contentEncoding?: "gzip",
  }): Promise<string>;
  headObject(key: string): Promise<ArtifactStorageObjectInfo | null>;
  readObject(key: string): Promise<Uint8Array | null>;
};

/** The production adapter: private S3/R2 is the durable artifact registry. */
export function createS3ArtifactObjectStorage(): ArtifactObjectStorage {
  return {
    async putImmutableObject(object) {
      try {
        return await uploadBytesIfAbsent({
          key: object.key,
          body: object.body,
          contentType: object.contentType,
          contentEncoding: object.contentEncoding,
          private: true,
        });
      } catch (error) {
        throw translateStorageConfigurationError(error);
      }
    },
    async createUploadUrl(options) {
      try {
        return await createPresignedUploadUrl({
          key: options.key,
          expiresInSeconds: 15 * 60,
          contentType: options.contentType,
          contentEncoding: options.contentEncoding,
          private: true,
        });
      } catch (error) {
        throw translateStorageConfigurationError(error);
      }
    },
    async headObject(key) {
      try {
        const result = await headBytes({ key, private: true });
        return result === null ? null : { byteLength: result.byteLength };
      } catch (error) {
        throw translateStorageConfigurationError(error);
      }
    },
    async readObject(key) {
      try {
        const info = await headBytes({ key, private: true });
        if (info === null) return null;
        return await downloadBytes({ key, private: true });
      } catch (error) {
        throw translateStorageConfigurationError(error);
      }
    },
  };
}

function translateStorageConfigurationError(error: unknown): ArtifactServiceError | unknown {
  if (error instanceof HexclaveAssertionError && /S3|object storage/i.test(error.message)) {
    return new ArtifactServiceError(
      "storage_unavailable",
      "Artifact object storage is not configured on this Hexclave instance.",
    );
  }
  return error;
}
