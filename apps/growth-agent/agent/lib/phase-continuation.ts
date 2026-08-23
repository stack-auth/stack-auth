
export type PhaseSessionIdentity = {
  readonly project_id: string,
  readonly branch_id: string,
  readonly run_id: string,
  readonly phase_key: string,
  readonly attempt: number,
};


const PHASE_TOKEN_MARKER = "phase1:";

export function buildPhaseContinuationToken(identity: PhaseSessionIdentity): string {
  if (identity.project_id.includes(":") || identity.branch_id.includes(":") || identity.run_id.includes(":")) {
    throw new Error("Phase continuation project, branch, and run IDs must not contain ':'");
  }
  return `${PHASE_TOKEN_MARKER}${identity.project_id}:${identity.branch_id}:${identity.run_id}:${identity.phase_key}:${identity.attempt}`;
}


export function parsePhaseContinuationToken(rawToken: string): PhaseSessionIdentity | null {
  const markerIndex = rawToken.indexOf(PHASE_TOKEN_MARKER);
  if (markerIndex === -1) return null;
  const segments = rawToken.slice(markerIndex + PHASE_TOKEN_MARKER.length).split(":");
  if (segments.length < 5) return null;
  const projectId = segments[0];
  const branchId = segments[1];
  const runId = segments[2];
  const attemptText = segments[segments.length - 1];
  const phaseKey = segments.slice(3, -1).join(":");
  if (projectId.length === 0 || branchId.length === 0 || runId.length === 0 || phaseKey.length === 0) return null;
  if (!/^\d+$/.test(attemptText)) return null;
  const attempt = Number(attemptText);
  if (!Number.isSafeInteger(attempt)) return null;
  return { project_id: projectId, branch_id: branchId, run_id: runId, phase_key: phaseKey, attempt };
}
