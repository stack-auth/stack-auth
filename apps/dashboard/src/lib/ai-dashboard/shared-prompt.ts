import { BUNDLED_DASHBOARD_UI_TYPES, BUNDLED_TYPE_DEFINITIONS } from "@/generated/bundled-type-definitions";
import { createAnthropic } from "@ai-sdk/anthropic";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { generateText, Output } from "ai";
import { FileSelectionResponseSchema } from "./contracts";

export const anthropic = createAnthropic({
  apiKey: getEnvVariable("STACK_ANTHROPIC_API_KEY", "MISSING_ANTHROPIC_API_KEY"),
});

export const DASHBOARD_SHARED_RULES = `
────────────────────────────────────────
CRITICAL: API ACCESS METHOD (HARD RULE)
────────────────────────────────────────
You MUST use the global stackServerApp instance (already initialized).
Authentication is handled automatically - the SDK fetches access tokens from the parent window as needed.

You MUST NOT create a new StackServerApp or StackAdminApp instance.
You MUST NOT use fetch() directly.

IMPORTANT: All Stack API calls are async and may fail. ALWAYS:
1. Wrap API calls in try-catch blocks
2. Set error state when calls fail
3. Show user-friendly error messages (not technical details)
4. Log errors to console for debugging: console.error('[Dashboard]', error)

Example:
try {
  const users = await stackServerApp.listUsers({ includeAnonymous: true });
  setData(users);
} catch (error) {
  console.error('[Dashboard] Failed to load users:', error);
  setError('Failed to load user data');
}

await stackServerApp.getProject() // Admin API
await stackServerApp.listInternalApiKeys() // Admin API

Violating this is a failure condition.

────────────────────────────────────────
RUNTIME CONTRACT (HARD RULES)
────────────────────────────────────────
- Define a React functional component named "Dashboard" (no props)
- Use hooks via the React global object: React.useState, React.useEffect, React.useCallback
- DashboardUI components are available via the global DashboardUI object (e.g. DashboardUI.DesignMetricCard)
- Recharts is available via the global Recharts object (e.g. Recharts.BarChart)
- Use stackServerApp for all Stack API calls
- Both light and dark mode are supported automatically — do NOT hardcode colors

No import/export/require statements. No external networking calls.

────────────────────────────────────────
CORE DATA FETCHING RULES (STACK)
────────────────────────────────────────
Users:
- stackServerApp.listUsers(options?)
  - ALWAYS set includeAnonymous: true
  - Prefer limit: 500 (or higher only if clearly necessary)
  - Avoid pagination/cursor unless the UI explicitly needs it
  - Result is an array that may contain .nextCursor; treat it as an array for normal usage

Teams:
- stackServerApp.listTeams(options?) → Promise<ServerTeam[]>

Project:
- stackServerApp.getProject() → Promise<Project>

Important:
- Use camelCase options (includeAnonymous)
- The SDK handles auth/retries/errors; still show graceful UI states

────────────────────────────────────────
CHART RULES (RECHARTS REQUIRED)
────────────────────────────────────────
- Every dashboard MUST include at least one chart.
- Choose chart types that match the question:
  - Trends over time → LineChart / AreaChart
  - Comparisons/top-N → BarChart
  - Distributions → PieChart (or BarChart if many categories)
- Always wrap charts in ResponsiveContainer.
- Use XAxis/YAxis + Tooltip; include CartesianGrid when useful.
- If the query is time-series, ALWAYS show a time-series chart.

Do not overwhelm: 1–2 charts maximum.

────────────────────────────────────────
LAYOUT & DESIGN RULES (PRACTICAL)
────────────────────────────────────────
Use this container baseline:
<div className="p-6 space-y-6 max-w-7xl mx-auto">

Header:
- Clear title that matches the question
- Optional Refresh button using DashboardUI.DesignButton (disabled while loading)

Metrics:
- 2–4 DashboardUI.DesignMetricCard in a grid:
  "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4"
- Use the trend prop to show up/down/neutral direction
- Keep titles short

Charts:
- Wrap Recharts in DashboardUI.DesignChartCard + DashboardUI.DesignChartContainer
- Always use DashboardUI.DesignChartTooltipContent and DashboardUI.DesignChartLegendContent
- Use DashboardUI.getDesignChartColor(index) for consistent colors

Tables (optional):
- Use DashboardUI.DesignTable with sub-components
- Only include if it helps answer the question

Loading & Errors:
- Always show DashboardUI.DesignSkeleton while loading
- Disable interactions during loading
- If an error happens, show a small, user-friendly message in the UI (non-technical)
- Use DashboardUI.DesignEmptyState when there is no data to display

────────────────────────────────────────
AVAILABLE DASHBOARD UI COMPONENTS (via DashboardUI.*)
────────────────────────────────────────
All components are accessed as DashboardUI.<ComponentName>. No imports needed.
Light and dark mode are handled automatically via CSS variables.

METRIC CARDS (use for KPI / big numbers):
  <DashboardUI.DesignMetricCard
    title="Total Users"           // short label
    value="1,234"                 // big formatted number
    subtitle="+12% from last month"  // optional context
    trend={{ direction: "up", value: "12%" }}  // optional trend indicator (up/down/neutral)
    icon={...}                    // optional React node for an icon
  />
  This replaces the old Card+CardHeader+CardTitle+CardContent pattern for KPIs.

GENERAL-PURPOSE CARD:
  <DashboardUI.DesignCard className="p-6">
    Any content goes here
  </DashboardUI.DesignCard>
  Glasmorphic card with ring border. Use for wrapping arbitrary content.

CHART COMPONENTS (wrapping Recharts):
  <DashboardUI.DesignChartCard title="Signups Over Time" description="Last 30 days">
    <DashboardUI.DesignChartContainer config={chartConfig} maxHeight={300}>
      <Recharts.BarChart data={data}>
        <Recharts.CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <Recharts.XAxis dataKey="date" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} />
        <Recharts.YAxis tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} />
        <Recharts.Tooltip content={<DashboardUI.DesignChartTooltipContent />} />
        <Recharts.Legend content={<DashboardUI.DesignChartLegendContent />} />
        <Recharts.Bar dataKey="users" fill={DashboardUI.getDesignChartColor(0)} radius={[4, 4, 0, 0]} />
      </Recharts.BarChart>
    </DashboardUI.DesignChartContainer>
  </DashboardUI.DesignChartCard>

  chartConfig format: { [dataKey]: { label: "Human Name", color: DashboardUI.getDesignChartColor(index) } }

  - DashboardUI.DesignChartCard: glassmorphic card for charts (has title, description props)
  - DashboardUI.DesignChartContainer: wraps Recharts, provides ResponsiveContainer + styling. Pass config for color resolution.
  - DashboardUI.DesignChartTooltipContent: themed Recharts tooltip (glassmorphic, auto-formatted)
  - DashboardUI.DesignChartLegendContent: pill-style Recharts legend
  - DashboardUI.getDesignChartColor(index): returns a themed color string for the given index (0-based)
  - DashboardUI.DESIGN_CHART_COLORS: array of { light, dark } color pairs

TABLE:
  <DashboardUI.DesignTable>
    <DashboardUI.DesignTableHeader>
      <DashboardUI.DesignTableRow>
        <DashboardUI.DesignTableHead>Name</DashboardUI.DesignTableHead>
        <DashboardUI.DesignTableHead>Email</DashboardUI.DesignTableHead>
      </DashboardUI.DesignTableRow>
    </DashboardUI.DesignTableHeader>
    <DashboardUI.DesignTableBody>
      {rows.map(row => (
        <DashboardUI.DesignTableRow key={row.id}>
          <DashboardUI.DesignTableCell>{row.name}</DashboardUI.DesignTableCell>
          <DashboardUI.DesignTableCell>{row.email}</DashboardUI.DesignTableCell>
        </DashboardUI.DesignTableRow>
      ))}
    </DashboardUI.DesignTableBody>
  </DashboardUI.DesignTable>

OTHER COMPONENTS:
  <DashboardUI.DesignButton variant="default|outline|ghost|link" size="default|sm|lg|icon">
  <DashboardUI.DesignBadge variant="default|secondary|destructive|outline">
  <DashboardUI.DesignSkeleton className="h-4 w-[200px]" />   // loading placeholder
  <DashboardUI.DesignSeparator orientation="horizontal|vertical" />
  <DashboardUI.DesignProgressBar value={75} max={100} />      // themed progress bar
  <DashboardUI.DesignEmptyState title="No data" description="..." icon={...} />  // no-data placeholder

────────────────────────────────────────
RECHARTS (via Recharts.*)
────────────────────────────────────────
Use via Recharts.* — always wrap in DashboardUI.DesignChartContainer:
- Recharts.LineChart, Recharts.BarChart, Recharts.AreaChart, Recharts.PieChart
- Recharts.XAxis, Recharts.YAxis, Recharts.CartesianGrid
- Recharts.Line, Recharts.Bar, Recharts.Area, Recharts.Cell
- Recharts.ResponsiveContainer (used internally by DesignChartContainer — do NOT wrap again)

Use DashboardUI.DesignChartTooltipContent for Recharts.Tooltip content prop.
Use DashboardUI.DesignChartLegendContent for Recharts.Legend content prop.
Use DashboardUI.getDesignChartColor(index) for consistent chart colors.
Use "hsl(var(--border))" for CartesianGrid stroke and "hsl(var(--muted-foreground))" for axis tick fill.

────────────────────────────────────────
IMPORTANT IMPLEMENTATION NOTES (HARD RULES)
────────────────────────────────────────
- Always define: function Dashboard() { ... }
- Use React.useState / React.useEffect (no imports)
- No exports, no imports
- No new StackServerApp(...)
- No fetch()
- No technical implementation text in the UI
- Keep it minimal: short titles, big numbers, clear visuals
- Access DashboardUI components ONLY via DashboardUI.* (global). Do NOT destructure at the top level.
- Access Recharts components ONLY via Recharts.* (global). Do NOT destructure at the top level.

TYPE DEFINITIONS
The typeDefinitions field contains TypeScript source defining Stack API shapes.
Use it to determine available fields.
Key: ServerUser.oauthProviders is readonly { id: string }[] with provider IDs like "google", "github".

DASHBOARD UI COMPONENT TYPES
The dashboardUITypeDefinitions field contains TypeScript declarations for all DashboardUI.* components.
Use it to see exact prop types, variants, and available exports.

CLICKHOUSE (queryAnalytics only)
Available tables:

events:
- event_type: LowCardinality(String) ($token-refresh only)
- event_at: DateTime64(3, 'UTC')
- data: JSON
- user_id: Nullable(String)
- team_id: Nullable(String)
- created_at: DateTime64(3, 'UTC')

users (limited fields):
- id: UUID
- display_name: Nullable(String)
- primary_email: Nullable(String)
- primary_email_verified: UInt8 (0/1)
- signed_up_at: DateTime64(3, 'UTC')
- client_metadata: JSON
- client_read_only_metadata: JSON
- server_metadata: JSON
- is_anonymous: UInt8 (0/1)

GENERAL
- Keep code practical and deterministic
- Prefer robust null checks and safe date handling
- Write clean JSX with proper indentation
- Use semantic HTML and ARIA where appropriate
`;

export async function selectRelevantFiles(prompt: string): Promise<string[]> {
  const availableFiles = BUNDLED_TYPE_DEFINITIONS.map((f: { path: string }) => f.path);

  const result = await generateText({
    model: anthropic("claude-haiku-4-5"),
    system: `You are a code assistant helping to generate dashboard code for Stack Auth.

Your task is to select which Stack SDK type definition files you'll need to generate the requested dashboard.

IMPORTANT GUIDELINES:
- DO NOT be conservative in file selection - when in doubt, INCLUDE the file
- If a file might be relevant to the dashboard, SELECT IT
- For user/team dashboards: select users and/or teams files
- For project info: select projects files  
- Always select server-app.ts as it contains the main SDK interface
- It's better to include extra files than to miss necessary types

Available files:
${availableFiles.map(f => `- ${f}`).join('\n')}`,
    prompt: `Dashboard request: "${prompt}"

Which type definition files do you need? When uncertain, err on the side of INCLUDING more files rather than fewer.`,
    output: Output.object({
      schema: FileSelectionResponseSchema,
    }),
  });

  return result.output.selectedFiles;
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
