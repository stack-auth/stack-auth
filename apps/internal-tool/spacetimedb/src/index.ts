import { schema, t, table, SenderError } from 'spacetimedb/server';
import type { Timestamp } from 'spacetimedb';

// Injected at publish time by the spacetime:inject-token pnpm script from STACK_MCP_LOG_TOKEN env var.
// Must match STACK_MCP_LOG_TOKEN in the backend .env.
const EXPECTED_LOG_TOKEN = '__SPACETIMEDB_LOG_TOKEN__';

const mcpCallLog = table(
  { name: 'mcp_call_log', public: false },
  {
    id: t.u64().primaryKey().autoInc(),
    shard: t.u8().index('btree'),
    correlationId: t.string().unique(),
    conversationId: t.string().optional(),
    createdAt: t.timestamp(),
    toolName: t.string(),
    reason: t.string(),
    userPrompt: t.string(),
    question: t.string(),
    response: t.string(),
    stepCount: t.u32(),
    innerToolCallsJson: t.string(),
    durationMs: t.u64(),
    modelId: t.string(),
    errorMessage: t.string().optional(),
    // QA review fields (populated asynchronously after initial log)
    qaReviewedAt: t.timestamp().optional(),
    qaNeedsHumanReview: t.bool().optional(),
    qaAnswerCorrect: t.bool().optional(),
    qaAnswerRelevant: t.bool().optional(),
    qaFlagsJson: t.string().optional(),
    qaImprovementSuggestions: t.string().optional(),
    qaOverallScore: t.u32().optional(),
    qaReviewModelId: t.string().optional(),
    qaConversationJson: t.string().optional(),
    qaErrorMessage: t.string().optional(),
    // Human review
    humanReviewedAt: t.timestamp().optional(),
    humanReviewedBy: t.string().optional(),
    // Human corrections & publishing
    humanCorrectedQuestion: t.string().optional(),
    humanCorrectedAnswer: t.string().optional(),
    publishedToQa: t.bool().index('btree'),
    publishedAt: t.timestamp().optional(),
  }
);

const aiQueryLog = table(
  { name: 'ai_query_log', public: false },
  {
    id: t.u64().primaryKey().autoInc(),
    shard: t.u8().index('btree'),
    correlationId: t.string(),
    createdAt: t.timestamp(),
    mode: t.string(),
    systemPromptId: t.string(),
    quality: t.string(),
    speed: t.string(),
    modelId: t.string(),
    isAuthenticated: t.bool(),
    projectId: t.string().optional(),
    userId: t.string().optional(),
    requestedToolsJson: t.string(),
    messagesJson: t.string(),
    stepsJson: t.string(),
    finalText: t.string(),
    inputTokens: t.u32().optional(),
    outputTokens: t.u32().optional(),
    cachedInputTokens: t.u32().optional(),
    costUsd: t.f64().optional(),
    stepCount: t.u32(),
    durationMs: t.u64(),
    errorMessage: t.string().optional(),
    mcpCorrelationId: t.string().optional(),
    conversationId: t.string().optional(),
  }
);

const operators = table(
  { name: 'operators', public: true },
  {
    identity: t.identity().primaryKey(),
    addedAt: t.timestamp(),
    stackUserId: t.string(),
    displayName: t.string(),
  }
);

const spacetimedb = schema({ mcpCallLog, aiQueryLog, operators });
export default spacetimedb;

// Operators can only see their own row in the operators table.
export const operatorsVisibility = spacetimedb.clientVisibilityFilter.sql(
  'SELECT * FROM operators WHERE identity = :sender'
);

// Reviewers subscribe to these views instead of the raw (private) log tables.
// Each view gates on operator-table membership; non-operators see zero rows.
// The `.shard.filter(0)` call returns every row — all rows have `shard = 0`
// and the btree index on `shard` covers them. Views cannot use `.iter()` and
// primary keys don't expose `.filter()`, so a sentinel non-primary index is
// required for full-table traversal.
export const myVisibleMcpCallLog = spacetimedb.view(
  { name: 'my_visible_mcp_call_log', public: true },
  t.array(mcpCallLog.rowType),
  (ctx) => {
    if (ctx.db.operators.identity.find(ctx.sender) == null) return [];
    return Array.from(ctx.db.mcpCallLog.shard.filter(0));
  }
);
export const myVisibleAiQueryLog = spacetimedb.view(
  { name: 'my_visible_ai_query_log', public: true },
  t.array(aiQueryLog.rowType),
  (ctx) => {
    if (ctx.db.operators.identity.find(ctx.sender) == null) return [];
    return Array.from(ctx.db.aiQueryLog.shard.filter(0));
  }
);

// Public view for the /questions page — returns rows reviewers have explicitly
// published. Uses `anonymousView` so SpacetimeDB materializes once and shares
// the result across all subscribers. Projected to only fields the public page
// needs; everything else (reviewer attribution, QA internals, raw prompt,
// tool-call metadata) stays private.
const publishedQaRow = t.object('PublishedQaRow', {
  id: t.u64(),
  question: t.string(),
  answer: t.string(),
  publishedAt: t.timestamp().optional(),
});

export const publishedQa = spacetimedb.anonymousView(
  { name: 'published_qa', public: true },
  t.array(publishedQaRow),
  (ctx) => {
    const out: Array<{
      id: bigint,
      question: string,
      answer: string,
      publishedAt: Timestamp | undefined,
    }> = [];
    for (const row of ctx.db.mcpCallLog.publishedToQa.filter(true)) {
      out.push({
        id: row.id,
        question: row.humanCorrectedQuestion ?? row.question,
        answer: row.humanCorrectedAnswer ?? row.response,
        publishedAt: row.publishedAt,
      });
    }
    return out;
  },
);

export const add_operator = spacetimedb.reducer(
  {
    token: t.string(),
    identity: t.identity(),
    stackUserId: t.string(),
    displayName: t.string(),
  },
  (ctx, args) => {
    if (args.token !== EXPECTED_LOG_TOKEN) {
      throw new SenderError('Invalid log token');
    }
    const existing = ctx.db.operators.identity.find(args.identity);
    if (existing != null) {
      if (existing.stackUserId !== args.stackUserId) {
        throw new SenderError('Identity is bound to a different Stack user');
      }
      ctx.db.operators.identity.update({
        identity: args.identity,
        addedAt: existing.addedAt,
        stackUserId: args.stackUserId,
        displayName: args.displayName,
      });
      return;
    }
    const stale = [];
    for (const row of ctx.db.operators.iter()) {
      if (row.stackUserId === args.stackUserId) {
        stale.push(row);
      }
    }
    for (const row of stale) {
      ctx.db.operators.identity.delete(row.identity);
    }
    ctx.db.operators.insert({
      identity: args.identity,
      addedAt: ctx.timestamp,
      stackUserId: args.stackUserId,
      displayName: args.displayName,
    });
  }
);

export const remove_operator = spacetimedb.reducer(
  {
    token: t.string(),
    identity: t.identity(),
  },
  (ctx, args) => {
    if (args.token !== EXPECTED_LOG_TOKEN) {
      throw new SenderError('Invalid log token');
    }
    ctx.db.operators.identity.delete(args.identity);
  }
);

export const enroll_service = spacetimedb.reducer(
  {
    token: t.string(),
    displayName: t.string(),
  },
  (ctx, args) => {
    if (args.token !== EXPECTED_LOG_TOKEN) {
      throw new SenderError('Invalid log token');
    }
    const existing = ctx.db.operators.identity.find(ctx.sender);
    if (existing != null) return;
    ctx.db.operators.insert({
      identity: ctx.sender,
      addedAt: ctx.timestamp,
      stackUserId: '__service__',
      displayName: args.displayName,
    });
  }
);

export const log_mcp_call = spacetimedb.reducer(
  {
    token: t.string(),
    correlationId: t.string(),
    conversationId: t.string().optional(),
    toolName: t.string(),
    reason: t.string(),
    userPrompt: t.string(),
    question: t.string(),
    response: t.string(),
    stepCount: t.u32(),
    innerToolCallsJson: t.string(),
    durationMs: t.u64(),
    modelId: t.string(),
    errorMessage: t.string().optional(),
  },
  (ctx, args) => {
    if (args.token !== EXPECTED_LOG_TOKEN) {
      throw new SenderError('Invalid log token');
    }
    ctx.db.mcpCallLog.insert({
      id: 0n,
      shard: 0,
      correlationId: args.correlationId,
      conversationId: args.conversationId,
      createdAt: ctx.timestamp,
      toolName: args.toolName,
      reason: args.reason,
      userPrompt: args.userPrompt,
      question: args.question,
      response: args.response,
      stepCount: args.stepCount,
      innerToolCallsJson: args.innerToolCallsJson,
      durationMs: args.durationMs,
      modelId: args.modelId,
      errorMessage: args.errorMessage,
      publishedToQa: false,
    } as Parameters<typeof ctx.db.mcpCallLog.insert>[0]);
  }
);

export const update_mcp_qa_review = spacetimedb.reducer(
  {
    token: t.string(),
    correlationId: t.string(),
    qaNeedsHumanReview: t.bool(),
    qaAnswerCorrect: t.bool(),
    qaAnswerRelevant: t.bool(),
    qaFlagsJson: t.string(),
    qaImprovementSuggestions: t.string(),
    qaOverallScore: t.u32(),
    qaReviewModelId: t.string(),
    qaConversationJson: t.string().optional(),
    qaErrorMessage: t.string().optional(),
  },
  (ctx, args) => {
    if (args.token !== EXPECTED_LOG_TOKEN) {
      throw new SenderError('Invalid log token');
    }
    const row = ctx.db.mcpCallLog.correlationId.find(args.correlationId);
    if (row == null) {
      throw new SenderError('Call log not found for correlationId: ' + args.correlationId);
    }
    ctx.db.mcpCallLog.id.update({
      ...row,
      qaReviewedAt: ctx.timestamp,
      qaNeedsHumanReview: args.qaNeedsHumanReview,
      qaAnswerCorrect: args.qaAnswerCorrect,
      qaAnswerRelevant: args.qaAnswerRelevant,
      qaFlagsJson: args.qaFlagsJson,
      qaImprovementSuggestions: args.qaImprovementSuggestions,
      qaOverallScore: args.qaOverallScore,
      qaReviewModelId: args.qaReviewModelId,
      qaConversationJson: args.qaConversationJson,
      qaErrorMessage: args.qaErrorMessage,
    });
  }
);

export const mark_human_reviewed = spacetimedb.reducer(
  {
    token: t.string(),
    correlationId: t.string(),
    reviewedBy: t.string(),
  },
  (ctx, args) => {
    if (args.token !== EXPECTED_LOG_TOKEN) {
      throw new SenderError('Invalid log token');
    }
    const row = ctx.db.mcpCallLog.correlationId.find(args.correlationId);
    if (row == null) {
      throw new SenderError('Call log not found for correlationId: ' + args.correlationId);
    }
    ctx.db.mcpCallLog.id.update({
      ...row,
      humanReviewedAt: ctx.timestamp,
      humanReviewedBy: args.reviewedBy,
    });
  }
);

export const unmark_human_reviewed = spacetimedb.reducer(
  {
    token: t.string(),
    correlationId: t.string(),
  },
  (ctx, args) => {
    if (args.token !== EXPECTED_LOG_TOKEN) {
      throw new SenderError('Invalid log token');
    }
    const row = ctx.db.mcpCallLog.correlationId.find(args.correlationId);
    if (row == null) {
      throw new SenderError('Call log not found for correlationId: ' + args.correlationId);
    }
    ctx.db.mcpCallLog.id.update({
      ...row,
      humanReviewedAt: undefined,
      humanReviewedBy: undefined,
    });
  }
);

export const update_human_correction = spacetimedb.reducer(
  {
    token: t.string(),
    correlationId: t.string(),
    correctedQuestion: t.string(),
    correctedAnswer: t.string(),
    publish: t.bool(),
    reviewedBy: t.string(),
  },
  (ctx, args) => {
    if (args.token !== EXPECTED_LOG_TOKEN) {
      throw new SenderError('Invalid log token');
    }
    const row = ctx.db.mcpCallLog.correlationId.find(args.correlationId);
    if (row == null) {
      throw new SenderError('Call log not found for correlationId: ' + args.correlationId);
    }
    ctx.db.mcpCallLog.id.update({
      ...row,
      humanCorrectedQuestion: args.correctedQuestion,
      humanCorrectedAnswer: args.correctedAnswer,
      humanReviewedAt: row.humanReviewedAt ?? ctx.timestamp,
      humanReviewedBy: row.humanReviewedBy ?? args.reviewedBy,
      publishedToQa: args.publish,
      publishedAt: args.publish ? (row.publishedAt ?? ctx.timestamp) : undefined,
    });
  }
);

export const add_manual_qa = spacetimedb.reducer(
  {
    token: t.string(),
    question: t.string(),
    answer: t.string(),
    publish: t.bool(),
    reviewedBy: t.string(),
  },
  (ctx, args) => {
    if (args.token !== EXPECTED_LOG_TOKEN) {
      throw new SenderError('Invalid log token');
    }
    ctx.db.mcpCallLog.insert({
      id: 0n,
      shard: 0,
      correlationId: ctx.newUuidV4().toString(),
      createdAt: ctx.timestamp,
      toolName: "manual",
      reason: "Manually added Q&A",
      userPrompt: "",
      question: args.question,
      response: "",
      stepCount: 0,
      innerToolCallsJson: "[]",
      durationMs: 0n,
      modelId: "human",
      humanCorrectedQuestion: args.question,
      humanCorrectedAnswer: args.answer,
      humanReviewedAt: ctx.timestamp,
      humanReviewedBy: args.reviewedBy,
      publishedToQa: args.publish,
      publishedAt: args.publish ? ctx.timestamp : undefined,
    } as Parameters<typeof ctx.db.mcpCallLog.insert>[0]);
  }
);

export const delete_qa_entry = spacetimedb.reducer(
  {
    token: t.string(),
    correlationId: t.string(),
  },
  (ctx, args) => {
    if (args.token !== EXPECTED_LOG_TOKEN) {
      throw new SenderError('Invalid log token');
    }
    const row = ctx.db.mcpCallLog.correlationId.find(args.correlationId);
    if (row == null) {
      throw new SenderError('Call log not found for correlationId: ' + args.correlationId);
    }
    ctx.db.mcpCallLog.id.delete(row.id);
  }
);

export const log_ai_query = spacetimedb.reducer(
  {
    token: t.string(),
    correlationId: t.string(),
    mode: t.string(),
    systemPromptId: t.string(),
    quality: t.string(),
    speed: t.string(),
    modelId: t.string(),
    isAuthenticated: t.bool(),
    projectId: t.string().optional(),
    userId: t.string().optional(),
    requestedToolsJson: t.string(),
    messagesJson: t.string(),
    stepsJson: t.string(),
    finalText: t.string(),
    inputTokens: t.u32().optional(),
    outputTokens: t.u32().optional(),
    cachedInputTokens: t.u32().optional(),
    costUsd: t.f64().optional(),
    stepCount: t.u32(),
    durationMs: t.u64(),
    errorMessage: t.string().optional(),
    mcpCorrelationId: t.string().optional(),
    conversationId: t.string().optional(),
  },
  (ctx, args) => {
    if (args.token !== EXPECTED_LOG_TOKEN) {
      throw new SenderError('Invalid log token');
    }
    ctx.db.aiQueryLog.insert({
      id: 0n,
      shard: 0,
      correlationId: args.correlationId,
      createdAt: ctx.timestamp,
      mode: args.mode,
      systemPromptId: args.systemPromptId,
      quality: args.quality,
      speed: args.speed,
      modelId: args.modelId,
      isAuthenticated: args.isAuthenticated,
      projectId: args.projectId,
      userId: args.userId,
      requestedToolsJson: args.requestedToolsJson,
      messagesJson: args.messagesJson,
      stepsJson: args.stepsJson,
      finalText: args.finalText,
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      cachedInputTokens: args.cachedInputTokens,
      costUsd: args.costUsd,
      stepCount: args.stepCount,
      durationMs: args.durationMs,
      errorMessage: args.errorMessage,
      mcpCorrelationId: args.mcpCorrelationId,
      conversationId: args.conversationId,
    } as Parameters<typeof ctx.db.aiQueryLog.insert>[0]);
  }
);

export const init = spacetimedb.init(_ctx => {});
