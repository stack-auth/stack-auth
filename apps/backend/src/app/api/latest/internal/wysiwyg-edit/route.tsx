import { selectModel } from "@/lib/ai/models";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, yupArray, yupMixed, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { generateText } from "ai";

const WYSIWYG_SYSTEM_PROMPT = `You are an expert at editing React/JSX code. Your task is to update a specific text string in the source code.

RULES:
1. You will be given the original source code and details about a text edit the user wants to make.
2. Find the text at the specified location and replace it with the new text.
3. If there are multiple occurrences of the same text, use the provided location info (line, column, occurrence index) to identify the correct one.
4. The text you're given is given as plaintext, so you should escape it properly. Be smart about what the user's intent may have been; if it contains eg. an added newline character, that's because the user added a newline character, so depending on the context sometimes you should replace it with <br />, sometimes you should create a new <p>, and sometimes you should do something else. Change it in a good-faith interpretation of what the user may have wanted to do, not in perfect spec-compliance. 
5. If the text is part of a template literal or JSX expression, only change the static text portion.
6. Return ONLY the complete updated source code, nothing else.
7. Do NOT add any explanation, markdown formatting, or code fences - just the raw source code.
8. Context: The user is editing the text in a WYSIWYG editor. They expect that the change they made will be reflected as-is, without massively the rest of the source code. However, in most cases, the user don't actually care about the rest of the source code, so in the rare cases where things are complex and you would have to change a bit more than just the text node, you should make the changes that sound reasonable from a UX perspective.
9. If the user added whitespace padding at the very end or the very beginning of the text node, that was probably an accident and you can ignore it.

IMPORTANT:
- The location info includes: line number, column, source context (lines before/after), JSX path, parent element.
- Use all available information to find the exact text to replace.
`;

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

    // Mock mode: no API key configured — perform a simple string replacement without calling AI
    if (apiKey === "") { //TODO have a special env variable for this
      let replacedSource: string;

      // Handle edge case: empty old_text can't be meaningfully replaced
      if (old_text === "") {
        // Just return original source with the note
        replacedSource = source_code;
      } else {
        // Use occurrence index from metadata to replace the correct occurrence
        const occurrenceIndex = metadata.occurrenceIndex;
        const parts = source_code.split(old_text);

        // Validate that the occurrence index is valid (1-based index from metadata)
        // parts.length - 1 equals the number of occurrences of old_text in source_code
        if (occurrenceIndex < 1 || occurrenceIndex > parts.length - 1) {
          // Fallback to first occurrence if index is invalid
          replacedSource = source_code.replace(old_text, new_text);
        } else {
          // Replace only the occurrence at the specified index (convert 1-based to 0-based)
          const zeroBasedIndex = occurrenceIndex - 1;
          replacedSource = parts.slice(0, zeroBasedIndex + 1).join(old_text) +
            new_text +
            parts.slice(zeroBasedIndex + 1).join(old_text);
        }
      }

      const updatedSource = `// NOTE: You haven't specified a STACK_OPENROUTER_API_KEY, so we're using a mock mode where we just replace the old text with the new text instead of calling AI.\n\n${replacedSource}`;
      return {
        statusCode: 200,
        bodyType: "json",
        body: { updated_source: updatedSource },
      };
    }

    // Build the prompt for the AI
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

    // This route requires admin auth, so the caller is always authenticated.
    // "smart" + "fast" is appropriate for surgical text-node replacement.
    const model = selectModel("smart", "fast", /* isAuthenticated= */ true);

    const result = await generateText({
      model,
      system: WYSIWYG_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });

    // Extract the updated source code from the response
    let updatedSource = result.text.trim();

    // Remove any markdown code fences if the AI added them despite instructions
    if (updatedSource.startsWith("```")) {
      const lines = updatedSource.split("\n");
      // Remove first line (```tsx or similar)
      lines.shift();
      // Remove last line if it's ```
      if (lines[lines.length - 1]?.trim() === "```") {
        lines.pop();
      }
      updatedSource = lines.join("\n");
    }

    return {
      statusCode: 200,
      bodyType: "json",
      body: { updated_source: updatedSource },
    };
  },
});
