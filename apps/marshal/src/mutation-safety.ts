// A new reconciliation owner waits longer than the maximum lifetime of a Fly write.
// Therefore, a request issued by an expired owner must finish or be aborted before the
// replacement owner can begin mutating the same service.
export const FLY_MUTATION_TIMEOUT_MS = 30_000;
export const RECONCILIATION_TAKEOVER_GRACE_MS = FLY_MUTATION_TIMEOUT_MS + 5_000;

export class MutationOutcomeUnknownError extends Error {
  constructor(message: string, options: ErrorOptions) {
    super(message, options);
    this.name = "MutationOutcomeUnknownError";
  }
}
