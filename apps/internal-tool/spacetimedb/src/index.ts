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

// --- Eval suite tables ---
// A workflow is an ordered queue of steps; each step is one Claude Code agent
// session executed inside the run's shared sandbox.
const evalWorkflow = table(
  { name: 'eval_workflow', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    workflowId: t.string(),
    name: t.string(),
    description: t.string(),
    // JSON array of { name, prompt, outputKey?, model?, artifacts?: string[] }
    stepsJson: t.string(),
    defaultModel: t.string(),
    createdAt: t.timestamp(),
    updatedAt: t.timestamp(),
  }
);

const evalRun = table(
  { name: 'eval_run', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    runId: t.string(),
    workflowId: t.string(),
    workflowName: t.string(),
    label: t.string(),
    model: t.string(),
    // queued | booting | running | completed | failed | cancelled
    status: t.string(),
    sandboxId: t.string().optional(),
    currentStepIndex: t.u32(),
    totalSteps: t.u32(),
    // JSON object of template variables produced by completed steps
    contextJson: t.string(),
    configJson: t.string(),
    error: t.string().optional(),
    createdAt: t.timestamp(),
    startedAt: t.timestamp().optional(),
    finishedAt: t.timestamp().optional(),
  }
);

const evalStepRun = table(
  { name: 'eval_step_run', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    stepRunId: t.string(),
    runId: t.string(),
    stepIndex: t.u32(),
    stepName: t.string(),
    model: t.string(),
    // pending | running | completed | failed | cancelled
    status: t.string(),
    resultText: t.string(),
    error: t.string().optional(),
    numMessages: t.u32(),
    costUsd: t.string().optional(),
    sessionId: t.string().optional(),
    createdAt: t.timestamp(),
    startedAt: t.timestamp().optional(),
    finishedAt: t.timestamp().optional(),
  }
);

const evalWorklog = table(
  { name: 'eval_worklog', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    runId: t.string(),
    stepRunId: t.string(),
    seq: t.u32(),
    // system | assistant | user | result | stdout | stderr | meta
    kind: t.string(),
    content: t.string(),
    createdAt: t.timestamp(),
  }
);

const evalArtifact = table(
  { name: 'eval_artifact', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    runId: t.string(),
    stepRunId: t.string(),
    path: t.string(),
    contentType: t.string(),
    content: t.string(),
    createdAt: t.timestamp(),
  }
);

const spacetimedb = schema({ mcpCallLog, evalWorkflow, evalRun, evalStepRun, evalWorklog, evalArtifact });
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

// --- Eval suite reducers ---

export const upsert_eval_workflow = spacetimedb.reducer(
  {
    token: t.string(),
    workflowId: t.string(),
    name: t.string(),
    description: t.string(),
    stepsJson: t.string(),
    defaultModel: t.string(),
  },
  (ctx, args) => {
    if (args.token !== EXPECTED_LOG_TOKEN) {
      throw new SenderError('Invalid log token');
    }
    for (const row of ctx.db.evalWorkflow.iter()) {
      if (row.workflowId === args.workflowId) {
        ctx.db.evalWorkflow.delete(row);
        ctx.db.evalWorkflow.insert({
          ...row,
          name: args.name,
          description: args.description,
          stepsJson: args.stepsJson,
          defaultModel: args.defaultModel,
          updatedAt: ctx.timestamp,
        });
        return;
      }
    }
    ctx.db.evalWorkflow.insert({
      id: 0n,
      workflowId: args.workflowId,
      name: args.name,
      description: args.description,
      stepsJson: args.stepsJson,
      defaultModel: args.defaultModel,
      createdAt: ctx.timestamp,
      updatedAt: ctx.timestamp,
    } as Parameters<typeof ctx.db.evalWorkflow.insert>[0]);
  }
);

export const delete_eval_workflow = spacetimedb.reducer(
  {
    token: t.string(),
    workflowId: t.string(),
  },
  (ctx, args) => {
    if (args.token !== EXPECTED_LOG_TOKEN) {
      throw new SenderError('Invalid log token');
    }
    for (const row of ctx.db.evalWorkflow.iter()) {
      if (row.workflowId === args.workflowId) {
        ctx.db.evalWorkflow.delete(row);
        return;
      }
    }
    throw new SenderError('Workflow not found: ' + args.workflowId);
  }
);

export const create_eval_run = spacetimedb.reducer(
  {
    token: t.string(),
    runId: t.string(),
    workflowId: t.string(),
    workflowName: t.string(),
    label: t.string(),
    model: t.string(),
    totalSteps: t.u32(),
    configJson: t.string(),
  },
  (ctx, args) => {
    if (args.token !== EXPECTED_LOG_TOKEN) {
      throw new SenderError('Invalid log token');
    }
    ctx.db.evalRun.insert({
      id: 0n,
      runId: args.runId,
      workflowId: args.workflowId,
      workflowName: args.workflowName,
      label: args.label,
      model: args.model,
      status: 'queued',
      currentStepIndex: 0,
      totalSteps: args.totalSteps,
      contextJson: '{}',
      configJson: args.configJson,
      createdAt: ctx.timestamp,
    } as Parameters<typeof ctx.db.evalRun.insert>[0]);
  }
);

export const update_eval_run = spacetimedb.reducer(
  {
    token: t.string(),
    runId: t.string(),
    status: t.string(),
    sandboxId: t.string().optional(),
    currentStepIndex: t.u32(),
    contextJson: t.string().optional(),
    error: t.string().optional(),
  },
  (ctx, args) => {
    if (args.token !== EXPECTED_LOG_TOKEN) {
      throw new SenderError('Invalid log token');
    }
    const isTerminal = args.status === 'completed' || args.status === 'failed' || args.status === 'cancelled';
    for (const row of ctx.db.evalRun.iter()) {
      if (row.runId === args.runId) {
        ctx.db.evalRun.delete(row);
        ctx.db.evalRun.insert({
          ...row,
          status: args.status,
          sandboxId: args.sandboxId ?? row.sandboxId,
          currentStepIndex: args.currentStepIndex,
          contextJson: args.contextJson ?? row.contextJson,
          error: args.error ?? row.error,
          startedAt: row.startedAt ?? (args.status === 'running' || args.status === 'booting' ? ctx.timestamp : undefined),
          finishedAt: row.finishedAt ?? (isTerminal ? ctx.timestamp : undefined),
        });
        return;
      }
    }
    throw new SenderError('Run not found: ' + args.runId);
  }
);

export const upsert_eval_step_run = spacetimedb.reducer(
  {
    token: t.string(),
    stepRunId: t.string(),
    runId: t.string(),
    stepIndex: t.u32(),
    stepName: t.string(),
    model: t.string(),
    status: t.string(),
    resultText: t.string(),
    error: t.string().optional(),
    numMessages: t.u32(),
    costUsd: t.string().optional(),
    sessionId: t.string().optional(),
  },
  (ctx, args) => {
    if (args.token !== EXPECTED_LOG_TOKEN) {
      throw new SenderError('Invalid log token');
    }
    const isTerminal = args.status === 'completed' || args.status === 'failed' || args.status === 'cancelled';
    for (const row of ctx.db.evalStepRun.iter()) {
      if (row.stepRunId === args.stepRunId) {
        ctx.db.evalStepRun.delete(row);
        ctx.db.evalStepRun.insert({
          ...row,
          status: args.status,
          resultText: args.resultText,
          error: args.error ?? row.error,
          numMessages: args.numMessages,
          costUsd: args.costUsd ?? row.costUsd,
          sessionId: args.sessionId ?? row.sessionId,
          startedAt: row.startedAt ?? (args.status === 'running' ? ctx.timestamp : undefined),
          finishedAt: row.finishedAt ?? (isTerminal ? ctx.timestamp : undefined),
        });
        return;
      }
    }
    ctx.db.evalStepRun.insert({
      id: 0n,
      stepRunId: args.stepRunId,
      runId: args.runId,
      stepIndex: args.stepIndex,
      stepName: args.stepName,
      model: args.model,
      status: args.status,
      resultText: args.resultText,
      error: args.error,
      numMessages: args.numMessages,
      costUsd: args.costUsd,
      sessionId: args.sessionId,
      createdAt: ctx.timestamp,
      startedAt: args.status === 'running' ? ctx.timestamp : undefined,
      finishedAt: isTerminal ? ctx.timestamp : undefined,
    } as Parameters<typeof ctx.db.evalStepRun.insert>[0]);
  }
);

export const append_eval_worklog = spacetimedb.reducer(
  {
    token: t.string(),
    runId: t.string(),
    stepRunId: t.string(),
    // JSON array of { seq: number, kind: string, content: string }
    entriesJson: t.string(),
  },
  (ctx, args) => {
    if (args.token !== EXPECTED_LOG_TOKEN) {
      throw new SenderError('Invalid log token');
    }
    const entries = JSON.parse(args.entriesJson) as { seq: number, kind: string, content: string }[];
    for (const entry of entries) {
      ctx.db.evalWorklog.insert({
        id: 0n,
        runId: args.runId,
        stepRunId: args.stepRunId,
        seq: entry.seq,
        kind: entry.kind,
        content: entry.content,
        createdAt: ctx.timestamp,
      } as Parameters<typeof ctx.db.evalWorklog.insert>[0]);
    }
  }
);

export const add_eval_artifact = spacetimedb.reducer(
  {
    token: t.string(),
    runId: t.string(),
    stepRunId: t.string(),
    path: t.string(),
    contentType: t.string(),
    content: t.string(),
  },
  (ctx, args) => {
    if (args.token !== EXPECTED_LOG_TOKEN) {
      throw new SenderError('Invalid log token');
    }
    ctx.db.evalArtifact.insert({
      id: 0n,
      runId: args.runId,
      stepRunId: args.stepRunId,
      path: args.path,
      contentType: args.contentType,
      content: args.content,
      createdAt: ctx.timestamp,
    } as Parameters<typeof ctx.db.evalArtifact.insert>[0]);
  }
);

export const delete_eval_run = spacetimedb.reducer(
  {
    token: t.string(),
    runId: t.string(),
  },
  (ctx, args) => {
    if (args.token !== EXPECTED_LOG_TOKEN) {
      throw new SenderError('Invalid log token');
    }
    for (const row of [...ctx.db.evalWorklog.iter()]) {
      if (row.runId === args.runId) ctx.db.evalWorklog.delete(row);
    }
    for (const row of [...ctx.db.evalArtifact.iter()]) {
      if (row.runId === args.runId) ctx.db.evalArtifact.delete(row);
    }
    for (const row of [...ctx.db.evalStepRun.iter()]) {
      if (row.runId === args.runId) ctx.db.evalStepRun.delete(row);
    }
    for (const row of [...ctx.db.evalRun.iter()]) {
      if (row.runId === args.runId) ctx.db.evalRun.delete(row);
    }
  }
);

export const init = spacetimedb.init(_ctx => {});
