import { schema, t, table, SenderError } from 'spacetimedb/server';
import { Timestamp, type Identity } from 'spacetimedb';

// Injected at publish time by scripts/spacetime-auth-config.mjs (non-secret).
// SpacetimeDB validates the JWT signature via OIDC discovery on the token's
// issuer; these constants pin WHICH issuers/audience this module trusts, so a
// valid token from any other OIDC provider cannot be replayed here. The
// trusted issuer is the internal tool itself — it serves the discovery
// document + JWKS and mints tokens only for signed-in Stack Auth users of the
// tool's project (see ../../src/lib/server/spacetimedb-token.ts).
const ALLOWED_ISSUERS: readonly string[] = ['__SPACETIMEDB_ALLOWED_ISSUERS__'];
const EXPECTED_AUDIENCE = '__SPACETIMEDB_EXPECTED_AUDIENCE__';

// Fallback session lifetime when a JWT carries no `exp` claim. Stack Auth
// access tokens always carry one (~10min), so this is defensive only.
const FALLBACK_SESSION_TTL_MICROS = 15n * 60n * 1000n * 1000n;

type SenderAuthLike = Readonly<{
  isInternal: boolean,
  jwt: Readonly<{
    issuer: string,
    audience: readonly string[],
    subject: string,
    fullPayload: { readonly [key: string]: unknown },
  }> | null,
}>;

// Holding a token from the trusted issuer IS the authorization: the internal
// tool only mints tokens for signed-in members of its Stack Auth project, and
// that project's sign-up rules restrict membership to the team. Any member
// may read and write everything here.
function isProjectMember(senderAuth: SenderAuthLike): boolean {
  if (senderAuth.isInternal) {
    // Scheduled reducers / module-internal calls are already trusted.
    return true;
  }
  const jwt = senderAuth.jwt;
  if (jwt == null) return false;
  if (!ALLOWED_ISSUERS.includes(jwt.issuer)) return false;
  if (!jwt.audience.includes(EXPECTED_AUDIENCE)) return false;
  return true;
}

function requireProjectMember(senderAuth: SenderAuthLike): void {
  if (!isProjectMember(senderAuth)) {
    throw new SenderError('Unauthorized: a member token of the trusted Stack Auth project is required');
  }
}

// Attribution for human actions (review/edit/create) is derived from the
// caller's validated token, never from a reducer argument: the internal tool
// mints tokens with a server-attested `name` claim only after verifying the
// Stack Auth session, so a member cannot forge who an action is credited to by
// passing a different string. Falls back to the stable subject (Stack Auth
// user id), then a sentinel for service/internal callers.
function actorName(senderAuth: SenderAuthLike): string {
  const jwt = senderAuth.jwt;
  if (jwt != null) {
    const name = jwt.fullPayload['name'];
    if (typeof name === 'string' && name !== '') return name;
    if (jwt.subject !== '') return jwt.subject;
  }
  return 'unknown';
}

function isExpiredSession(now: Timestamp, row: { expiresAt: Timestamp }): boolean {
  return row.expiresAt.microsSinceUnixEpoch <= now.microsSinceUnixEpoch;
}

function removeExpiredSessions(ctx: {
  timestamp: Timestamp,
  db: {
    sessions: {
      iter: () => Iterable<{ identity: Identity, expiresAt: Timestamp }>,
      identity: { delete: (identity: Identity) => void },
    },
  },
}): void {
  const expiredIdentities = new Array<Identity>();
  for (const row of ctx.db.sessions.iter()) {
    if (isExpiredSession(ctx.timestamp, row)) {
      expiredIdentities.push(row.identity);
    }
  }
  for (const identity of expiredIdentities) {
    ctx.db.sessions.identity.delete(identity);
  }
}

function hasMemberSession(ctx: {
  sender: Identity,
  db: {
    sessions: {
      identity: { find: (identity: Identity) => { identity: Identity } | null },
    },
  },
}): boolean {
  return ctx.db.sessions.identity.find(ctx.sender) != null;
}
const MAX_LIVE_LOG_ROWS = 200;

function newestById<Row extends { id: bigint }>(rows: Iterable<Row>): Row[] {
  const all = Array.from(rows);
  all.sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)); // desc
  if (all.length > MAX_LIVE_LOG_ROWS) all.length = MAX_LIVE_LOG_ROWS;
  return all;
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

// Session cache derived from validated JWTs at connect time. Views cannot
// read JWT claims (their ctx only has `sender`), so `clientConnected` maps
// each connecting identity to the grants its token carried. Self-enrolled
// only — there is no reducer that can write to this table on behalf of
// someone else. Rows expire with the token's `exp` and are garbage-collected
// opportunistically on subsequent connects.
const sessions = table(
  { name: 'sessions', public: false },
  {
    identity: t.identity().primaryKey(),
    stackUserId: t.string(),
    connectedAt: t.timestamp(),
    expiresAt: t.timestamp(),
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

const spacetimedb = schema({ mcpCallLog, aiQueryLog, sessions, qaEntries });
export default spacetimedb;

type SessionRow = typeof sessions.rowType.type;

type SessionCtx = {
  sender: Identity,
  timestamp: Timestamp,
  senderAuth: SenderAuthLike,
  db: {
    sessions: {
      iter: () => Iterable<SessionRow>,
      identity: {
        find: (identity: Identity) => SessionRow | null,
        update: (row: SessionRow) => void,
        delete: (identity: Identity) => void,
      },
      insert: (row: SessionRow) => void,
    },
  },
};

function upsertSessionFromJwt(ctx: SessionCtx): void {
  removeExpiredSessions(ctx);
  const jwt = ctx.senderAuth.jwt;
  // Tokenless clients may connect — they can only see `published_qa`.
  if (jwt == null) return;
  // A JWT from a foreign issuer/audience gets no session (and no grants) but
  // may stay connected as an anonymous client. Notably, SpacetimeDB's own
  // server-issued tokens (handed to tokenless clients and replayed by the SDK
  // on reconnect) fall in this bucket — throwing here would break anonymous
  // `published_qa` subscribers on reconnect.
  if (!ALLOWED_ISSUERS.includes(jwt.issuer)) return;
  if (!jwt.audience.includes(EXPECTED_AUDIENCE)) return;
  const exp = jwt.fullPayload['exp'];
  const expiresAt = typeof exp === 'number'
    ? new Timestamp(BigInt(Math.floor(exp)) * 1_000_000n)
    : new Timestamp(ctx.timestamp.microsSinceUnixEpoch + FALLBACK_SESSION_TTL_MICROS);
  const row = {
    identity: ctx.sender,
    stackUserId: jwt.subject,
    connectedAt: ctx.timestamp,
    expiresAt,
  };
  if (ctx.db.sessions.identity.find(ctx.sender) != null) {
    ctx.db.sessions.identity.update(row);
  } else {
    ctx.db.sessions.insert(row);
  }
}

export const onConnect = spacetimedb.clientConnected((ctx) => {
  upsertSessionFromJwt(ctx);
});

// HTTP API callers never run `clientConnected` (it fires for WebSocket
// connections), so they call this no-arg reducer to establish their session
// row before querying the `my_visible_*` views over /sql. Self-enrollment
// only: everything is derived from the caller's own validated JWT.
export const touch_session = spacetimedb.reducer({}, (ctx, _args) => {
  upsertSessionFromJwt(ctx);
});

export const myVisibleMcpCallLog = spacetimedb.view(
  { name: 'my_visible_mcp_call_log', public: true },
  t.array(mcpCallLog.rowType),
  (ctx) => {
    if (!hasMemberSession(ctx)) return [];
    return newestById(ctx.db.mcpCallLog.shard.filter(0));
  }
);
export const myVisibleAiQueryLog = spacetimedb.view(
  { name: 'my_visible_ai_query_log', public: true },
  t.array(aiQueryLog.rowType),
  (ctx) => {
    if (!hasMemberSession(ctx)) return [];
    return newestById(ctx.db.aiQueryLog.shard.filter(0));
  }
);
export const myVisibleQaEntries = spacetimedb.view(
  { name: 'my_visible_qa_entries', public: true },
  t.array(qaEntries.rowType),
  (ctx) => {
    if (!hasMemberSession(ctx)) return [];
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

export const log_mcp_call = spacetimedb.reducer(
  {
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
    requireProjectMember(ctx.senderAuth);
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
    requireProjectMember(ctx.senderAuth);
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
    correlationId: t.string(),
  },
  (ctx, args) => {
    requireProjectMember(ctx.senderAuth);
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
    correlationId: t.string(),
    reviewed: t.bool(),
  },
  (ctx, args) => {
    requireProjectMember(ctx.senderAuth);
    const row = ctx.db.mcpCallLog.correlationId.find(args.correlationId);
    if (row == null) {
      throw new SenderError('Call log not found for correlationId: ' + args.correlationId);
    }
    ctx.db.mcpCallLog.id.update({
      ...row,
      humanReviewedAt: args.reviewed ? ctx.timestamp : undefined,
      humanReviewedBy: args.reviewed ? actorName(ctx.senderAuth) : undefined,
    });
  }
);

export const upsert_qa_from_call = spacetimedb.reducer(
  {
    correlationId: t.string(),
    question: t.string(),
    answer: t.string(),
    publish: t.bool(),
  },
  (ctx, args) => {
    requireProjectMember(ctx.senderAuth);
    upsertQaEntryFromCall(ctx, {
      correlationId: args.correlationId,
      question: args.question,
      answer: args.answer,
      publish: args.publish,
      editedBy: actorName(ctx.senderAuth),
    });
  }
);

export const upsert_qa_from_call_and_mark_reviewed = spacetimedb.reducer(
  {
    correlationId: t.string(),
    question: t.string(),
    answer: t.string(),
    publish: t.bool(),
  },
  (ctx, args) => {
    requireProjectMember(ctx.senderAuth);
    const reviewer = actorName(ctx.senderAuth);
    const callLogRow = upsertQaEntryFromCall(ctx, {
      correlationId: args.correlationId,
      question: args.question,
      answer: args.answer,
      publish: args.publish,
      editedBy: reviewer,
    });

    ctx.db.mcpCallLog.id.update({
      ...callLogRow,
      humanReviewedAt: ctx.timestamp,
      humanReviewedBy: reviewer,
    });
  }
);

type McpCallLogRow = typeof mcpCallLog.rowType.type;
type QaEntriesRow = typeof qaEntries.rowType.type;

function upsertQaEntryFromCall(ctx: {
  timestamp: Timestamp,
  db: {
    mcpCallLog: {
      correlationId: { find: (correlationId: string) => McpCallLogRow | null },
    },
    qaEntries: {
      shard: { filter: (shard: number) => Iterable<QaEntriesRow> },
      id: {
        update: (row: QaEntriesRow) => void,
      },
      insert: (row: QaEntriesRow) => void,
    },
  },
}, args: {
  correlationId: string,
  question: string,
  answer: string,
  publish: boolean,
  editedBy: string,
}): McpCallLogRow {
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
      lastEditedBy: args.editedBy,
      lastEditedAt: ctx.timestamp,
      published: args.publish,
      firstPublishedAt: args.publish ? (existing.firstPublishedAt ?? ctx.timestamp) : existing.firstPublishedAt,
      lastPublishedAt: args.publish ? ctx.timestamp : existing.lastPublishedAt,
    });
    return callLogRow;
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
  });
  return callLogRow;
}

export const add_manual_qa = spacetimedb.reducer(
  {
    question: t.string(),
    answer: t.string(),
    publish: t.bool(),
    requestId: t.string(),
  },
  (ctx, args) => {
    requireProjectMember(ctx.senderAuth);
    if (args.requestId !== '') {
      for (const existing of ctx.db.qaEntries.iter()) {
        if (existing.requestId === args.requestId) return;
      }
    }
    const createdBy = actorName(ctx.senderAuth);
    ctx.db.qaEntries.insert({
      id: 0n,
      shard: 0,
      sourceMcpCorrelationId: undefined,
      requestId: args.requestId,
      question: args.question,
      answer: args.answer,
      createdBy,
      createdAt: ctx.timestamp,
      lastEditedBy: createdBy,
      lastEditedAt: ctx.timestamp,
      published: args.publish,
      firstPublishedAt: args.publish ? ctx.timestamp : undefined,
      lastPublishedAt: args.publish ? ctx.timestamp : undefined,
    } as Parameters<typeof ctx.db.qaEntries.insert>[0]);
  }
);

export const delete_qa_entry = spacetimedb.reducer(
  {
    qaId: t.u64(),
  },
  (ctx, args) => {
    requireProjectMember(ctx.senderAuth);
    const row = ctx.db.qaEntries.id.find(args.qaId);
    if (row == null) {
      throw new SenderError('QA entry not found for qaId: ' + args.qaId.toString());
    }
    ctx.db.qaEntries.id.delete(row.id);
  }
);

export const update_qa_entry_with_publish = spacetimedb.reducer(
  {
    qaId: t.u64(),
    question: t.string(),
    answer: t.string(),
    publish: t.bool(),
  },
  (ctx, args) => {
    requireProjectMember(ctx.senderAuth);
    const row = ctx.db.qaEntries.id.find(args.qaId);
    if (row == null) {
      throw new SenderError('QA entry not found for qaId: ' + args.qaId.toString());
    }
    ctx.db.qaEntries.id.update({
      ...row,
      question: args.question,
      answer: args.answer,
      lastEditedBy: actorName(ctx.senderAuth),
      lastEditedAt: ctx.timestamp,
      published: args.publish,
      firstPublishedAt: args.publish ? (row.firstPublishedAt ?? ctx.timestamp) : row.firstPublishedAt,
      lastPublishedAt: args.publish ? ctx.timestamp : row.lastPublishedAt,
    });
  }
);

export const log_ai_query = spacetimedb.reducer(
  {
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
    requireProjectMember(ctx.senderAuth);
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

export const update_ai_query_usage = spacetimedb.reducer(
  {
    correlationId: t.string(),
    inputTokens: t.u32().optional(),
    outputTokens: t.u32().optional(),
    cachedInputTokens: t.u32().optional(),
    costUsd: t.f64().optional(),
    cacheDiscountUsd: t.f64().optional(),
  },
  (ctx, args) => {
    requireProjectMember(ctx.senderAuth);
    const row = ctx.db.aiQueryLog.correlationId.find(args.correlationId);
    if (row == null) {
      throw new SenderError('AI query log not found for correlationId: ' + args.correlationId);
    }
    ctx.db.aiQueryLog.id.update({
      ...row,
      inputTokens: args.inputTokens ?? row.inputTokens,
      outputTokens: args.outputTokens ?? row.outputTokens,
      cachedInputTokens: args.cachedInputTokens ?? row.cachedInputTokens,
      costUsd: args.costUsd ?? row.costUsd,
      cacheDiscountUsd: args.cacheDiscountUsd ?? row.cacheDiscountUsd,
    });
  }
);

export const delete_mcp_call_log = spacetimedb.reducer(
  {
    correlationId: t.string(),
  },
  (ctx, args) => {
    requireProjectMember(ctx.senderAuth);
    const row = ctx.db.mcpCallLog.correlationId.find(args.correlationId);
    if (row == null) {
      throw new SenderError('Call log not found for correlationId: ' + args.correlationId);
    }
    ctx.db.mcpCallLog.id.delete(row.id);
  }
);

export const delete_ai_query_log = spacetimedb.reducer(
  {
    correlationId: t.string(),
  },
  (ctx, args) => {
    requireProjectMember(ctx.senderAuth);
    const row = ctx.db.aiQueryLog.correlationId.find(args.correlationId);
    if (row == null) {
      throw new SenderError('Log entry not found for correlationId: ' + args.correlationId);
    }
    ctx.db.aiQueryLog.id.delete(row.id);
  }
);

export const init = spacetimedb.init(_ctx => {});
