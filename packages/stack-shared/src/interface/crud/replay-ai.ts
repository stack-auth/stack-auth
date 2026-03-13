export type ReplayAiAnalysisStatus = "pending" | "ready" | "error";
export type ReplayIssueSeverity = "low" | "medium" | "high" | "critical";

export type ReplayEmbeddingVectorRef = {
  provider: string,
  model: string,
  dimensions: number,
  generated_at_millis: number,
  values: number[],
};

export type ReplayIssueEvidence = {
  label: string,
  reason: string,
  start_offset_ms: number,
  end_offset_ms: number,
  event_type: string | null,
};

export type ReplayVisualArtifact = {
  id: string,
  display_name: string,
  kind: "timeline-card",
  start_offset_ms: number,
  mime_type: string | null,
  data_url: string | null,
  alt_text: string,
};

export type ReplayAiSummary = {
  session_replay_id: string,
  issue_cluster_id: string | null,
  issue_fingerprint: string | null,
  issue_title: string | null,
  status: ReplayAiAnalysisStatus,
  summary: string | null,
  why_likely: string | null,
  severity: ReplayIssueSeverity | null,
  confidence: number | null,
  evidence: ReplayIssueEvidence[],
  visual_artifacts: ReplayVisualArtifact[],
  related_replay_ids: string[],
  text_embedding: ReplayEmbeddingVectorRef | null,
  visual_embedding: ReplayEmbeddingVectorRef | null,
  provider_metadata: Record<string, unknown>,
  error_message: string | null,
  analyzed_at_millis: number | null,
  last_analyzed_chunk_count: number,
};

export type ReplayIssueCluster = {
  id: string,
  fingerprint: string,
  title: string,
  summary: string | null,
  severity: ReplayIssueSeverity,
  confidence: number,
  occurrence_count: number,
  affected_user_count: number,
  first_seen_at_millis: number,
  last_seen_at_millis: number,
  top_evidence: ReplayIssueEvidence[],
};

export type AdminListReplayIssueClustersOptions = {
  limit?: number,
  severity?: ReplayIssueSeverity,
  search?: string,
};

export type AdminListReplayIssueClustersResponse = {
  items: ReplayIssueCluster[],
};

export type AdminGetReplayAiSummaryResponse = ReplayAiSummary;

export type AdminFindSimilarReplaysOptions = {
  limit?: number,
};

export type AdminFindSimilarReplaysResponse = {
  items: Array<{
    session_replay_id: string,
    score: number,
    summary: string | null,
    severity: ReplayIssueSeverity | null,
    issue_title: string | null,
  }>,
};

export type AdminTriggerReplayReanalysisResponse = {
  status: "queued",
};
