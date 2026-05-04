import { SmartRequestAuth } from "@/route-handlers/smart-request";
import { StackAssertionError, captureError } from "@stackframe/stack-shared/dist/utils/errors";
import { ToolSet } from "ai";
import { patchDashboardTool, updateDashboardTool } from "./create-dashboard";
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
  | "update-dashboard"
  | "patch-dashboard";

export type ToolContext = {
  auth: SmartRequestAuth | null,
  targetProjectId?: string | null,
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
        tools["queryAnalytics"] = createSqlQueryTool(context.auth, context.targetProjectId);
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

      case "patch-dashboard": {
        tools["patchDashboard"] = patchDashboardTool(context.auth);
        break;
      }

      default: {
        const _exhaustive: never = toolName;
        captureError("ai-tools-getTools", new StackAssertionError(`Unknown tool name: ${_exhaustive as string}`));
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
    "update-dashboard",
    "patch-dashboard",
  ];

  return toolNames.every((name) => validToolNames.includes(name as ToolName));
}
