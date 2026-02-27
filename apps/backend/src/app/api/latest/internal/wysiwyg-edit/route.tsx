import { forwardToProduction } from "@/lib/ai/forward";
import { selectModel } from "@/lib/ai/models";
import { getFullSystemPrompt } from "@/lib/ai/prompts";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, yupArray, yupMixed, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { generateText } from "ai";

const AI_REQUEST_TIMEOUT_MS = 120_000;

function stripCodeFences(code: string): string {
  if (!code.startsWith("```")) {
    return code;
  }
  const lines = code.split("\n");
  lines.shift();
  if (lines[lines.length - 1]?.trim() === "```") {
    lines.pop();
  }
  return lines.join("\n");
}

const editMetadataSchema = yupObject({
  id: yupString().defined(),
  loc: yupObject({
    start: yupNumber().defined(),
    end: yupNumber().defined(),
    line: yupNumber().defined(),
    column: yupNumber().defined(),
  }).defined(),
  originalText: yupString().defined(),
  textHash: yupString().defined(),
  jsxPath: yupArray(yupString().defined()).defined(),
  parentElement: yupObject({
    tagName: yupString().defined(),
    props: yupMixed().defined(),
  }).defined(),
  sourceContext: yupObject({
    before: yupString().defined(),
    after: yupString().defined(),
  }).defined(),
  siblingIndex: yupNumber().defined(),
  occurrenceCount: yupNumber().defined(),
  occurrenceIndex: yupNumber().defined(),
  sourceFile: yupString().oneOf(["template", "theme"]).defined(),
});

const domPathItemSchema = yupObject({
  tag_name: yupString().defined(),
  index: yupNumber().defined(),
});

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Apply WYSIWYG text edit",
    description: "Uses AI to update source code based on a WYSIWYG text edit",
    tags: ["Internal", "AI"],
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: yupString().oneOf(["admin"]).defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
    body: yupObject({
      /** The type of source being edited */
      source_type: yupString().oneOf(["template", "theme", "draft"]).defined(),
      /** The current source code to edit */
      source_code: yupString().defined(),
      /** The original text that was in the editable region */
      old_text: yupString().defined(),
      /** The new text the user wants */
      new_text: yupString().defined(),
      /** Metadata from the editable region for locating the text */
      metadata: editMetadataSchema.defined(),
      /** DOM path from the iframe for additional context */
      dom_path: yupArray(domPathItemSchema.defined()).defined(),
      /** HTML context from the rendered output */
      html_context: yupString().defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      updated_source: yupString().defined(),
    }).defined(),
  }),
  async handler({ body }, fullReq) {
    const {
      source_code,
      old_text,
      new_text,
      metadata,
      dom_path,
      html_context,
    } = body;

    // If no change, return original
    if (old_text === new_text) {
      return {
        statusCode: 200,
        bodyType: "json",
        body: { updated_source: source_code },
      };
    }

    const apiKey = getEnvVariable("STACK_OPENROUTER_API_KEY", "");

    if (apiKey === "") {
      throw new StatusError(
        StatusError.InternalServerError,
        "OpenRouter API key is not configured. Please set STACK_OPENROUTER_API_KEY environment variable."
      );
    }

    const userPrompt = `
## Source Code to Edit
\`\`\`tsx
${source_code}
\`\`\`

## Edit Request
- **Old text:** "${old_text}"
- **New text:** "${new_text}"

## Location Information
- **Line:** ${metadata.loc.line}
- **Column:** ${metadata.loc.column}
- **JSX Path:** ${metadata.jsxPath.join(" > ")}
- **Parent Element:** <${metadata.parentElement.tagName}>
- **Sibling Index:** ${metadata.siblingIndex}
- **Occurrence:** ${metadata.occurrenceIndex} of ${metadata.occurrenceCount}

## Source Context (lines around the text)
Before:
\`\`\`
${metadata.sourceContext.before}
\`\`\`

After:
\`\`\`
${metadata.sourceContext.after}
\`\`\`

## Runtime DOM Path (for disambiguation)
${dom_path.map((p, i) => `${i + 1}. <${p.tag_name}> (index: ${p.index})`).join("\n")}

## Rendered HTML Context
\`\`\`html
${html_context.slice(0, 500)}
\`\`\`

Please update the source code to change "${old_text}" to "${new_text}" at the specified location. Return ONLY the complete updated source code.
`;

    if (apiKey === "FORWARD_TO_PRODUCTION") {
      const prodResponse = await forwardToProduction(fullReq.headers, "generate", {
        quality: "smart",
        speed: "fast",
        systemPrompt: "wysiwyg-edit",
        tools: [],
        messages: [{ role: "user", content: userPrompt }],
      });

      if (!prodResponse.ok) {
        throw new StatusError(prodResponse.status, `Production AI request failed: ${prodResponse.status}`);
      }

      const prodResult = await prodResponse.json() as { content?: Array<{ type: string, text?: string }> };
      const textBlock = Array.isArray(prodResult.content)
        ? prodResult.content.find((b) => b.type === "text" && b.text)
        : undefined;
      const updatedSource = stripCodeFences(textBlock?.text?.trim() ?? source_code);

      return {
        statusCode: 200,
        bodyType: "json",
        body: { updated_source: updatedSource },
      };
    }

    const model = selectModel("smart", "fast", true);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS);

    const result = await generateText({
      model,
      system: getFullSystemPrompt("wysiwyg-edit"),
      messages: [{ role: "user", content: userPrompt }],
      abortSignal: controller.signal,
    }).finally(() => clearTimeout(timeoutId));

    const updatedSource = stripCodeFences(result.text.trim());

    return {
      statusCode: 200,
      bodyType: "json",
      body: { updated_source: updatedSource },
    };
  },
});
