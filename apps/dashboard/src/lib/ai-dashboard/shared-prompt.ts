import { BUNDLED_DASHBOARD_UI_TYPES, BUNDLED_TYPE_DEFINITIONS } from "@/generated/bundled-type-definitions";
import { buildStackAuthHeaders, type CurrentUser } from "@/lib/api-headers";

export async function selectRelevantFiles(
  prompt: string,
  backendBaseUrl: string,
  currentUser?: CurrentUser,
): Promise<string[]> {
  const availableFiles = BUNDLED_TYPE_DEFINITIONS.map((f: { path: string }) => f.path);

  const systemPromptText = `You are a code assistant helping to generate dashboard code for Stack Auth.

Your task is to select which Stack SDK type definition files you'll need to generate the requested dashboard.

IMPORTANT GUIDELINES:
- DO NOT be conservative in file selection - when in doubt, INCLUDE the file
- If a file might be relevant to the dashboard, SELECT IT
- For user/team dashboards: select users and/or teams files
- For project info: select projects files
- Always select server-app.ts as it contains the main SDK interface
- It's better to include extra files than to miss necessary types

Available files:
${availableFiles.map(f => `- ${f}`).join('\n')}

Respond with ONLY a JSON object: { "selectedFiles": ["file1.ts", "file2.ts"] }
No markdown, no explanation — just the JSON.`;

  try {
    const authHeaders = await buildStackAuthHeaders(currentUser);
    const response = await fetch(`${backendBaseUrl}/api/latest/ai/query/generate`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders },
      body: JSON.stringify({
        quality: "dumb",
        speed: "fast",
        systemPrompt: "command-center-ask-ai",
        tools: [],
        messages: [{
          role: "user",
          content: `${systemPromptText}\n\nDashboard request: "${prompt}"\n\nWhich type definition files do you need? When uncertain, err on the side of INCLUDING more files rather than fewer.`,
        }],
      }),
    });

    const result = await response.json() as { content?: Array<{ type: string, text?: string }> };
    const content = Array.isArray(result.content) ? result.content : [];
    const textBlock = content.find((b) => b.type === "text");
    const responseText = textBlock?.text;

    if (!responseText) {
      return availableFiles;
    }

    const jsonMatch = responseText.match(/\{[\s\S]*"selectedFiles"[\s\S]*\}/);
    if (!jsonMatch) {
      return availableFiles;
    }

    const parsed = JSON.parse(jsonMatch[0]) as { selectedFiles?: string[] };
    if (!Array.isArray(parsed.selectedFiles) || parsed.selectedFiles.length === 0) {
      return availableFiles;
    }

    return parsed.selectedFiles.filter((f) => availableFiles.includes(f));
  } catch {
    return availableFiles;
  }
}

export function loadSelectedTypeDefinitions(selectedFiles: string[]): string {
  const fileContents = selectedFiles.map((relativePath: string) => {
    const file = BUNDLED_TYPE_DEFINITIONS.find((f: { path: string }) => f.path === relativePath);
    if (!file) {
      throw new Error(`Type definition file not found in bundle: ${relativePath}`);
    }
    return `
=== ${relativePath} ===
${file.content}
`;
  });

  return `
Complete Stack Auth SDK Type Definitions (Selected Files):
These files show the available methods, types, and interfaces for the Stack SDK.
${fileContents.join('\n')}
  `.trim();
}

function extractUserPromptText(messages: Array<{ role: string, content: unknown }>): string {
  const lastUserMessage = [...messages].reverse().find(m => m.role === "user");
  if (typeof lastUserMessage?.content === "string") {
    return lastUserMessage.content;
  }
  if (Array.isArray(lastUserMessage?.content)) {
    const textPart = (lastUserMessage.content as Array<{ type: string, text?: string }>).find(c => c.type === "text");
    return textPart?.text ?? "dashboard";
  }
  return "dashboard";
}

export async function buildDashboardMessages(
  backendBaseUrl: string,
  currentUser: CurrentUser | undefined,
  messages: Array<{ role: string, content: unknown }>,
  currentSource?: string,
  editingWidgetId?: string,
  addingWidgetPosition?: { x: number, y: number, width: number, height: number },
): Promise<Array<{ role: string, content: string }>> {
  const promptForFileSelection = extractUserPromptText(messages);
  const selectedFiles = await selectRelevantFiles(promptForFileSelection, backendBaseUrl, currentUser);
  const typeDefinitions = loadSelectedTypeDefinitions(selectedFiles);

  const widgetEditContext = editingWidgetId != null
    ? `\n\nIMPORTANT: The user wants to edit ONLY the widget with id='${editingWidgetId}'. Modify ONLY that widget's MainComponent and related code. Keep all other widgets, layout, and structure completely unchanged.`
    : "";

  const widgetAddContext = addingWidgetPosition != null
    ? `\n\nCRITICAL — ADDING ONE NEW WIDGET ONLY:\nThe user clicked the "+" button to add a single new widget at grid position x=${addingWidgetPosition.x}, y=${addingWidgetPosition.y}, width=${addingWidgetPosition.width}, height=${addingWidgetPosition.height}.\n\nYou MUST follow these rules EXACTLY:\n1. Copy every existing withAddedElement / withAddedElementInstance call VERBATIM — do NOT remove, reorder, resize, or modify any of them.\n2. Add exactly ONE new withAddedElement or withAddedElementInstance call for the new widget at the specified position.\n3. Change NOTHING else — not imports, not data fetching, not component names, not any other part of the grid.\nThe diff between the old and new code should consist of only the one new withAddedElement line you are inserting.`
    : "";

  const gridLayoutRule = addingWidgetPosition != null
    ? `` // suppress layout rules when adding a single widget — we must not rearrange existing widgets
    : `\n\nIMPORTANT LAYOUT RULES:\n1. SINGLE GRID: All dashboard content must be in ONE SwappableWidgetInstanceGrid — never create multiple grids.\n2. BUILD MANUALLY: Use WidgetInstanceGrid.fromWidgetInstances([]) as a starting point and add each widget at its exact position using withAddedElement or withAddedElementInstance.\n3. FILL ROWS: Every row must be filled to the full grid width (24 units) before starting a new row. If a row has 2 widgets, each gets width=12. If 3 widgets, each gets width=8. If 4 widgets, each gets width=6. Never leave a row partially empty.\n4. SECTION HEADINGS: To label a section, use DashboardUI.createSectionHeadingInstance('Title') placed with grid.withAddedElementInstance(headingInstance, 0, y, 24, 2) — headings always span the full width (x=0, width=24) and have height=2. The heading widget has a built-in edit dialog for changing the text.\n5. No plain HTML headings or section labels outside the grid.`;

  const contextMessages: Array<{ role: string, content: string }> = [];

  if (currentSource != null && currentSource.length > 0) {
    contextMessages.push({
      role: "user",
      content: `Here is the current dashboard source code:\n\`\`\`tsx\n${currentSource}\n\`\`\`\n\nHere are the type definitions:\n${typeDefinitions}\n\nHere are the dashboard UI component types:\n${BUNDLED_DASHBOARD_UI_TYPES}${widgetEditContext}${widgetAddContext}${gridLayoutRule}`,
    });
    contextMessages.push({
      role: "assistant",
      content: editingWidgetId != null
        ? `I understand the current dashboard code and I'll focus my changes on the widget with id='${editingWidgetId}'. What changes would you like to make to it?`
        : addingWidgetPosition != null
          ? `I understand the current dashboard code and I'll add a new widget at position (${addingWidgetPosition.x}, ${addingWidgetPosition.y}). What would you like the new widget to show?`
          : "I understand the current dashboard code, type definitions, and available UI components. What changes would you like to make?",
    });
  } else {
    contextMessages.push({
      role: "user",
      content: `Here are the type definitions for the Stack SDK:\n${typeDefinitions}\n\nHere are the dashboard UI component types:\n${BUNDLED_DASHBOARD_UI_TYPES}${gridLayoutRule}`,
    });
    contextMessages.push({
      role: "assistant",
      content: "I have the type definitions and available UI components. What dashboard would you like me to create?",
    });
  }

  return contextMessages;
}

export { BUNDLED_DASHBOARD_UI_TYPES };
