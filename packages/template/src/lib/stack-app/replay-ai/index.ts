export type ReplayAiAnalysisStatus = "pending" | "ready" | "error";
export type ReplayIssueSeverity = "low" | "medium" | "high" | "critical";

export type ReplayEmbeddingVectorRef = {
  provider: string,
  model: string,
  dimensions: number,
  generatedAt: Date,
  values: number[],
};

export type ReplayIssueEvidence = {
  label: string,
  reason: string,
  startOffsetMs: number,
  endOffsetMs: number,
  eventType: string | null,
};

export type ReplayVisualArtifact = {
  id: string,
  displayName: string,
  kind: "timeline-card",
  startOffsetMs: number,
  mimeType: string | null,
  dataUrl: string | null,
  altText: string,
};

export type ReplayAiSummary = {
  sessionReplayId: string,
  issueClusterId: string | null,
  issueFingerprint: string | null,
  issueTitle: string | null,
  status: ReplayAiAnalysisStatus,
  summary: string | null,
  whyLikely: string | null,
  severity: ReplayIssueSeverity | null,
  confidence: number | null,
  evidence: ReplayIssueEvidence[],
  visualArtifacts: ReplayVisualArtifact[],
  relatedReplayIds: string[],
  textEmbedding: ReplayEmbeddingVectorRef | null,
  visualEmbedding: ReplayEmbeddingVectorRef | null,
  providerMetadata: Record<string, unknown>,
  errorMessage: string | null,
  analyzedAt: Date | null,
  lastAnalyzedChunkCount: number,
};

export type ReplayIssueCluster = {
  id: string,
  fingerprint: string,
  title: string,
  summary: string | null,
  severity: ReplayIssueSeverity,
  confidence: number,
  occurrenceCount: number,
  affectedUserCount: number,
  firstSeenAt: Date,
  lastSeenAt: Date,
  topEvidence: ReplayIssueEvidence[],
};

export type ListReplayIssueClustersOptions = {
  limit?: number,
  severity?: ReplayIssueSeverity,
  search?: string,
};

export type ListReplayIssueClustersResult = {
  items: ReplayIssueCluster[],
};

export type SimilarReplayResult = {
  sessionReplayId: string,
  score: number,
  summary: string | null,
  severity: ReplayIssueSeverity | null,
  issueTitle: string | null,
};
