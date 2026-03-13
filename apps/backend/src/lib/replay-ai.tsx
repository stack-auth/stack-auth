import { getClickhouseExternalClient } from "@/lib/clickhouse";
import { Prisma, PrismaClient } from "@/generated/prisma/client";
import { PrismaClientWithReplica, getPrismaClientForTenancy } from "@/prisma-client";
import { loadSessionReplayChunks } from "@/lib/session-replay-events";
import { analyzeReplayDeterministically, type ReplayTimelineEvent } from "@/lib/replay-ai-deterministic";
import type { Tenancy } from "@/lib/tenancies";
import type {
  ReplayAiSummary,
  ReplayEmbeddingVectorRef,
  ReplayIssueCluster,
  ReplayIssueEvidence,
  ReplayIssueSeverity,
  ReplayVisualArtifact,
} from "@stackframe/stack-shared/dist/interface/crud/replay-ai";
import { KnownErrors } from "@stackframe/stack-shared";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { captureError, StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { wait } from "@stackframe/stack-shared/dist/utils/promises";

const ANALYSIS_TIMEOUT_MS = 25_000;
const DEFAULT_TEXT_EMBEDDING_DIMENSIONS = 32;
const ANALYTICS_EVENT_RETRY_ATTEMPTS = 5;
const ANALYTICS_EVENT_RETRY_DELAY_MS = 250;
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_GEMINI_REASONING_MODEL = "gemini-2.5-pro";
const DEFAULT_GEMINI_EMBEDDING_MODEL = "gemini-embedding-001";
const DEFAULT_VERTEX_MULTIMODAL_EMBEDDING_MODEL = "multimodalembedding@001";

type ReplayAiConfig = {
  enabled?: boolean,
  provider?: "gemini" | "openrouter",
  geminiApiKey?: string,
  openRouterApiKey?: string,
  openRouterBaseUrl?: string,
  geminiReasoningModel?: string,
  geminiInteractiveModel?: string,
  textEmbeddingModel?: string,
  multimodalEmbeddingModel?: string,
  vertexProjectId?: string,
  vertexLocation?: string,
  vertexAccessToken?: string,
  screenshotGenerationEnabled?: boolean,
  reanalysisOnReplayUpload?: boolean,
  clusterSimilarityThreshold?: number,
  privacy?: {
    redactTextInputs?: boolean,
    redactTextContent?: boolean,
  },
};

type ReplayAiAnalysisRow = {
  sessionReplayId: string,
  issueClusterId: string | null,
  issueFingerprint: string | null,
  issueTitle: string | null,
  status: "pending" | "ready" | "error",
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

type ReplaySummaryQueryRow = {
  sessionReplayId: string,
  issueClusterId: string | null,
  issueFingerprint: string | null,
  issueTitle: string | null,
  status: string,
  summary: string | null,
  whyLikely: string | null,
  severity: string | null,
  confidence: number | null,
  evidence: unknown,
  visualArtifacts: unknown,
  relatedReplayIds: unknown,
  textEmbedding: unknown,
  visualEmbedding: unknown,
  providerMetadata: unknown,
  errorMessage: string | null,
  analyzedAt: Date | null,
  lastAnalyzedChunkCount: number,
};

type ReplayIssueClusterQueryRow = {
  id: string,
  fingerprint: string,
  title: string,
  summary: string | null,
  severity: string,
  confidence: number,
  occurrenceCount: number,
  affectedUserCount: number,
  firstSeenAt: Date,
  lastSeenAt: Date,
  topEvidence: unknown,
};

type SimilarReplayCandidateRow = {
  sessionReplayId: string,
  summary: string | null,
  severity: string | null,
  issueTitle: string | null,
  textEmbedding: unknown,
  visualEmbedding: unknown,
};

type SessionReplayRow = {
  id: string,
  startedAt: Date,
  lastEventAt: Date,
  projectUserId: string,
};

type ReplayAiSchemaAvailabilityRow = {
  replayAiSummaryTableReady: boolean,
  replayIssueClusterTableReady: boolean,
};

export async function analyzeReplayForTenancy(options: {
  tenancy: Tenancy,
  sessionReplayId: string,
}): Promise<void> {
  const aiConfig = options.tenancy.config.analytics.ai;
  if (!aiConfig.enabled) {
    return;
  }

  const prisma = await getPrismaClientForTenancy(options.tenancy);
  if (!(await isReplayAiSchemaReady(prisma))) {
    return;
  }
  await markReplaySummaryPending(prisma, options.tenancy.id, options.sessionReplayId);

  try {
    const sessionReplay = await prisma.sessionReplay.findUnique({
      where: { tenancyId_id: { tenancyId: options.tenancy.id, id: options.sessionReplayId } },
      select: {
        id: true,
        startedAt: true,
        lastEventAt: true,
        projectUserId: true,
        _count: { select: { chunks: true } },
      },
    });
    if (!sessionReplay) {
      return;
    }

    const chunks = await loadSessionReplayChunks(prisma, {
      tenancyId: options.tenancy.id,
      sessionReplayId: options.sessionReplayId,
    });
    const timelineEvents = await loadAnalyticsTimelineEventsWithRetry({
      projectId: await getProjectIdForTenancy(prisma, options.tenancy.id),
      branchId: await getBranchIdForTenancy(prisma, options.tenancy.id),
      sessionReplayId: options.sessionReplayId,
    });

    const deterministic = analyzeReplayDeterministically({
      startedAtMs: sessionReplay.startedAt.getTime(),
      lastEventAtMs: sessionReplay.lastEventAt.getTime(),
      timelineEvents,
    });

    const reasoningResult = await enrichWithGemini({
      config: aiConfig,
      sessionReplay,
      chunks,
      timelineEvents,
      deterministic,
    });

    const textEmbedding = await createTextEmbedding(
      aiConfig,
      `${reasoningResult.issueTitle}\n${reasoningResult.summary}\n${reasoningResult.whyLikely}`,
    );
    const visualEmbedding = await createVisualEmbedding(
      aiConfig,
      deterministic.visualArtifacts,
    );

    const clusterId = await upsertIssueCluster(prisma, {
      tenancyId: options.tenancy.id,
      fingerprint: deterministic.fingerprint,
      title: reasoningResult.issueTitle,
      summary: reasoningResult.summary,
      severity: reasoningResult.severity,
      confidence: reasoningResult.confidence,
      topEvidence: reasoningResult.evidence,
      textEmbedding,
      visualEmbedding,
      occurrenceAt: sessionReplay.lastEventAt,
    });

    await upsertReplaySummary(prisma, {
      tenancyId: options.tenancy.id,
      sessionReplayId: options.sessionReplayId,
      issueClusterId: clusterId,
      issueFingerprint: deterministic.fingerprint,
      issueTitle: reasoningResult.issueTitle,
      status: "ready",
      summary: reasoningResult.summary,
      whyLikely: reasoningResult.whyLikely,
      severity: reasoningResult.severity,
      confidence: reasoningResult.confidence,
      evidence: reasoningResult.evidence,
      visualArtifacts: deterministic.visualArtifacts,
      relatedReplayIds: [],
      textEmbedding,
      visualEmbedding,
      providerMetadata: reasoningResult.providerMetadata,
      errorMessage: null,
      analyzedAt: new Date(),
      lastAnalyzedChunkCount: sessionReplay._count.chunks,
    });

    const similarReplayIds = await findSimilarReplayIds(prisma, {
      tenancyId: options.tenancy.id,
      sessionReplayId: options.sessionReplayId,
      textEmbedding,
      visualEmbedding,
      limit: 5,
    });

    await updateReplayRelatedIds(prisma, {
      tenancyId: options.tenancy.id,
      sessionReplayId: options.sessionReplayId,
      relatedReplayIds: similarReplayIds,
    });

    await refreshIssueClusterStats(prisma, {
      tenancyId: options.tenancy.id,
      issueClusterId: clusterId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    captureError("replay-ai-analysis-failed", new StackAssertionError("Replay AI analysis failed", {
      tenancyId: options.tenancy.id,
      sessionReplayId: options.sessionReplayId,
      cause: error,
    }));
    await upsertReplaySummary(prisma, {
      tenancyId: options.tenancy.id,
      sessionReplayId: options.sessionReplayId,
      issueClusterId: null,
      issueFingerprint: null,
      issueTitle: null,
      status: "error",
      summary: null,
      whyLikely: null,
      severity: null,
      confidence: null,
      evidence: [],
      visualArtifacts: [],
      relatedReplayIds: [],
      textEmbedding: null,
      visualEmbedding: null,
      providerMetadata: { provider: "error" },
      errorMessage: message,
      analyzedAt: new Date(),
      lastAnalyzedChunkCount: 0,
    });
  }
}

export async function getReplaySummaryForTenancy(options: {
  tenancy: Tenancy,
  sessionReplayId: string,
}): Promise<ReplayAiSummary> {
  const prisma = await getPrismaClientForTenancy(options.tenancy);
  const sessionReplayExists = await prisma.sessionReplay.findUnique({
    where: { tenancyId_id: { tenancyId: options.tenancy.id, id: options.sessionReplayId } },
    select: { id: true },
  });
  if (!sessionReplayExists) {
    throw new KnownErrors.ItemNotFound(options.sessionReplayId);
  }
  if (!(await isReplayAiSchemaReady(prisma))) {
    return toCrudReplaySummary(makePendingReplaySummary(options.sessionReplayId));
  }
  const existing = await loadReplaySummary(prisma, options.tenancy.id, options.sessionReplayId);
  if (existing) {
    return toCrudReplaySummary(existing);
  }

  await markReplaySummaryPending(prisma, options.tenancy.id, options.sessionReplayId);
  return toCrudReplaySummary(makePendingReplaySummary(options.sessionReplayId));
}

export async function listReplayIssueClustersForTenancy(options: {
  tenancy: Tenancy,
  limit?: number,
  severity?: ReplayIssueSeverity,
  search?: string,
}): Promise<ReplayIssueCluster[]> {
  const prisma = await getPrismaClientForTenancy(options.tenancy);
  if (!(await isReplayAiSchemaReady(prisma))) {
    return [];
  }
  const rows = await prisma.$queryRaw<ReplayIssueClusterQueryRow[]>`
    SELECT
      ric."id",
      ric."fingerprint",
      ric."title",
      ric."summary",
      ric."severity"::text AS "severity",
      ric."confidence",
      ric."occurrenceCount",
      ric."affectedUserCount",
      ric."firstSeenAt",
      ric."lastSeenAt",
      ric."topEvidence"
    FROM "ReplayIssueCluster" ric
    WHERE ric."tenancyId" = ${options.tenancy.id}::UUID
      ${options.severity ? Prisma.sql`AND ric."severity" = ${options.severity.toUpperCase()}::"ReplayIssueSeverity"` : Prisma.empty}
      ${options.search ? Prisma.sql`AND (ric."title" ILIKE ${`%${options.search}%`} OR coalesce(ric."summary", '') ILIKE ${`%${options.search}%`})` : Prisma.empty}
    ORDER BY ric."occurrenceCount" DESC, ric."lastSeenAt" DESC
    LIMIT ${Math.min(options.limit ?? 50, 100)}
  `;
  return rows.map((row) => ({
    id: row.id,
    fingerprint: row.fingerprint,
    title: row.title,
    summary: row.summary,
    severity: parseSeverity(row.severity) ?? "low",
    confidence: row.confidence,
    occurrence_count: row.occurrenceCount,
    affected_user_count: row.affectedUserCount,
    first_seen_at_millis: row.firstSeenAt.getTime(),
    last_seen_at_millis: row.lastSeenAt.getTime(),
    top_evidence: parseEvidenceArray(row.topEvidence),
  }));
}

export async function findSimilarReplaysForTenancy(options: {
  tenancy: Tenancy,
  sessionReplayId: string,
  limit?: number,
}): Promise<Array<{
  session_replay_id: string,
  score: number,
  summary: string | null,
  severity: ReplayIssueSeverity | null,
  issue_title: string | null,
}>> {
  const prisma = await getPrismaClientForTenancy(options.tenancy);
  if (!(await isReplayAiSchemaReady(prisma))) {
    return [];
  }
  const current = await loadReplaySummary(prisma, options.tenancy.id, options.sessionReplayId);
  if (!current) return [];
  const candidates = await prisma.$queryRaw<SimilarReplayCandidateRow[]>`
    SELECT
      ras."sessionReplayId" AS "sessionReplayId",
      ras."summary",
      ras."severity"::text AS "severity",
      ras."issueTitle" AS "issueTitle",
      ras."textEmbedding",
      ras."visualEmbedding"
    FROM "ReplayAiSummary" ras
    WHERE ras."tenancyId" = ${options.tenancy.id}::UUID
      AND ras."sessionReplayId" <> ${options.sessionReplayId}::UUID
      AND ras."status" = 'READY'
    ORDER BY ras."updatedAt" DESC
    LIMIT 100
  `;

  const currentTextEmbedding = current.textEmbedding;
  const currentVisualEmbedding = current.visualEmbedding;
  if (currentTextEmbedding == null && currentVisualEmbedding == null) return [];

  return candidates
    .map((candidate) => {
      const textScore = cosineSimilarity(currentTextEmbedding?.values ?? [], parseEmbedding(candidate.textEmbedding)?.values ?? []);
      const visualScore = cosineSimilarity(currentVisualEmbedding?.values ?? [], parseEmbedding(candidate.visualEmbedding)?.values ?? []);
      const score = currentVisualEmbedding != null && parseEmbedding(candidate.visualEmbedding) != null
        ? (textScore * 0.7) + (visualScore * 0.3)
        : textScore;
      return {
        session_replay_id: candidate.sessionReplayId,
        score,
        summary: candidate.summary,
        severity: parseSeverity(candidate.severity),
        issue_title: candidate.issueTitle,
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, options.limit ?? 5);
}

async function loadAnalyticsTimelineEvents(options: {
  projectId: string,
  branchId: string,
  sessionReplayId: string,
}): Promise<ReplayTimelineEvent[]> {
  const client = getClickhouseExternalClient();
  const result = await client.query({
    query: `
      SELECT event_type, toUnixTimestamp64Milli(event_at) AS event_at_ms, data
      FROM default.events
      WHERE project_id = {projectId:String}
        AND branch_id = {branchId:String}
        AND session_replay_id = {sessionReplayId:String}
      ORDER BY event_at ASC
      LIMIT 5000
    `,
    query_params: {
      projectId: options.projectId,
      branchId: options.branchId,
      sessionReplayId: options.sessionReplayId,
    },
    clickhouse_settings: {
      SQL_project_id: options.projectId,
      SQL_branch_id: options.branchId,
    },
    format: "JSONEachRow",
  });

  const rows = await result.json();
  if (!Array.isArray(rows)) {
    return [];
  }
  return rows.flatMap((row) => {
    if (!isRecord(row)) {
      return [];
    }
    const eventType = getStringValue(row, "event_type") ?? "unknown";
    const eventAtMs = readTimestampValue(row, "event_at_ms");
    if (!Number.isFinite(eventAtMs)) {
      return [];
    }
    return [{
      eventType,
      eventAtMs,
      data: parseEventData(getNestedValue(row, ["data"])),
    }];
  });
}

async function loadAnalyticsTimelineEventsWithRetry(options: {
  projectId: string,
  branchId: string,
  sessionReplayId: string,
}): Promise<ReplayTimelineEvent[]> {
  for (let attempt = 0; attempt < ANALYTICS_EVENT_RETRY_ATTEMPTS; attempt++) {
    const timelineEvents = await loadAnalyticsTimelineEvents(options);
    if (timelineEvents.length > 0 || attempt === ANALYTICS_EVENT_RETRY_ATTEMPTS - 1) {
      return timelineEvents;
    }
    await wait(ANALYTICS_EVENT_RETRY_DELAY_MS);
  }
  return [];
}

function parseEventData(value: unknown): Record<string, unknown> {
  if (isRecord(value)) {
    return value;
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      return {};
    }
  }
  return {};
}

async function enrichWithGemini(options: {
  config: ReplayAiConfig,
  sessionReplay: SessionReplayRow & { _count: { chunks: number } },
  chunks: Awaited<ReturnType<typeof loadSessionReplayChunks>>,
  timelineEvents: ReplayTimelineEvent[],
  deterministic: ReturnType<typeof analyzeReplayDeterministically>,
}): Promise<{
  issueTitle: string,
  summary: string,
  whyLikely: string,
  severity: ReplayIssueSeverity,
  confidence: number,
  evidence: ReplayIssueEvidence[],
  providerMetadata: Record<string, unknown>,
}> {
  const reasoningModel = getReasoningModel(options.config);
  const providerMetadata: Record<string, unknown> = {
    provider: "local-deterministic",
    reasoningModel,
  };

  if (shouldUseOpenRouterTransport(options.config)) {
    return await enrichWithOpenRouter(options, providerMetadata);
  }

  const apiKey = getGeminiApiKey(options.config);
  if (apiKey.length === 0) {
    return {
      issueTitle: options.deterministic.issueTitle,
      summary: options.deterministic.summary,
      whyLikely: options.deterministic.whyLikely,
      severity: options.deterministic.severity,
      confidence: options.deterministic.confidence,
      evidence: options.deterministic.evidence,
      providerMetadata,
    };
  }

  const prompt = JSON.stringify({
    replay: {
      sessionReplayId: options.sessionReplay.id,
      startedAt: options.sessionReplay.startedAt.toISOString(),
      lastEventAt: options.sessionReplay.lastEventAt.toISOString(),
      chunkCount: options.sessionReplay._count.chunks,
      timelineEventCount: options.timelineEvents.length,
    },
    deterministic: {
      fingerprint: options.deterministic.fingerprint,
      issueTitle: options.deterministic.issueTitle,
      summary: options.deterministic.summary,
      whyLikely: options.deterministic.whyLikely,
      severity: options.deterministic.severity,
      confidence: options.deterministic.confidence,
      evidence: options.deterministic.evidence,
    },
    recentTimeline: options.timelineEvents.slice(-20),
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ANALYSIS_TIMEOUT_MS);
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(reasoningModel)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [{
            text: [
              "You are classifying a Stack Auth session replay issue.",
              "Return strict JSON with keys issueTitle, summary, whyLikely, severity, confidence.",
              "Ground everything in the provided evidence and keep severity one of low, medium, high, critical.",
              prompt,
            ].join("\n"),
          }],
        }],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      providerMetadata.error = `gemini-http-${response.status}`;
      return {
        issueTitle: options.deterministic.issueTitle,
        summary: options.deterministic.summary,
        whyLikely: options.deterministic.whyLikely,
        severity: options.deterministic.severity,
        confidence: options.deterministic.confidence,
        evidence: options.deterministic.evidence,
        providerMetadata,
      };
    }

    const json = await response.json();
    const text = extractGeminiText(json);
    const parsed = parseGeminiReasoningJson(text);
    return {
      issueTitle: parsed.issueTitle ?? options.deterministic.issueTitle,
      summary: parsed.summary ?? options.deterministic.summary,
      whyLikely: parsed.whyLikely ?? options.deterministic.whyLikely,
      severity: parseSeverity(parsed.severity ?? null) ?? options.deterministic.severity,
      confidence: parsed.confidence ?? options.deterministic.confidence,
      evidence: options.deterministic.evidence,
      providerMetadata: {
        ...providerMetadata,
        provider: "gemini",
      },
    };
  } catch (error) {
    providerMetadata.error = error instanceof Error ? error.message : String(error);
    return {
      issueTitle: options.deterministic.issueTitle,
      summary: options.deterministic.summary,
      whyLikely: options.deterministic.whyLikely,
      severity: options.deterministic.severity,
      confidence: options.deterministic.confidence,
      evidence: options.deterministic.evidence,
      providerMetadata,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function createTextEmbedding(config: ReplayAiConfig, text: string): Promise<ReplayEmbeddingVectorRef> {
  if (shouldUseOpenRouterTransport(config)) {
    return await createOpenRouterEmbedding(config, {
      model: getOpenRouterTextEmbeddingModel(config),
      input: [text],
    }) ?? makeLocalHashEmbedding(text, getOpenRouterTextEmbeddingModel(config));
  }

  const apiKey = getGeminiApiKey(config);
  if (apiKey.length === 0) {
    return makeLocalHashEmbedding(text, DEFAULT_GEMINI_EMBEDDING_MODEL);
  }

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.textEmbeddingModel ?? DEFAULT_GEMINI_EMBEDDING_MODEL)}:embedContent?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        content: {
          parts: [{ text }],
        },
      }),
    });

    if (!response.ok) {
      return makeLocalHashEmbedding(text, config.textEmbeddingModel ?? DEFAULT_GEMINI_EMBEDDING_MODEL);
    }
    const json = await response.json();
    const embedding = readNumberArrayFromUnknown(getNestedValue(json, ["embedding", "values"]));
    if (embedding.length === 0) {
      return makeLocalHashEmbedding(text, config.textEmbeddingModel ?? DEFAULT_GEMINI_EMBEDDING_MODEL);
    }
    return {
      provider: "gemini",
      model: config.textEmbeddingModel ?? DEFAULT_GEMINI_EMBEDDING_MODEL,
      dimensions: embedding.length,
      generated_at_millis: Date.now(),
      values: embedding,
    };
  } catch {
    return makeLocalHashEmbedding(text, config.textEmbeddingModel ?? DEFAULT_GEMINI_EMBEDDING_MODEL);
  }
}

async function createVisualEmbedding(
  config: ReplayAiConfig,
  visualArtifacts: ReplayVisualArtifact[],
): Promise<ReplayEmbeddingVectorRef | null> {
  const usableArtifact = visualArtifacts.find((artifact) => isSupportedImageDataUrl(artifact.data_url));
  if (shouldUseOpenRouterTransport(config)) {
    if (usableArtifact?.data_url == null) {
      return null;
    }
    return await createOpenRouterEmbedding(config, {
      model: getOpenRouterMultimodalEmbeddingModel(config),
      input: [{
        content: [
          { type: "text", text: usableArtifact.alt_text },
          { type: "image_url", image_url: { url: usableArtifact.data_url } },
        ],
      }],
    });
  }

  const projectId = config.vertexProjectId || getEnvVariable("STACK_VERTEX_AI_PROJECT_ID", "");
  const location = config.vertexLocation || getEnvVariable("STACK_VERTEX_AI_LOCATION", "us-central1");
  const accessToken = config.vertexAccessToken || getEnvVariable("STACK_VERTEX_AI_ACCESS_TOKEN", "");
  if (usableArtifact == null || projectId.length === 0 || accessToken.length === 0) {
    return null;
  }

  const parsedDataUrl = parseImageDataUrl(usableArtifact.data_url);
  if (!parsedDataUrl) return null;

  try {
    const response = await fetch(`https://${encodeURIComponent(location)}-aiplatform.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(config.multimodalEmbeddingModel ?? DEFAULT_VERTEX_MULTIMODAL_EMBEDDING_MODEL)}:predict`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        instances: [{
          text: usableArtifact.alt_text,
          image: {
            bytesBase64Encoded: parsedDataUrl.base64Data,
          },
        }],
      }),
    });
    if (!response.ok) return null;
    const json = await response.json();
    const predictions = getNestedValue(json, ["predictions"]);
    if (!Array.isArray(predictions) || predictions.length === 0) return null;
    const firstPrediction = predictions[0];
    const embedding = readNumberArrayFromUnknown(getNestedValue(firstPrediction, ["imageEmbedding"]));
    if (embedding.length === 0) return null;
    return {
      provider: "vertex",
      model: config.multimodalEmbeddingModel ?? DEFAULT_VERTEX_MULTIMODAL_EMBEDDING_MODEL,
      dimensions: embedding.length,
      generated_at_millis: Date.now(),
      values: embedding,
    };
  } catch {
    return null;
  }
}

async function enrichWithOpenRouter(
  options: {
    config: ReplayAiConfig,
    sessionReplay: SessionReplayRow & { _count: { chunks: number } },
    chunks: Awaited<ReturnType<typeof loadSessionReplayChunks>>,
    timelineEvents: ReplayTimelineEvent[],
    deterministic: ReturnType<typeof analyzeReplayDeterministically>,
  },
  providerMetadata: Record<string, unknown>,
): Promise<{
  issueTitle: string,
  summary: string,
  whyLikely: string,
  severity: ReplayIssueSeverity,
  confidence: number,
  evidence: ReplayIssueEvidence[],
  providerMetadata: Record<string, unknown>,
}> {
  const apiKey = getOpenRouterApiKey(options.config);
  if (apiKey.length === 0) {
    return {
      issueTitle: options.deterministic.issueTitle,
      summary: options.deterministic.summary,
      whyLikely: options.deterministic.whyLikely,
      severity: options.deterministic.severity,
      confidence: options.deterministic.confidence,
      evidence: options.deterministic.evidence,
      providerMetadata,
    };
  }

  const prompt = JSON.stringify({
    replay: {
      sessionReplayId: options.sessionReplay.id,
      startedAt: options.sessionReplay.startedAt.toISOString(),
      lastEventAt: options.sessionReplay.lastEventAt.toISOString(),
      chunkCount: options.sessionReplay._count.chunks,
      timelineEventCount: options.timelineEvents.length,
    },
    deterministic: {
      fingerprint: options.deterministic.fingerprint,
      issueTitle: options.deterministic.issueTitle,
      summary: options.deterministic.summary,
      whyLikely: options.deterministic.whyLikely,
      severity: options.deterministic.severity,
      confidence: options.deterministic.confidence,
      evidence: options.deterministic.evidence,
    },
    recentTimeline: options.timelineEvents.slice(-20),
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ANALYSIS_TIMEOUT_MS);
  try {
    const response = await fetch(`${getOpenRouterBaseUrl(options.config)}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: getOpenRouterReasoningModel(options.config),
        response_format: { type: "json_object" },
        messages: [{
          role: "user",
          content: [
            "You are classifying a Stack Auth session replay issue.",
            "Return strict JSON with keys issueTitle, summary, whyLikely, severity, confidence.",
            "Ground everything in the provided evidence and keep severity one of low, medium, high, critical.",
            prompt,
          ].join("\n"),
        }],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      providerMetadata.error = `openrouter-http-${response.status}`;
      return {
        issueTitle: options.deterministic.issueTitle,
        summary: options.deterministic.summary,
        whyLikely: options.deterministic.whyLikely,
        severity: options.deterministic.severity,
        confidence: options.deterministic.confidence,
        evidence: options.deterministic.evidence,
        providerMetadata,
      };
    }

    const json = await response.json();
    const text = extractOpenRouterMessageText(json);
    const parsed = parseGeminiReasoningJson(text);
    return {
      issueTitle: parsed.issueTitle ?? options.deterministic.issueTitle,
      summary: parsed.summary ?? options.deterministic.summary,
      whyLikely: parsed.whyLikely ?? options.deterministic.whyLikely,
      severity: parseSeverity(parsed.severity ?? null) ?? options.deterministic.severity,
      confidence: parsed.confidence ?? options.deterministic.confidence,
      evidence: options.deterministic.evidence,
      providerMetadata: {
        ...providerMetadata,
        provider: "openrouter",
        reasoningModel: getOpenRouterReasoningModel(options.config),
      },
    };
  } catch (error) {
    providerMetadata.error = error instanceof Error ? error.message : String(error);
    return {
      issueTitle: options.deterministic.issueTitle,
      summary: options.deterministic.summary,
      whyLikely: options.deterministic.whyLikely,
      severity: options.deterministic.severity,
      confidence: options.deterministic.confidence,
      evidence: options.deterministic.evidence,
      providerMetadata,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function createOpenRouterEmbedding(
  config: ReplayAiConfig,
  options: {
    model: string,
    input: unknown[],
  },
): Promise<ReplayEmbeddingVectorRef | null> {
  const apiKey = getOpenRouterApiKey(config);
  if (apiKey.length === 0) {
    return null;
  }

  try {
    const response = await fetch(`${getOpenRouterBaseUrl(config)}/embeddings`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: options.model,
        input: options.input,
        encoding_format: "float",
      }),
    });
    if (!response.ok) {
      return null;
    }
    const json = await response.json();
    const data = getNestedValue(json, ["data"]);
    if (!Array.isArray(data) || data.length === 0) {
      return null;
    }
    const embedding = readNumberArrayFromUnknown(getNestedValue(data[0], ["embedding"]));
    if (embedding.length === 0) {
      return null;
    }
    return {
      provider: "openrouter",
      model: options.model,
      dimensions: embedding.length,
      generated_at_millis: Date.now(),
      values: embedding,
    };
  } catch {
    return null;
  }
}

function extractGeminiText(json: unknown): string {
  const candidates = getNestedValue(json, ["candidates"]);
  if (!Array.isArray(candidates) || candidates.length === 0) return "";
  const content = getNestedValue(candidates[0], ["content"]);
  const parts = getNestedValue(content, ["parts"]);
  if (!Array.isArray(parts)) return "";
  const textParts = parts
    .map((part) => getNestedValue(part, ["text"]))
    .filter((part): part is string => typeof part === "string");
  return textParts.join("\n");
}

function extractOpenRouterMessageText(json: unknown): string {
  const choices = getNestedValue(json, ["choices"]);
  if (!Array.isArray(choices) || choices.length === 0) {
    return "";
  }
  const content = getNestedValue(choices[0], ["message", "content"]);
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((part) => getNestedValue(part, ["text"]))
    .filter((part): part is string => typeof part === "string")
    .join("\n");
}

function parseGeminiReasoningJson(text: string): {
  issueTitle?: string,
  summary?: string,
  whyLikely?: string,
  severity?: string,
  confidence?: number,
} {
  const trimmed = text.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return {};
  }
  try {
    const parsed = JSON.parse(trimmed.slice(start, end + 1));
    return {
      issueTitle: typeof parsed.issueTitle === "string" ? parsed.issueTitle : undefined,
      summary: typeof parsed.summary === "string" ? parsed.summary : undefined,
      whyLikely: typeof parsed.whyLikely === "string" ? parsed.whyLikely : undefined,
      severity: typeof parsed.severity === "string" ? parsed.severity : undefined,
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : undefined,
    };
  } catch {
    return {};
  }
}

function makeLocalHashEmbedding(text: string, model: string): ReplayEmbeddingVectorRef {
  const values = Array.from({ length: DEFAULT_TEXT_EMBEDDING_DIMENSIONS }, () => 0);
  const normalized = text.toLowerCase();
  for (let index = 0; index < normalized.length; index++) {
    const code = normalized.charCodeAt(index);
    values[index % DEFAULT_TEXT_EMBEDDING_DIMENSIONS] += code / 255;
  }
  const norm = Math.sqrt(values.reduce((sum, value) => sum + (value * value), 0)) || 1;
  return {
    provider: "local-hash",
    model,
    dimensions: DEFAULT_TEXT_EMBEDDING_DIMENSIONS,
    generated_at_millis: Date.now(),
    values: values.map((value) => value / norm),
  };
}

function getGeminiApiKey(config: ReplayAiConfig): string {
  return config.geminiApiKey || getEnvVariable("STACK_GEMINI_API_KEY", "");
}

function getOpenRouterApiKey(config: ReplayAiConfig): string {
  return config.openRouterApiKey || getEnvVariable("STACK_OPENROUTER_API_KEY", "");
}

function getOpenRouterBaseUrl(config: ReplayAiConfig): string {
  return config.openRouterBaseUrl || getEnvVariable("STACK_OPENROUTER_BASE_URL", OPENROUTER_BASE_URL);
}

function shouldUseOpenRouterTransport(config: ReplayAiConfig): boolean {
  if (config.provider === "openrouter") {
    return true;
  }
  return getOpenRouterApiKey(config).length > 0 && getGeminiApiKey(config).length === 0;
}

function getReasoningModel(config: ReplayAiConfig): string {
  if (shouldUseOpenRouterTransport(config)) {
    return getOpenRouterReasoningModel(config);
  }
  return config.geminiReasoningModel ?? DEFAULT_GEMINI_REASONING_MODEL;
}

function getOpenRouterReasoningModel(config: ReplayAiConfig): string {
  return normalizeOpenRouterModelId(config.geminiReasoningModel ?? DEFAULT_GEMINI_REASONING_MODEL);
}

function getOpenRouterTextEmbeddingModel(config: ReplayAiConfig): string {
  return normalizeOpenRouterModelId(config.textEmbeddingModel ?? DEFAULT_GEMINI_EMBEDDING_MODEL);
}

function getOpenRouterMultimodalEmbeddingModel(config: ReplayAiConfig): string {
  const configuredModel = config.multimodalEmbeddingModel;
  if (configuredModel == null || configuredModel === DEFAULT_VERTEX_MULTIMODAL_EMBEDDING_MODEL) {
    return getOpenRouterTextEmbeddingModel(config);
  }
  return normalizeOpenRouterModelId(configuredModel);
}

function normalizeOpenRouterModelId(model: string): string {
  if (model.includes("/")) {
    return model;
  }
  return `google/${model}`;
}

async function markReplaySummaryPending(
  prisma: PrismaClientWithReplica<PrismaClient>,
  tenancyId: string,
  sessionReplayId: string,
): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO "ReplayAiSummary" (
      "tenancyId",
      "sessionReplayId",
      "status",
      "evidence",
      "visualArtifacts",
      "relatedReplayIds",
      "providerMetadata",
      "createdAt",
      "updatedAt"
    )
    VALUES (
      ${tenancyId}::UUID,
      ${sessionReplayId}::UUID,
      'PENDING'::"ReplayAiAnalysisStatus",
      '[]'::jsonb,
      '[]'::jsonb,
      '[]'::jsonb,
      '{}'::jsonb,
      NOW(),
      NOW()
    )
    ON CONFLICT ("tenancyId", "sessionReplayId")
    DO UPDATE SET
      "status" = 'PENDING'::"ReplayAiAnalysisStatus",
      "errorMessage" = NULL,
      "updatedAt" = NOW()
  `;
}

async function upsertReplaySummary(
  prisma: PrismaClientWithReplica<PrismaClient>,
  input: {
    tenancyId: string,
    sessionReplayId: string,
    issueClusterId: string | null,
    issueFingerprint: string | null,
    issueTitle: string | null,
    status: "pending" | "ready" | "error",
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
  },
): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO "ReplayAiSummary" (
      "tenancyId",
      "sessionReplayId",
      "issueClusterId",
      "status",
      "issueFingerprint",
      "issueTitle",
      "summary",
      "whyLikely",
      "severity",
      "confidence",
      "evidence",
      "visualArtifacts",
      "relatedReplayIds",
      "textEmbedding",
      "visualEmbedding",
      "providerMetadata",
      "errorMessage",
      "analyzedAt",
      "lastAnalyzedChunkCount",
      "createdAt",
      "updatedAt"
    )
    VALUES (
      ${input.tenancyId}::UUID,
      ${input.sessionReplayId}::UUID,
      ${input.issueClusterId == null ? null : input.issueClusterId}::UUID,
      ${input.status.toUpperCase()}::"ReplayAiAnalysisStatus",
      ${input.issueFingerprint},
      ${input.issueTitle},
      ${input.summary},
      ${input.whyLikely},
      ${input.severity == null ? null : input.severity.toUpperCase()}::"ReplayIssueSeverity",
      ${input.confidence},
      ${JSON.stringify(input.evidence)}::jsonb,
      ${JSON.stringify(input.visualArtifacts)}::jsonb,
      ${JSON.stringify(input.relatedReplayIds)}::jsonb,
      ${input.textEmbedding == null ? null : JSON.stringify(input.textEmbedding)}::jsonb,
      ${input.visualEmbedding == null ? null : JSON.stringify(input.visualEmbedding)}::jsonb,
      ${JSON.stringify(input.providerMetadata)}::jsonb,
      ${input.errorMessage},
      ${input.analyzedAt},
      ${input.lastAnalyzedChunkCount},
      NOW(),
      NOW()
    )
    ON CONFLICT ("tenancyId", "sessionReplayId")
    DO UPDATE SET
      "issueClusterId" = EXCLUDED."issueClusterId",
      "status" = EXCLUDED."status",
      "issueFingerprint" = EXCLUDED."issueFingerprint",
      "issueTitle" = EXCLUDED."issueTitle",
      "summary" = EXCLUDED."summary",
      "whyLikely" = EXCLUDED."whyLikely",
      "severity" = EXCLUDED."severity",
      "confidence" = EXCLUDED."confidence",
      "evidence" = EXCLUDED."evidence",
      "visualArtifacts" = EXCLUDED."visualArtifacts",
      "relatedReplayIds" = EXCLUDED."relatedReplayIds",
      "textEmbedding" = EXCLUDED."textEmbedding",
      "visualEmbedding" = EXCLUDED."visualEmbedding",
      "providerMetadata" = EXCLUDED."providerMetadata",
      "errorMessage" = EXCLUDED."errorMessage",
      "analyzedAt" = EXCLUDED."analyzedAt",
      "lastAnalyzedChunkCount" = EXCLUDED."lastAnalyzedChunkCount",
      "updatedAt" = NOW()
  `;
}

async function updateReplayRelatedIds(
  prisma: PrismaClientWithReplica<PrismaClient>,
  input: {
    tenancyId: string,
    sessionReplayId: string,
    relatedReplayIds: string[],
  },
): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "ReplayAiSummary"
    SET "relatedReplayIds" = ${JSON.stringify(input.relatedReplayIds)}::jsonb,
        "updatedAt" = NOW()
    WHERE "tenancyId" = ${input.tenancyId}::UUID
      AND "sessionReplayId" = ${input.sessionReplayId}::UUID
  `;
}

async function loadReplaySummary(
  prisma: PrismaClientWithReplica<PrismaClient>,
  tenancyId: string,
  sessionReplayId: string,
): Promise<ReplayAiAnalysisRow | null> {
  const rows = await prisma.$queryRaw<ReplaySummaryQueryRow[]>`
    SELECT
      ras."sessionReplayId" AS "sessionReplayId",
      ras."issueClusterId" AS "issueClusterId",
      ras."issueFingerprint" AS "issueFingerprint",
      ras."issueTitle" AS "issueTitle",
      ras."status"::text AS "status",
      ras."summary",
      ras."whyLikely",
      ras."severity"::text AS "severity",
      ras."confidence",
      ras."evidence",
      ras."visualArtifacts",
      ras."relatedReplayIds",
      ras."textEmbedding",
      ras."visualEmbedding",
      ras."providerMetadata",
      ras."errorMessage",
      ras."analyzedAt",
      ras."lastAnalyzedChunkCount"
    FROM "ReplayAiSummary" ras
    WHERE ras."tenancyId" = ${tenancyId}::UUID
      AND ras."sessionReplayId" = ${sessionReplayId}::UUID
    LIMIT 1
  `;
  if (rows.length === 0) {
    return null;
  }
  const row = rows[0]!;
  return {
    sessionReplayId: row.sessionReplayId,
    issueClusterId: row.issueClusterId,
    issueFingerprint: row.issueFingerprint,
    issueTitle: row.issueTitle,
    status: parseStatus(row.status),
    summary: row.summary,
    whyLikely: row.whyLikely,
    severity: parseSeverity(row.severity),
    confidence: row.confidence,
    evidence: parseEvidenceArray(row.evidence),
    visualArtifacts: parseVisualArtifacts(row.visualArtifacts),
    relatedReplayIds: parseStringArray(row.relatedReplayIds),
    textEmbedding: parseEmbedding(row.textEmbedding),
    visualEmbedding: parseEmbedding(row.visualEmbedding),
    providerMetadata: parseRecord(row.providerMetadata),
    errorMessage: row.errorMessage,
    analyzedAt: row.analyzedAt,
    lastAnalyzedChunkCount: row.lastAnalyzedChunkCount,
  };
}

function toCrudReplaySummary(summary: ReplayAiAnalysisRow): ReplayAiSummary {
  return {
    session_replay_id: summary.sessionReplayId,
    issue_cluster_id: summary.issueClusterId,
    issue_fingerprint: summary.issueFingerprint,
    issue_title: summary.issueTitle,
    status: summary.status,
    summary: summary.summary,
    why_likely: summary.whyLikely,
    severity: summary.severity,
    confidence: summary.confidence,
    evidence: summary.evidence,
    visual_artifacts: summary.visualArtifacts,
    related_replay_ids: summary.relatedReplayIds,
    text_embedding: summary.textEmbedding,
    visual_embedding: summary.visualEmbedding,
    provider_metadata: summary.providerMetadata,
    error_message: summary.errorMessage,
    analyzed_at_millis: summary.analyzedAt?.getTime() ?? null,
    last_analyzed_chunk_count: summary.lastAnalyzedChunkCount,
  };
}

function makePendingReplaySummary(sessionReplayId: string): ReplayAiAnalysisRow {
  return {
    sessionReplayId,
    issueClusterId: null,
    issueFingerprint: null,
    issueTitle: null,
    status: "pending",
    summary: null,
    whyLikely: null,
    severity: null,
    confidence: null,
    evidence: [],
    visualArtifacts: [],
    relatedReplayIds: [],
    textEmbedding: null,
    visualEmbedding: null,
    providerMetadata: { provider: "pending" },
    errorMessage: null,
    analyzedAt: null,
    lastAnalyzedChunkCount: 0,
  };
}

async function upsertIssueCluster(
  prisma: PrismaClientWithReplica<PrismaClient>,
  input: {
    tenancyId: string,
    fingerprint: string,
    title: string,
    summary: string,
    severity: ReplayIssueSeverity,
    confidence: number,
    topEvidence: ReplayIssueEvidence[],
    textEmbedding: ReplayEmbeddingVectorRef,
    visualEmbedding: ReplayEmbeddingVectorRef | null,
    occurrenceAt: Date,
  },
): Promise<string> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    INSERT INTO "ReplayIssueCluster" (
      "tenancyId",
      "fingerprint",
      "title",
      "summary",
      "severity",
      "confidence",
      "occurrenceCount",
      "affectedUserCount",
      "firstSeenAt",
      "lastSeenAt",
      "topEvidence",
      "textEmbedding",
      "visualEmbedding",
      "createdAt",
      "updatedAt"
    )
    VALUES (
      ${input.tenancyId}::UUID,
      ${input.fingerprint},
      ${input.title},
      ${input.summary},
      ${input.severity.toUpperCase()}::"ReplayIssueSeverity",
      ${input.confidence},
      1,
      1,
      ${input.occurrenceAt},
      ${input.occurrenceAt},
      ${JSON.stringify(input.topEvidence)}::jsonb,
      ${JSON.stringify(input.textEmbedding)}::jsonb,
      ${input.visualEmbedding == null ? null : JSON.stringify(input.visualEmbedding)}::jsonb,
      NOW(),
      NOW()
    )
    ON CONFLICT ("tenancyId", "fingerprint")
    DO UPDATE SET
      "title" = EXCLUDED."title",
      "summary" = EXCLUDED."summary",
      "severity" = EXCLUDED."severity",
      "confidence" = EXCLUDED."confidence",
      "lastSeenAt" = GREATEST("ReplayIssueCluster"."lastSeenAt", EXCLUDED."lastSeenAt"),
      "topEvidence" = EXCLUDED."topEvidence",
      "textEmbedding" = EXCLUDED."textEmbedding",
      "visualEmbedding" = EXCLUDED."visualEmbedding",
      "updatedAt" = NOW()
    RETURNING "id"
  `;
  const id = rows[0]?.id;
  if (!id) {
    throw new StackAssertionError("Replay issue cluster upsert did not return an id", { fingerprint: input.fingerprint });
  }
  return id;
}

async function refreshIssueClusterStats(
  prisma: PrismaClientWithReplica<PrismaClient>,
  input: {
    tenancyId: string,
    issueClusterId: string,
  },
): Promise<void> {
  const aggregates = await prisma.$queryRaw<Array<{
    occurrenceCount: number,
    affectedUserCount: number,
    firstSeenAt: Date,
    lastSeenAt: Date,
  }>>`
    SELECT
      COUNT(*)::integer AS "occurrenceCount",
      COUNT(DISTINCT sr."projectUserId")::integer AS "affectedUserCount",
      MIN(sr."lastEventAt") AS "firstSeenAt",
      MAX(sr."lastEventAt") AS "lastSeenAt"
    FROM "ReplayAiSummary" ras
    JOIN "SessionReplay" sr
      ON sr."tenancyId" = ras."tenancyId"
     AND sr."id" = ras."sessionReplayId"
    WHERE ras."tenancyId" = ${input.tenancyId}::UUID
      AND ras."issueClusterId" = ${input.issueClusterId}::UUID
      AND ras."status" = 'READY'
  `;
  if (aggregates.length === 0) {
    return;
  }
  const aggregate = aggregates[0]!;
  await prisma.$executeRaw`
    UPDATE "ReplayIssueCluster"
    SET "occurrenceCount" = ${aggregate.occurrenceCount},
        "affectedUserCount" = ${aggregate.affectedUserCount},
        "firstSeenAt" = ${aggregate.firstSeenAt},
        "lastSeenAt" = ${aggregate.lastSeenAt},
        "updatedAt" = NOW()
    WHERE "id" = ${input.issueClusterId}::UUID
      AND "tenancyId" = ${input.tenancyId}::UUID
  `;
}

async function findSimilarReplayIds(
  prisma: PrismaClientWithReplica<PrismaClient>,
  input: {
    tenancyId: string,
    sessionReplayId: string,
    textEmbedding: ReplayEmbeddingVectorRef | null,
    visualEmbedding: ReplayEmbeddingVectorRef | null,
    limit: number,
  },
): Promise<string[]> {
  if (input.textEmbedding == null && input.visualEmbedding == null) return [];
  const candidates = await prisma.$queryRaw<SimilarReplayCandidateRow[]>`
    SELECT
      ras."sessionReplayId" AS "sessionReplayId",
      ras."summary",
      ras."severity"::text AS "severity",
      ras."issueTitle" AS "issueTitle",
      ras."textEmbedding",
      ras."visualEmbedding"
    FROM "ReplayAiSummary" ras
    WHERE ras."tenancyId" = ${input.tenancyId}::UUID
      AND ras."sessionReplayId" <> ${input.sessionReplayId}::UUID
      AND ras."status" = 'READY'
    ORDER BY ras."updatedAt" DESC
    LIMIT 100
  `;
  return candidates
    .map((candidate) => {
      const candidateTextEmbedding = parseEmbedding(candidate.textEmbedding);
      const candidateVisualEmbedding = parseEmbedding(candidate.visualEmbedding);
      const textScore = cosineSimilarity(input.textEmbedding?.values ?? [], candidateTextEmbedding?.values ?? []);
      const visualScore = cosineSimilarity(input.visualEmbedding?.values ?? [], candidateVisualEmbedding?.values ?? []);
      return {
        sessionReplayId: candidate.sessionReplayId,
        score: input.visualEmbedding != null && candidateVisualEmbedding != null
          ? (textScore * 0.7) + (visualScore * 0.3)
          : textScore,
      };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, input.limit)
    .map((candidate) => candidate.sessionReplayId);
}

function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length === 0 || right.length === 0 || left.length !== right.length) {
    return 0;
  }
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index++) {
    const leftValue = left[index]!;
    const rightValue = right[index]!;
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }
  const denominator = Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude);
  if (denominator === 0) return 0;
  return dot / denominator;
}

function parseEvidenceArray(value: unknown): ReplayIssueEvidence[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const record = item;
    const label = getStringValue(record, "label");
    const reason = getStringValue(record, "reason");
    const startOffsetMs = getNumberValue(record, "start_offset_ms");
    const endOffsetMs = getNumberValue(record, "end_offset_ms");
    if (label == null || reason == null || startOffsetMs == null || endOffsetMs == null) return [];
    return [{
      label,
      reason,
      start_offset_ms: startOffsetMs,
      end_offset_ms: endOffsetMs,
      event_type: getStringValue(record, "event_type"),
    }];
  });
}

function parseVisualArtifacts(value: unknown): ReplayVisualArtifact[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const record = item;
    const id = getStringValue(record, "id");
    const displayName = getStringValue(record, "display_name");
    const startOffsetMs = getNumberValue(record, "start_offset_ms");
    const altText = getStringValue(record, "alt_text");
    if (id == null || displayName == null || startOffsetMs == null || altText == null) return [];
    return [{
      id,
      display_name: displayName,
      kind: "timeline-card",
      start_offset_ms: startOffsetMs,
      mime_type: getStringValue(record, "mime_type"),
      data_url: getStringValue(record, "data_url"),
      alt_text: altText,
    }];
  });
}

function parseEmbedding(value: unknown): ReplayEmbeddingVectorRef | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const provider = getStringValue(value, "provider");
  const model = getStringValue(value, "model");
  const dimensions = getNumberValue(value, "dimensions");
  const generatedAtMillis = getNumberValue(value, "generated_at_millis");
  const values = readNumberArrayFromUnknown(getNestedValue(value, ["values"]));
  if (provider == null || model == null || dimensions == null || generatedAtMillis == null || values.length === 0) return null;
  return {
    provider,
    model,
    dimensions,
    generated_at_millis: generatedAtMillis,
    values,
  };
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function parseRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function parseSeverity(value: string | null): ReplayIssueSeverity | null {
  if (value == null) return null;
  switch (value.toLowerCase()) {
    case "low": {
      return "low";
    }
    case "medium": {
      return "medium";
    }
    case "high": {
      return "high";
    }
    case "critical": {
      return "critical";
    }
    default: {
      return null;
    }
  }
}

function parseStatus(value: string): "pending" | "ready" | "error" {
  switch (value.toLowerCase()) {
    case "ready": {
      return "ready";
    }
    case "error": {
      return "error";
    }
    default: {
      return "pending";
    }
  }
}

function getStringValue(record: object, key: string): string | null {
  const value = getNestedValue(record, [key]);
  return typeof value === "string" ? value : null;
}

function getNumberValue(record: object, key: string): number | null {
  const value = getNestedValue(record, [key]);
  return typeof value === "number" ? value : null;
}

function readTimestampValue(record: object, key: string): number {
  const value = getNestedValue(record, [key]);
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    return Number(value);
  }
  return Number.NaN;
}

function getNestedValue(value: unknown, path: string[]): unknown {
  let current: unknown = value;
  for (const key of path) {
    if (!isRecord(current) || !(key in current)) {
      return undefined;
    }
    current = current[key];
  }
  return current;
}

function readNumberArrayFromUnknown(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is number => typeof item === "number");
}

function isSupportedImageDataUrl(value: string | null): value is string {
  return typeof value === "string" && /^(data:image\/(?:png|jpeg|jpg|webp);base64,)/.test(value);
}

function parseImageDataUrl(dataUrl: string | null): { base64Data: string } | null {
  if (!isSupportedImageDataUrl(dataUrl)) return null;
  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex === -1) return null;
  return { base64Data: dataUrl.slice(commaIndex + 1) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function isReplayAiSchemaReady(prisma: PrismaClientWithReplica<PrismaClient>): Promise<boolean> {
  const rows = await prisma.$queryRaw<ReplayAiSchemaAvailabilityRow[]>`
    SELECT
      to_regclass('public."ReplayAiSummary"') IS NOT NULL AS "replayAiSummaryTableReady",
      to_regclass('public."ReplayIssueCluster"') IS NOT NULL AS "replayIssueClusterTableReady"
  `;
  if (rows.length === 0) {
    return false;
  }
  const row = rows[0]!;
  return row.replayAiSummaryTableReady && row.replayIssueClusterTableReady;
}

async function getProjectIdForTenancy(prisma: PrismaClientWithReplica<PrismaClient>, tenancyId: string): Promise<string> {
  const tenancy = await prisma.tenancy.findUnique({
    where: { id: tenancyId },
    select: { projectId: true },
  });
  return tenancy?.projectId ?? "";
}

async function getBranchIdForTenancy(prisma: PrismaClientWithReplica<PrismaClient>, tenancyId: string): Promise<string> {
  const tenancy = await prisma.tenancy.findUnique({
    where: { id: tenancyId },
    select: { branchId: true },
  });
  return tenancy?.branchId ?? "";
}
