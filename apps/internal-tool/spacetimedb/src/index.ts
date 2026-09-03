import { schema, t, table, SenderError } from 'spacetimedb/server';

// Injected at publish time by the spacetime:inject-token pnpm script from STACK_MCP_LOG_TOKEN env var.
// Must match STACK_MCP_LOG_TOKEN in the backend .env.
const EXPECTED_LOG_TOKEN = '__SPACETIMEDB_LOG_TOKEN__';

const mcpCallLog = table(
  { name: 'mcp_call_log', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    correlationId: t.string(),
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
    publishedToQa: t.bool().optional(),
    publishedAt: t.timestamp().optional(),
  }
);

const spacetimedb = schema({ mcpCallLog });
export default spacetimedb;

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
    for (const row of ctx.db.mcpCallLog.iter()) {
      if (row.correlationId === args.correlationId) {
        ctx.db.mcpCallLog.delete(row);
        ctx.db.mcpCallLog.insert({
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
        return;
      }
    }
    throw new SenderError('Call log not found for correlationId: ' + args.correlationId);
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
    for (const row of ctx.db.mcpCallLog.iter()) {
      if (row.correlationId === args.correlationId) {
        ctx.db.mcpCallLog.delete(row);
        ctx.db.mcpCallLog.insert({
          ...row,
          humanReviewedAt: ctx.timestamp,
          humanReviewedBy: args.reviewedBy,
        });
        return;
      }
    }
    throw new SenderError('Call log not found for correlationId: ' + args.correlationId);
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
    for (const row of ctx.db.mcpCallLog.iter()) {
      if (row.correlationId === args.correlationId) {
        ctx.db.mcpCallLog.delete(row);
        ctx.db.mcpCallLog.insert({
          ...row,
          humanCorrectedQuestion: args.correctedQuestion,
          humanCorrectedAnswer: args.correctedAnswer,
          humanReviewedAt: row.humanReviewedAt ?? ctx.timestamp,
          humanReviewedBy: row.humanReviewedBy ?? args.reviewedBy,
          publishedToQa: args.publish,
          publishedAt: args.publish ? (row.publishedAt ?? ctx.timestamp) : undefined,
        });
        return;
      }
    }
    throw new SenderError('Call log not found for correlationId: ' + args.correlationId);
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
    for (const row of ctx.db.mcpCallLog.iter()) {
      if (row.correlationId === args.correlationId) {
        ctx.db.mcpCallLog.delete(row);
        return;
      }
    }
    throw new SenderError('Call log not found for correlationId: ' + args.correlationId);
  }
);

export const init = spacetimedb.init(_ctx => {});
