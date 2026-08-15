import { downloadBytes, headBytes, uploadBytesIfAbsent, createPresignedUploadUrl } from "@/s3";
import { S3ServiceException } from "@aws-sdk/client-s3";
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
        // The HEAD here is not redundant with the callers' own headObject size
        // checks: it captures the ETag of the exact version those checks (and
        // this read) must observe. Presigned upload URLs stay valid for a while
        // after registration, so without If-Match a concurrent overwrite could
        // hand the GET a different (possibly far larger) body than the size
        // check approved.
        const info = await headBytes({ key, private: true });
        if (info === null) return null;
        try {
          return await downloadBytes({ key, private: true, ifMatch: info.eTag });
        } catch (error) {
          // 412 = the object was replaced between the HEAD and the GET; 404 =
          // it was deleted in that window. Both mean "the version we vetted is
          // gone" — return null so callers fail their read loudly instead of
          // consuming bytes that bypassed the pre-read checks.
          if (error instanceof S3ServiceException && [404, 412].includes(error.$metadata.httpStatusCode ?? 0)) {
            return null;
          }
          throw error;
        }
      } catch (error) {
        throw translateStorageConfigurationError(error);
      }
    },
  };
}

// The exact "not configured" assertion messages thrown by @/s3's getS3Target.
// Matched exactly (not by substring) so unrelated S3 assertion bugs — e.g. a
// missing ContentLength or an unexpected body type — keep surfacing as internal
// errors instead of being misreported as a missing configuration. Any other
// error is deliberately rethrown unchanged: unclassified failures must stay
// loud internal errors rather than be masked behind a safe-looking code.
const STORAGE_NOT_CONFIGURED_MESSAGES = [
  "S3 is not configured",
  "S3 bucket is not configured",
  "S3 private bucket is not configured",
];

function translateStorageConfigurationError(error: unknown): ArtifactServiceError | unknown {
  // HexclaveAssertionError appends a support disclaimer to its message, so the
  // known text is matched as the full message or as a `\n`-terminated prefix.
  const isNotConfigured = error instanceof HexclaveAssertionError
    && STORAGE_NOT_CONFIGURED_MESSAGES.some((message) => error.message === message || error.message.startsWith(`${message}\n`));
  if (isNotConfigured) {
    return new ArtifactServiceError(
      "storage_unavailable",
      "Artifact object storage is not configured on this Hexclave instance.",
    );
  }
  return error;
}
