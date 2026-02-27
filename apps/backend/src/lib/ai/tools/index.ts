import { SmartRequestAuth } from "@/route-handlers/smart-request";
import { ToolSet } from "ai";
import { createDashboardTool } from "./create-dashboard";
import { createEmailDraftTool } from "./create-email-draft";
import { createEmailTemplateTool } from "./create-email-template";
import { createEmailThemeTool } from "./create-email-theme";
import { createDocsTools } from "./docs";
import { createSqlQueryTool } from "./sql-query";

export type ToolName =
  | "docs"
  | "sql-query"
  | "create-email-theme"
  | "create-email-template"
  | "create-email-draft"
  | "create-dashboard";

export type ToolContext = {
  auth: SmartRequestAuth | null,
};

export async function getTools(
  toolNames: ToolName[],
  context: ToolContext
): Promise<ToolSet> {
  const tools: ToolSet = {};

  for (const toolName of toolNames) {
    switch (toolName) {
      case "docs": {
        const docsTools = await createDocsTools();
        Object.assign(tools, docsTools);
        break;
      }

      case "sql-query": {
        const sqlTool = createSqlQueryTool(context.auth);
        if (sqlTool != null) {
          tools["queryAnalytics"] = sqlTool;
        }
        break;
      }

      case "create-email-theme": {
        tools["createEmailTheme"] = createEmailThemeTool(context.auth);
        break;
      }

      case "create-email-template": {
        tools["createEmailTemplate"] = createEmailTemplateTool(context.auth);
        break;
      }

      case "create-email-draft": {
        tools["createEmailDraft"] = createEmailDraftTool(context.auth);
        break;
      }

      case "create-dashboard": {
        tools["createDashboard"] = createDashboardTool(context.auth);
        break;
      }

      default: {
        // TypeScript will ensure this is unreachable if we handle all cases
        const _exhaustive: never = toolName;
        console.warn(`Unknown tool name: ${_exhaustive}`);
      }
    }
  }

  return tools;
}

/**
 * Validates that all requested tool names are valid.
 * Throws an error if any tool name is invalid.
 */
export function validateToolNames(toolNames: unknown): toolNames is ToolName[] {
  if (!Array.isArray(toolNames)) {
    return false;
  }

  const validToolNames: ToolName[] = [
    "docs",
    "sql-query",
    "create-email-theme",
    "create-email-template",
    "create-email-draft",
    "create-dashboard",
  ];

  return toolNames.every((name) => validToolNames.includes(name as ToolName));
}
