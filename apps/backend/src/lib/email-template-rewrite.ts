import { renderEmailWithTemplate } from "@/lib/email-rendering";
import { createOpenAI } from "@ai-sdk/openai";
import { emptyEmailTheme } from "@stackframe/stack-shared/dist/helpers/emails";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { StackAssertionError, captureError } from "@stackframe/stack-shared/dist/utils/errors";
import { Result } from "@stackframe/stack-shared/dist/utils/results";
import { deindent } from "@stackframe/stack-shared/dist/utils/strings";
import { generateText } from "ai";

const MOCK_API_KEY_SENTINEL = "mock-openrouter-api-key";
const AI_REQUEST_TIMEOUT_MS = 120_000;
const MAX_REWRITE_ATTEMPTS = 3;

const apiKey = getEnvVariable("STACK_OPENROUTER_API_KEY", MOCK_API_KEY_SENTINEL);
const isMockMode = apiKey === MOCK_API_KEY_SENTINEL;
const openai = isMockMode ? null : createOpenAI({
  apiKey,
  baseURL: "https://openrouter.ai/api/v1",
});

const TEMPLATE_REWRITE_SYSTEM_PROMPT = deindent`
  You rewrite email template TSX source into standalone draft TSX.

  Requirements:
  1) Keep exactly one exported EmailTemplate component.
  2) Remove variables schema declarations and preview variable assignments.
     - Remove exports like variablesSchema regardless of symbol name. For example, you may see export const profileSchema = ... which should be removed too.
     - Remove EmailTemplate.PreviewVariables assignment.
  3) Make EmailTemplate standalone:
     - It must not rely on a variables prop from outside.
     - Define "const variables = { ... }" inside EmailTemplate with sensible placeholder values based on the schema/types present in source.
     - It should be the only exported function in the file.
  4) Preserve subject/notification/category and existing JSX structure as much as possible.
  5) Fix imports after removal.
  6) Return only raw TSX source, without markdown code fences.
`;

async function rewriteTemplateSourceWithCurrentAIPlumbing(templateTsxSource: string): Promise<Result<string, string>> {
  if (!openai) {
    return Result.error("OpenAI client not initialized - STACK_OPENROUTER_API_KEY may be missing");
  }

  // Keep consistent with other AI routes.
  const modelName = getEnvVariable("STACK_AI_MODEL");
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS);
  try {
    const response = await generateText({
      model: openai(modelName),
      system: TEMPLATE_REWRITE_SYSTEM_PROMPT,
      messages: [{ role: "user", content: templateTsxSource }],
      abortSignal: controller.signal,
    });
    return Result.ok(stripCodeFences(response.text));
  } catch (error) {
    return Result.error(error instanceof Error ? error.message : String(error));
  } finally {
    clearTimeout(timeoutId);
  }
}

function rewriteTemplateSourceInMockMode(templateTsxSource: string): string {
  if (!templateTsxSource.includes("EmailTemplate.PreviewVariables") && !templateTsxSource.includes("type(")) {
    return templateTsxSource;
  }

  let source = stripPreviewVariablesAssignment(templateTsxSource);
  source = source.replace(/^\s*export\s+const\s+\w+\s*=\s*type\([\s\S]*?\)\s*;?\s*$/gm, "");

  source = source.replace(
    /export\s+function\s+EmailTemplate\s*\(\s*\{([^}]*)\}\s*(?::\s*[^)]*)?\)/,
    (_match, rawParams: string) => {
      const params = rawParams
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .filter((entry) => entry !== "variables" && !entry.startsWith("variables:"));
      return `export function EmailTemplate({ ${params.join(", ")} })`;
    },
  );

  if (!source.includes("const variables =")) {
    source = source.replace(
      /export\s+function\s+EmailTemplate\s*\([^)]*\)\s*\{/,
      (match) => `${match}\n  const variables = {};`,
    );
  }

  source = source.replace(/,\s*\}/g, "}");
  source = source.replace(/\{\s*,/g, "{");
  return source;
}

function stripPreviewVariablesAssignment(source: string): string {
  const lines = source.split("\n");
  const outputLines: string[] = [];
  let skippingAssignment = false;

  for (const line of lines) {
    if (!skippingAssignment && /^\s*EmailTemplate\.PreviewVariables\s*=/.test(line)) {
      skippingAssignment = true;
      if (line.includes(";")) {
        skippingAssignment = false;
      }
      continue;
    }

    if (skippingAssignment) {
      if (line.includes(";") || line.includes("satisfies")) {
        skippingAssignment = false;
      }
      continue;
    }

    outputLines.push(line);
  }

  return outputLines.join("\n");
}

function stripCodeFences(text: string): string {
  let output = text.trim();
  if (!output.startsWith("```")) return output;
  const lines = output.split("\n");
  lines.shift();
  if (lines[lines.length - 1]?.trim() === "```") {
    lines.pop();
  }
  output = lines.join("\n").trim();
  return output;
}

export async function rewriteTemplateSourceWithAI(templateTsxSource: string): Promise<Result<string, string>> {
  if (isMockMode) {
    const mockRewrittenSource = rewriteTemplateSourceInMockMode(templateTsxSource);
    const mockRenderResult = await renderEmailWithTemplate(mockRewrittenSource, emptyEmailTheme, {
      previewMode: true,
    });
    if (mockRenderResult.status === "ok") {
      return Result.ok(mockRewrittenSource);
    }

    return Result.error(mockRenderResult.error);
  }

  let lastError = "Unknown rewrite failure";
  for (let attempt = 0; attempt < MAX_REWRITE_ATTEMPTS; attempt++) {
    // TODO: Switch this adapter to unified AI endpoint once PR #1240 is merged.
    const rewriteResult = await rewriteTemplateSourceWithCurrentAIPlumbing(templateTsxSource);
    if (rewriteResult.status === "error") {
      lastError = rewriteResult.error;
      continue;
    }

    const renderResult = await renderEmailWithTemplate(rewriteResult.data, emptyEmailTheme, {
      previewMode: true,
    });
    if (renderResult.status === "ok") {
      return Result.ok(rewriteResult.data);
    }

    lastError = renderResult.error;
  }

  captureError("email-template-rewrite-failed-after-retries", new StackAssertionError(
    "Template rewrite failed after all retries",
    {
      isMockMode,
      maxRewriteAttempts: MAX_REWRITE_ATTEMPTS,
      lastError,
    },
  ));
  return Result.error(lastError);
}
