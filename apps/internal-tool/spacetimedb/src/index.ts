import { schema, t, table, SenderError } from 'spacetimedb/server';
import { Timestamp, type Identity } from 'spacetimedb';

const OPERATOR_TTL_MILLIS = 60n * 60n * 1000n;
const OPERATOR_TTL_MICROS = OPERATOR_TTL_MILLIS * 1000n;

// Injected at publish time by the spacetime:inject-token pnpm script from STACK_MCP_LOG_TOKEN env var.
// Must match STACK_MCP_LOG_TOKEN in the backend .env.
const EXPECTED_LOG_TOKEN = '__SPACETIMEDB_LOG_TOKEN__';

function isExpiredOperator(now: Timestamp, row: { expiresAt: Timestamp | undefined }): boolean {
  return row.expiresAt != null && row.expiresAt.microsSinceUnixEpoch <= now.microsSinceUnixEpoch;
}

function removeExpiredOperators(ctx: {
  timestamp: Timestamp,
  db: {
    operators: {
      iter: () => Iterable<{ identity: Identity, expiresAt: Timestamp | undefined }>,
      identity: { delete: (identity: Identity) => void },
    },
  },
}): void {
  const expiredIdentities = new Array<Identity>();
  for (const row of ctx.db.operators.iter()) {
    if (isExpiredOperator(ctx.timestamp, row)) {
      expiredIdentities.push(row.identity);
    }
  }
  for (const identity of expiredIdentities) {
    ctx.db.operators.identity.delete(identity);
  }
}

function hasActiveOperator(ctx: {
  sender: Identity,
  db: {
    operators: {
      identity: { find: (identity: Identity) => { expiresAt: Timestamp | undefined } | null },
    },
  },
}): boolean {
  const operator = ctx.db.operators.identity.find(ctx.sender);
  return operator != null;
}

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
    humanReviewedAt: t.timestamp().optional(),
    humanReviewedBy: t.string().optional(),
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
    correlationId: t.string().unique(),
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
    cacheCreationTokens: t.u32().optional(),
    costUsd: t.f64().optional(),
    cacheDiscountUsd: t.f64().optional(),
    openrouterGenerationId: t.string().optional(),
    stepCount: t.u32(),
    durationMs: t.u64(),
    errorMessage: t.string().optional(),
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
    expiresAt: t.timestamp().optional(),
  }
);

const qaEntries = table(
  { name: 'qa_entries', public: false },
  {
    id: t.u64().primaryKey().autoInc(),
    shard: t.u8().index('btree'),
    sourceMcpCorrelationId: t.string().optional(),
    requestId: t.string().optional(),
    question: t.string(),
    answer: t.string(),
    createdBy: t.string(),
    createdAt: t.timestamp(),
    lastEditedBy: t.string(),
    lastEditedAt: t.timestamp(),
    published: t.bool().index('btree'),
    firstPublishedAt: t.timestamp().optional(),
    lastPublishedAt: t.timestamp().optional(),
  }
);

const spacetimedb = schema({ mcpCallLog, aiQueryLog, operators, qaEntries });
export default spacetimedb;
export const operatorsVisibility = spacetimedb.clientVisibilityFilter.sql(
  'SELECT * FROM operators WHERE identity = :sender'
);
export const myVisibleMcpCallLog = spacetimedb.view(
  { name: 'my_visible_mcp_call_log', public: true },
  t.array(mcpCallLog.rowType),
  (ctx) => {
    if (!hasActiveOperator(ctx)) return [];
    return Array.from(ctx.db.mcpCallLog.shard.filter(0));
  }
);
export const myVisibleAiQueryLog = spacetimedb.view(
  { name: 'my_visible_ai_query_log', public: true },
  t.array(aiQueryLog.rowType),
  (ctx) => {
    if (!hasActiveOperator(ctx)) return [];
    return Array.from(ctx.db.aiQueryLog.shard.filter(0));
  }
);
export const myVisibleQaEntries = spacetimedb.view(
  { name: 'my_visible_qa_entries', public: true },
  t.array(qaEntries.rowType),
  (ctx) => {
    if (!hasActiveOperator(ctx)) return [];
    return Array.from(ctx.db.qaEntries.shard.filter(0));
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
    for (const row of ctx.db.qaEntries.published.filter(true)) {
      out.push({
        id: row.id,
        question: row.question,
        answer: row.answer,
        publishedAt: row.lastPublishedAt,
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
    if (/^__.*__$/.test(args.stackUserId)) {
      throw new SenderError('stackUserId pattern __*__ is reserved');
    }
    removeExpiredOperators(ctx);

    const nowMicros = ctx.timestamp.microsSinceUnixEpoch;
    const expiresAt = new Timestamp(nowMicros + OPERATOR_TTL_MICROS);
    const existing = ctx.db.operators.identity.find(args.identity);
    if (existing != null) {
      ctx.db.operators.identity.update({
        identity: args.identity,
        addedAt: existing.addedAt,
        stackUserId: args.stackUserId,
        displayName: args.displayName,
        expiresAt,
      });
      return;
    }
    ctx.db.operators.insert({
      identity: args.identity,
      addedAt: ctx.timestamp,
      stackUserId: args.stackUserId,
      displayName: args.displayName,
      expiresAt,
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
    removeExpiredOperators(ctx);
    ctx.db.operators.identity.delete(args.identity);
  }
);

export const remove_operators_for_user = spacetimedb.reducer(
  {
    token: t.string(),
    stackUserId: t.string(),
  },
  (ctx, args) => {
    if (args.token !== EXPECTED_LOG_TOKEN) {
      throw new SenderError('Invalid log token');
    }
    if (/^__.*__$/.test(args.stackUserId)) {
      throw new SenderError('stackUserId pattern __*__ is reserved');
    }
    removeExpiredOperators(ctx);

    const identities = new Array<Identity>();
    for (const row of ctx.db.operators.iter()) {
      if (row.stackUserId === args.stackUserId) {
        identities.push(row.identity);
      }
    }
    for (const identity of identities) {
      ctx.db.operators.identity.delete(identity);
    }
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
    removeExpiredOperators(ctx);

    const existing = ctx.db.operators.identity.find(ctx.sender);
    if (existing != null) return;
    ctx.db.operators.insert({
      identity: ctx.sender,
      addedAt: ctx.timestamp,
      stackUserId: '__service__',
      displayName: args.displayName,
      expiresAt: undefined,
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
    removeExpiredOperators(ctx);
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
    removeExpiredOperators(ctx);
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

export const clear_mcp_qa_review = spacetimedb.reducer(
  {
    token: t.string(),
    correlationId: t.string(),
  },
  (ctx, args) => {
    if (args.token !== EXPECTED_LOG_TOKEN) {
      throw new SenderError('Invalid log token');
    }
    removeExpiredOperators(ctx);
    const row = ctx.db.mcpCallLog.correlationId.find(args.correlationId);
    if (row == null) {
      throw new SenderError('Call log not found for correlationId: ' + args.correlationId);
    }
    ctx.db.mcpCallLog.id.update({
      ...row,
      qaReviewedAt: undefined,
      qaNeedsHumanReview: undefined,
      qaAnswerCorrect: undefined,
      qaAnswerRelevant: undefined,
      qaFlagsJson: undefined,
      qaImprovementSuggestions: undefined,
      qaOverallScore: undefined,
      qaReviewModelId: undefined,
      qaConversationJson: undefined,
      qaErrorMessage: undefined,
    });
  }
);

export const set_human_reviewed = spacetimedb.reducer(
  {
    token: t.string(),
    correlationId: t.string(),
    reviewed: t.bool(),
    reviewedBy: t.string(),
  },
  (ctx, args) => {
    if (args.token !== EXPECTED_LOG_TOKEN) {
      throw new SenderError('Invalid log token');
    }
    removeExpiredOperators(ctx);
    const row = ctx.db.mcpCallLog.correlationId.find(args.correlationId);
    if (row == null) {
      throw new SenderError('Call log not found for correlationId: ' + args.correlationId);
    }
    ctx.db.mcpCallLog.id.update({
      ...row,
      humanReviewedAt: args.reviewed ? ctx.timestamp : undefined,
      humanReviewedBy: args.reviewed ? args.reviewedBy : undefined,
    });
  }
);

export const upsert_qa_from_call = spacetimedb.reducer(
  {
    token: t.string(),
    correlationId: t.string(),
    question: t.string(),
    answer: t.string(),
    publish: t.bool(),
    editedBy: t.string(),
  },
  (ctx, args) => {
    if (args.token !== EXPECTED_LOG_TOKEN) {
      throw new SenderError('Invalid log token');
    }
    removeExpiredOperators(ctx);
    if (ctx.db.mcpCallLog.correlationId.find(args.correlationId) == null) {
      throw new SenderError('Call log not found for correlationId: ' + args.correlationId);
    }
    let existing = null;
    for (const row of ctx.db.qaEntries.shard.filter(0)) {
      if (row.sourceMcpCorrelationId === args.correlationId) {
        existing = row;
        break;
      }
    }
    if (existing != null) {
      ctx.db.qaEntries.id.update({
        ...existing,
        question: args.question,
        answer: args.answer,
        lastEditedBy: args.editedBy,
        lastEditedAt: ctx.timestamp,
        published: args.publish,
        firstPublishedAt: args.publish ? (existing.firstPublishedAt ?? ctx.timestamp) : existing.firstPublishedAt,
        lastPublishedAt: args.publish ? ctx.timestamp : existing.lastPublishedAt,
      });
      return;
    }
    ctx.db.qaEntries.insert({
      id: 0n,
      shard: 0,
      sourceMcpCorrelationId: args.correlationId,
      requestId: undefined,
      question: args.question,
      answer: args.answer,
      createdBy: args.editedBy,
      createdAt: ctx.timestamp,
      lastEditedBy: args.editedBy,
      lastEditedAt: ctx.timestamp,
      published: args.publish,
      firstPublishedAt: args.publish ? ctx.timestamp : undefined,
      lastPublishedAt: args.publish ? ctx.timestamp : undefined,
    } as Parameters<typeof ctx.db.qaEntries.insert>[0]);
  }
);

export const upsert_qa_from_call_and_mark_reviewed = spacetimedb.reducer(
  {
    token: t.string(),
    correlationId: t.string(),
    question: t.string(),
    answer: t.string(),
    publish: t.bool(),
    reviewer: t.string(),
  },
  (ctx, args) => {
    if (args.token !== EXPECTED_LOG_TOKEN) {
      throw new SenderError('Invalid log token');
    }
    removeExpiredOperators(ctx);
    const callLogRow = ctx.db.mcpCallLog.correlationId.find(args.correlationId);
    if (callLogRow == null) {
      throw new SenderError('Call log not found for correlationId: ' + args.correlationId);
    }

    let existing = null;
    for (const row of ctx.db.qaEntries.shard.filter(0)) {
      if (row.sourceMcpCorrelationId === args.correlationId) {
        existing = row;
        break;
      }
    }
    if (existing != null) {
      ctx.db.qaEntries.id.update({
        ...existing,
        question: args.question,
        answer: args.answer,
        lastEditedBy: args.reviewer,
        lastEditedAt: ctx.timestamp,
        published: args.publish,
        firstPublishedAt: args.publish ? (existing.firstPublishedAt ?? ctx.timestamp) : existing.firstPublishedAt,
        lastPublishedAt: args.publish ? ctx.timestamp : existing.lastPublishedAt,
      });
    } else {
      ctx.db.qaEntries.insert({
        id: 0n,
        shard: 0,
        sourceMcpCorrelationId: args.correlationId,
        requestId: undefined,
        question: args.question,
        answer: args.answer,
        createdBy: args.reviewer,
        createdAt: ctx.timestamp,
        lastEditedBy: args.reviewer,
        lastEditedAt: ctx.timestamp,
        published: args.publish,
        firstPublishedAt: args.publish ? ctx.timestamp : undefined,
        lastPublishedAt: args.publish ? ctx.timestamp : undefined,
      } as Parameters<typeof ctx.db.qaEntries.insert>[0]);
    }

    ctx.db.mcpCallLog.id.update({
      ...callLogRow,
      humanReviewedAt: ctx.timestamp,
      humanReviewedBy: args.reviewer,
    });
  }
);

export const add_manual_qa = spacetimedb.reducer(
  {
    token: t.string(),
    question: t.string(),
    answer: t.string(),
    publish: t.bool(),
    createdBy: t.string(),
    requestId: t.string(),
  },
  (ctx, args) => {
    if (args.token !== EXPECTED_LOG_TOKEN) {
      throw new SenderError('Invalid log token');
    }
    removeExpiredOperators(ctx);
    if (args.requestId !== '') {
      for (const existing of ctx.db.qaEntries.iter()) {
        if (existing.requestId === args.requestId) return;
      }
    }
    ctx.db.qaEntries.insert({
      id: 0n,
      shard: 0,
      sourceMcpCorrelationId: undefined,
      requestId: args.requestId,
      question: args.question,
      answer: args.answer,
      createdBy: args.createdBy,
      createdAt: ctx.timestamp,
      lastEditedBy: args.createdBy,
      lastEditedAt: ctx.timestamp,
      published: args.publish,
      firstPublishedAt: args.publish ? ctx.timestamp : undefined,
      lastPublishedAt: args.publish ? ctx.timestamp : undefined,
    } as Parameters<typeof ctx.db.qaEntries.insert>[0]);
  }
);

export const delete_qa_entry = spacetimedb.reducer(
  {
    token: t.string(),
    qaId: t.u64(),
  },
  (ctx, args) => {
    if (args.token !== EXPECTED_LOG_TOKEN) {
      throw new SenderError('Invalid log token');
    }
    removeExpiredOperators(ctx);
    const row = ctx.db.qaEntries.id.find(args.qaId);
    if (row == null) {
      throw new SenderError('QA entry not found for qaId: ' + args.qaId.toString());
    }
    ctx.db.qaEntries.id.delete(row.id);
  }
);

export const update_qa_entry_with_publish = spacetimedb.reducer(
  {
    token: t.string(),
    qaId: t.u64(),
    question: t.string(),
    answer: t.string(),
    publish: t.bool(),
    editedBy: t.string(),
  },
  (ctx, args) => {
    if (args.token !== EXPECTED_LOG_TOKEN) {
      throw new SenderError('Invalid log token');
    }
    removeExpiredOperators(ctx);
    const row = ctx.db.qaEntries.id.find(args.qaId);
    if (row == null) {
      throw new SenderError('QA entry not found for qaId: ' + args.qaId.toString());
    }
    ctx.db.qaEntries.id.update({
      ...row,
      question: args.question,
      answer: args.answer,
      lastEditedBy: args.editedBy,
      lastEditedAt: ctx.timestamp,
      published: args.publish,
      firstPublishedAt: args.publish ? (row.firstPublishedAt ?? ctx.timestamp) : row.firstPublishedAt,
      lastPublishedAt: args.publish ? ctx.timestamp : row.lastPublishedAt,
    });
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
    cacheCreationTokens: t.u32().optional(),
    costUsd: t.f64().optional(),
    cacheDiscountUsd: t.f64().optional(),
    openrouterGenerationId: t.string().optional(),
    stepCount: t.u32(),
    durationMs: t.u64(),
    errorMessage: t.string().optional(),
    conversationId: t.string().optional(),
  },
  (ctx, args) => {
    if (args.token !== EXPECTED_LOG_TOKEN) {
      throw new SenderError('Invalid log token');
    }
    removeExpiredOperators(ctx);
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
      cacheCreationTokens: args.cacheCreationTokens,
      costUsd: args.costUsd,
      cacheDiscountUsd: args.cacheDiscountUsd,
      openrouterGenerationId: args.openrouterGenerationId,
      stepCount: args.stepCount,
      durationMs: args.durationMs,
      errorMessage: args.errorMessage,
      conversationId: args.conversationId,
    } as Parameters<typeof ctx.db.aiQueryLog.insert>[0]);
  }
);

export const update_ai_query_cost = spacetimedb.reducer(
  {
    token: t.string(),
    correlationId: t.string(),
    costUsd: t.f64().optional(),
    cacheDiscountUsd: t.f64().optional(),
  },
  (ctx, args) => {
    if (args.token !== EXPECTED_LOG_TOKEN) {
      throw new SenderError('Invalid log token');
    }
    removeExpiredOperators(ctx);
    const row = ctx.db.aiQueryLog.correlationId.find(args.correlationId);
    if (row == null) {
      throw new SenderError('AI query log not found for correlationId: ' + args.correlationId);
    }
    ctx.db.aiQueryLog.id.update({
      ...row,
      costUsd: args.costUsd ?? row.costUsd,
      cacheDiscountUsd: args.cacheDiscountUsd ?? row.cacheDiscountUsd,
    });
  }
);

export const delete_mcp_call_log = spacetimedb.reducer(
  {
    token: t.string(),
    correlationId: t.string(),
  },
  (ctx, args) => {
    if (args.token !== EXPECTED_LOG_TOKEN) {
      throw new SenderError('Invalid log token');
    }
    removeExpiredOperators(ctx);
    const row = ctx.db.mcpCallLog.correlationId.find(args.correlationId);
    if (row == null) {
      throw new SenderError('Call log not found for correlationId: ' + args.correlationId);
    }
    ctx.db.mcpCallLog.id.delete(row.id);
  }
);

export const delete_ai_query_log = spacetimedb.reducer(
  {
    token: t.string(),
    correlationId: t.string(),
  },
  (ctx, args) => {
    if (args.token !== EXPECTED_LOG_TOKEN) {
      throw new SenderError('Invalid log token');
    }
    removeExpiredOperators(ctx);
    const row = ctx.db.aiQueryLog.correlationId.find(args.correlationId);
    if (row == null) {
      throw new SenderError('Log entry not found for correlationId: ' + args.correlationId);
    }
    ctx.db.aiQueryLog.id.delete(row.id);
  }
);

export const init = spacetimedb.init(_ctx => {});
