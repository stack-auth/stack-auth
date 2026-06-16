// Shared eval-suite types used by both the server orchestrator and the UI.

export type EvalStepDefinition = {
  name: string,
  // Agent prompt. May reference context variables produced by earlier steps
  // with {varName} (e.g. {idea}). Unknown placeholders are left untouched.
  prompt: string,
  // Context variable name this step's final result text is stored under.
  // Defaults to step<N> (1-based), so {step1} refers to step 1's output.
  outputKey?: string,
  // Per-step OpenRouter model override; falls back to the run's model.
  model?: string,
  // Absolute (or sandbox-cwd-relative) file paths collected from the sandbox
  // after the step completes and stored as run artifacts (e.g. report.html).
  artifacts?: string[],
};

export type EvalRunConfig = {
  timeoutMinutes: number,
  // Extra template variables available to every step prompt.
  variables?: Record<string, string>,
  // Per-step model overrides chosen at launch time (index-keyed).
  stepModels?: Record<number, string>,
};

export type RunStatus = "queued" | "booting" | "running" | "completed" | "failed" | "cancelled";
export type StepStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export const ACTIVE_RUN_STATUSES: RunStatus[] = ["queued", "booting", "running"];

export type WorklogEntryKind = "system" | "assistant" | "user" | "result" | "stdout" | "stderr" | "meta";

export function parseSteps(stepsJson: string): EvalStepDefinition[] {
  const parsed = JSON.parse(stepsJson) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("stepsJson must be a JSON array of step definitions");
  }
  return parsed.map((step, index) => {
    const s = step as Partial<EvalStepDefinition>;
    if (typeof s.name !== "string" || typeof s.prompt !== "string") {
      throw new Error(`Step ${index + 1} must have string "name" and "prompt" fields`);
    }
    return {
      name: s.name,
      prompt: s.prompt,
      outputKey: typeof s.outputKey === "string" && s.outputKey.length > 0 ? s.outputKey : undefined,
      model: typeof s.model === "string" && s.model.length > 0 ? s.model : undefined,
      artifacts: Array.isArray(s.artifacts) ? s.artifacts.filter((a): a is string => typeof a === "string") : undefined,
    };
  });
}

// Builds a detailed, human-readable description of an error INCLUDING its
// `cause` chain. Network SDKs often throw a generic `TypeError: fetch failed`
// whose real reason — socket reset, timeout, connection closed, DNS failure,
// HTTP status — lives in `error.cause`
// (sometimes nested several levels deep). Surfacing only `error.message` throws
// all of that away and leaves the UI showing a useless "fetch failed", so we
// walk the chain and include each level's message plus its name/code.
export function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const levels: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    const message = current.message || current.name || "Unknown error";
    const annotations: string[] = [];
    if (current.name && current.name !== "Error" && !message.includes(current.name)) {
      annotations.push(current.name);
    }
    const code = (current as { code?: unknown }).code;
    if ((typeof code === "string" || typeof code === "number") && !message.includes(String(code))) {
      annotations.push(`code ${code}`);
    }
    levels.push(annotations.length > 0 ? `${message} (${annotations.join(", ")})` : message);
    current = (current as { cause?: unknown }).cause;
  }
  // Undici often wraps an error in an identical-message parent; collapse those.
  const deduped = levels.filter((level, i) => i === 0 || level !== levels[i - 1]);
  return deduped.join(" ← caused by: ");
}

// Replaces {key} placeholders for known context keys only, so JSON/code
// braces inside prompts survive untouched.
export function renderTemplate(template: string, context: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(context)) {
    result = result.split(`{${key}}`).join(value);
  }
  return result;
}
