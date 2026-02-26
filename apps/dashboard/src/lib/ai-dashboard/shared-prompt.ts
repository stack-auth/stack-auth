import { BUNDLED_DASHBOARD_UI_TYPES, BUNDLED_TYPE_DEFINITIONS } from "@/generated/bundled-type-definitions";
import { StackAdminApp } from "@stackframe/stack";
import { ChatContent } from "@stackframe/stack-shared/dist/interface/admin-interface";

export async function selectRelevantFiles(
  prompt: string,
  adminApp: StackAdminApp,
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
    const result = await adminApp.sendAiQuery({
      quality: "dumb",
      speed: "fast",
      systemPrompt: "command-center-ask-ai",
      tools: [],
      messages: [{
        role: "user",
        content: `${systemPromptText}\n\nDashboard request: "${prompt}"\n\nWhich type definition files do you need? When uncertain, err on the side of INCLUDING more files rather than fewer.`,
      }],
    });

    const content: ChatContent = Array.isArray(result.content) ? result.content : [];
    const textBlock = content.find((b): b is Extract<ChatContent[number], { type: "text" }> => b.type === "text");
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
  adminApp: StackAdminApp,
  messages: Array<{ role: string, content: unknown }>,
  currentSource?: string,
  editingWidgetId?: string,
): Promise<Array<{ role: string, content: string }>> {
  const promptForFileSelection = extractUserPromptText(messages);
  const selectedFiles = await selectRelevantFiles(promptForFileSelection, adminApp);
  const typeDefinitions = loadSelectedTypeDefinitions(selectedFiles);

  const widgetEditContext = editingWidgetId != null
    ? `\n\nIMPORTANT: The user wants to edit ONLY the widget with id='${editingWidgetId}'. Modify ONLY that widget's MainComponent and related code. Keep all other widgets, layout, and structure completely unchanged.`
    : "";

  const contextMessages: Array<{ role: string, content: string }> = [];

  if (currentSource != null && currentSource.length > 0) {
    contextMessages.push({
      role: "user",
      content: `Here is the current dashboard source code:\n\`\`\`tsx\n${currentSource}\n\`\`\`\n\nHere are the type definitions:\n${typeDefinitions}\n\nHere are the dashboard UI component types:\n${BUNDLED_DASHBOARD_UI_TYPES}${widgetEditContext}`,
    });
    contextMessages.push({
      role: "assistant",
      content: editingWidgetId != null
        ? `I understand the current dashboard code and I'll focus my changes on the widget with id='${editingWidgetId}'. What changes would you like to make to it?`
        : "I understand the current dashboard code, type definitions, and available UI components. What changes would you like to make?",
    });
  } else {
    contextMessages.push({
      role: "user",
      content: `Here are the type definitions for the Stack SDK:\n${typeDefinitions}\n\nHere are the dashboard UI component types:\n${BUNDLED_DASHBOARD_UI_TYPES}`,
    });
    contextMessages.push({
      role: "assistant",
      content: "I have the type definitions and available UI components. What dashboard would you like me to create?",
    });
  }

  return contextMessages;
}

export { BUNDLED_DASHBOARD_UI_TYPES };
