export type ArtifactErrorCode =
  | "invalid_manifest"
  | "invalid_archive"
  | "manifest_not_found"
  | "artifact_not_found"
  | "manifest_conflict"
  | "artifact_conflict"
  | "integrity_mismatch"
  | "unsupported_source_map"
  | "storage_unavailable";

/**
 * Errors crossing the artifact service boundary are deliberately classified.
 * Routes can turn these into safe HTTP responses without exposing object-store
 * details or accidentally converting caller input failures into 500s.
 */
export class ArtifactServiceError extends Error {
  public readonly code: ArtifactErrorCode;

  public constructor(code: ArtifactErrorCode, message: string) {
    super(message);
    this.name = "ArtifactServiceError";
    this.code = code;
  }
}
