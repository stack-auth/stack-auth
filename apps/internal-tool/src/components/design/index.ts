/**
 * Local design primitives for the internal tool. They mirror the hexclave-imessage-agent
 * observability dashboard (carbon palette, washed panels, 13px tight-tracked type) rather than
 * importing shared components: the internal tool is a separate Next app with its own Tailwind
 * build, and `@hexclave/dashboard-ui-components` would drag along the dashboard's provider stack.
 */
export { cn } from "./cn";
export { Badge, type BadgeColor } from "./badge";
export { Button, Divider, FieldLabel, Input, Pill, Select, Textarea } from "./controls";
export { BarRow, chartColors, LegendItem } from "./charts";
export { SortHeader, tableClasses } from "./table";
export { Alert, Card, EmptyState, MetricCard, Tooltip } from "./surfaces";
export { type ConnectionState, ViewHeader } from "./observability";
