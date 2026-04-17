import { renderEmailWithTemplate } from "@/lib/email-rendering";
import { emptyEmailTheme } from "@stackframe/stack-shared/dist/helpers/emails";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { StackAssertionError, captureError } from "@stackframe/stack-shared/dist/utils/errors";
import { Result } from "@stackframe/stack-shared/dist/utils/results";

const MOCK_API_KEY_SENTINEL = "mock-openrouter-api-key";
const AI_REQUEST_TIMEOUT_MS = 120_000;
const MAX_REWRITE_ATTEMPTS = 3;

function isMockMode() {
  const key = getEnvVariable("STACK_OPENROUTER_API_KEY", MOCK_API_KEY_SENTINEL);
  return key === MOCK_API_KEY_SENTINEL || key === "FORWARD_TO_PRODUCTION";
}

async function rewriteTemplateSourceWithCurrentAIPlumbing(templateTsxSource: string): Promise<Result<string, string>> {
  const backendUrl = getEnvVariable("NEXT_PUBLIC_STACK_API_URL");
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${backendUrl}/api/latest/ai/query/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        quality: "smart",
        speed: "slow",
        tools: [],
        systemPrompt: "rewrite-template-source",
        messages: [{ role: "user", content: templateTsxSource }],
        projectId: null,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      return Result.error(`AI endpoint returned ${response.status}: ${await response.text()}`);
    }
    const json = await response.json() as { content: Array<{ type: string, text?: string }> };
    const text = json.content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
    return Result.ok(stripCodeFences(text));
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
  if (isMockMode()) {
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
      isMockMode: isMockMode(),
      maxRewriteAttempts: MAX_REWRITE_ATTEMPTS,
      lastError,
    },
  ));
  return Result.error(lastError);
}
