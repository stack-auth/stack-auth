import { BUNDLED_DASHBOARD_UI_TYPES, BUNDLED_TYPE_DEFINITIONS } from "@/generated/bundled-type-definitions";

export type AiEndpointConfig = {
  backendBaseUrl: string,
  headers: Record<string, string>,
};

export async function selectRelevantFiles(
  prompt: string,
  aiConfig: AiEndpointConfig,
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

  const response = await fetch(
    `${aiConfig.backendBaseUrl}/api/latest/ai/query/generate`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...aiConfig.headers,
      },
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
    }
  );

  if (!response.ok) {
    return availableFiles;
  }

  const result = await response.json();

  // The generate endpoint returns { content: [{ type: "text", text: "..." }, ...] }
  // but the format may differ when forwarded to production. Extract text from
  // whichever shape we receive.
  let responseText: string | undefined;

  if (Array.isArray(result?.content)) {
    const textBlock = result.content.find((b: { type: string, text?: string }) => b.type === "text" && b.text);
    responseText = textBlock?.text;
  } else if (typeof result?.text === "string") {
    responseText = result.text;
  } else if (typeof result?.content === "string") {
    responseText = result.content;
  }

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

export { BUNDLED_DASHBOARD_UI_TYPES };
