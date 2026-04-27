import { SmartRequestAuth } from "@/route-handlers/smart-request";
import { ToolSet } from "ai";
import { updateDashboardTool } from "./create-dashboard";
import { createEmailDraftTool } from "./create-email-draft";
import { createEmailTemplateTool } from "./create-email-template";
import { createEmailThemeTool } from "./create-email-theme";
import { createDocsTools } from "./docs";
import { createSqlQueryTool } from "./sql-query";

export const TOOL_NAMES = [
  "docs",
  "sql-query",
  "create-email-theme",
  "create-email-template",
  "create-email-draft",
  "update-dashboard",
] as const;
export type ToolName = typeof TOOL_NAMES[number];

export type ToolContext = {
  auth: SmartRequestAuth | null,
  targetProjectId?: string | null,
};

export async function getTools(
  toolNames: readonly ToolName[],
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
        const sqlTool = createSqlQueryTool(context.auth, context.targetProjectId);
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

      case "update-dashboard": {
        tools["updateDashboard"] = updateDashboardTool(context.auth);
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
