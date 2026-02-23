import { SmartRequestAuth } from "@/route-handlers/smart-request";
import { tool } from "ai";
import { z } from "zod";

/**
 * Creates a tool for generating dashboard configurations.
 *
 * This tool does NOT execute server-side - it returns the tool call to the caller,
 * who is responsible for processing the dashboard configuration.
 *
 * @param auth - Optional auth context (can be used for project-specific dashboards)
 */
export function createDashboardTool(auth: SmartRequestAuth | null) {
  return tool({
    description: `Create a custom dashboard configuration for Stack Auth project analytics and monitoring.

**What is a Dashboard?**
A dashboard configuration defines the layout, widgets, and data visualizations for monitoring project metrics, user activity, and analytics.

**Dashboard Components:**
- **Metrics/KPIs**: Display key numbers (user count, active users, conversion rate, etc.)
- **Charts**: Visualize trends over time (line charts, bar charts, area charts)
- **Tables**: Show detailed data (recent users, top events, etc.)
- **Filters**: Allow date ranges, user segments, event types

**Common Dashboard Types:**
1. **Overview Dashboard**: High-level metrics and recent activity
2. **User Analytics**: User growth, retention, engagement
3. **Event Analytics**: Event tracking, funnels, user journeys
4. **Performance Dashboard**: API latency, error rates, system health

**Dashboard Structure:**
- Title and description
- Layout (grid-based)
- Widgets (each with type, data source, configuration)
- Default filters and date ranges

**Guidelines:**
- Start with the most important metrics
- Use appropriate visualizations for each data type
- Keep it focused - avoid information overload
- Include contextual information and tooltips
- Make it actionable - link to detailed views

**Example Dashboard Configuration:**
\`\`\`json
{
  "title": "User Growth Dashboard",
  "description": "Track user acquisition and retention metrics",
  "layout": "grid",
  "widgets": [
    {
      "type": "metric",
      "title": "Total Users",
      "query": "SELECT COUNT(*) FROM users",
      "format": "number"
    },
    {
      "type": "line-chart",
      "title": "Daily Signups",
      "query": "SELECT toDate(signed_up_at) as date, COUNT(*) as signups FROM users WHERE signed_up_at >= today() - 30 GROUP BY date ORDER BY date",
      "xAxis": "date",
      "yAxis": "signups"
    },
    {
      "type": "table",
      "title": "Recent Users",
      "query": "SELECT display_name, primary_email, signed_up_at FROM users ORDER BY signed_up_at DESC LIMIT 10",
      "columns": ["display_name", "primary_email", "signed_up_at"]
    }
  ],
  "defaultDateRange": "last_30_days"
}
\`\`\`

**Output:**
Return a complete dashboard configuration as JSON with title, description, widgets, and layout.`,
    inputSchema: z.object({
      configuration: z.string().describe("The complete dashboard configuration as JSON"),
    }),
    // No execute function - the tool call is returned to the caller
  });
}
