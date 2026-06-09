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

// Replaces {key} placeholders for known context keys only, so JSON/code
// braces inside prompts survive untouched.
export function renderTemplate(template: string, context: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(context)) {
    result = result.split(`{${key}}`).join(value);
  }
  return result;
}
