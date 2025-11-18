# Dashboard Design Guide

This guide documents the design patterns and styling conventions used in the Launch Checklist page, intended to be applied consistently across all dashboard pages.

## Table of Contents

1. [Page Structure](#page-structure)
2. [Color System](#color-system)
3. [Dark Mode & Color Contrast](#dark-mode--color-contrast)
4. [Typography](#typography)
5. [Status System](#status-system)
6. [Card Components](#card-components)
7. [Spacing & Layout](#spacing--layout)
8. [Interactive Elements](#interactive-elements)
9. [Helper Sections](#helper-sections)
10. [Progress Indicators](#progress-indicators)
11. [Code Examples](#code-examples)

---

## Page Structure

### Base Layout

All pages should use the `PageLayout` component with title and description:

```tsx
<PageLayout
  title="Page Title"
  description="Brief description of what this page does."
>
  {/* Page content */}
</PageLayout>
```

### Page Sections

Pages typically consist of:
1. **Hero/Summary Section** (optional) - High-level status or overview
2. **Content Grid** - Main content cards in a grid layout

```tsx
<div className="grid gap-4">
  {/* Cards go here */}
</div>
```

---

## Color System

### Status Colors

#### Success/Complete (Emerald)
- **Background**: `bg-emerald-50`
- **Border**: `border-emerald-200`
- **Text**: `text-emerald-500` (icons), `text-emerald-700` (badges)
- **Badge**: `bg-emerald-500 text-white`

#### Informational (Blue)
- **Background**: `bg-blue-500/10`
- **Border**: `border-blue-500/40`
- **Text**: `text-blue-700` (labels), `text-blue-900` (headings)
- **Badge**: `bg-blue-600 text-white`

#### Neutral/Default
- **Background**: `bg-background`
- **Border**: `border-border`
- **Text**: `text-foreground` (primary), `text-muted-foreground` (secondary)

#### Muted Sections
- **Background**: `bg-muted/20`
- **Border**: `border-border/60` or `border-border/70`

### Border Opacity Levels

- `border-border` - Full opacity (default borders)
- `border-border/70` - Subtle borders (checklist items)
- `border-border/60` - Very subtle borders (helper sections)
- `border-blue-500/40` - Tinted informational borders

### Background Opacity

- `bg-background/80` - Slightly transparent backgrounds
- `bg-blue-500/10` - Very subtle tinted backgrounds
- `bg-muted/20` - Subtle muted backgrounds

---

## Dark Mode & Color Contrast

### Design Consistency

**Critical Requirement**: All designs must be consistent throughout the dashboard and work perfectly in both light mode and dark mode with proper color contrast.

### Using Theme-Aware Colors

Always prefer theme-aware color tokens over hardcoded colors. These automatically adapt to light/dark mode:

#### Preferred Theme Tokens

- **Backgrounds**: `bg-background`, `bg-muted`, `bg-card` (not `bg-white` or `bg-gray-*`)
- **Text**: `text-foreground`, `text-muted-foreground` (not `text-gray-*` or `text-black`)
- **Borders**: `border-border`, `border-muted` (not `border-gray-*`)
- **Interactive**: Use component variants (`variant="default"`, `variant="outline"`, etc.) which handle dark mode automatically

#### Status Colors in Dark Mode

When using status colors (emerald, blue), ensure they work in both modes:

**Success/Complete (Emerald)**:
- Use `text-emerald-500` for icons (works in both modes)
- Use `bg-emerald-500 text-white` for badges (sufficient contrast in both modes)
- For card backgrounds, prefer `bg-emerald-50 dark:bg-emerald-950/30` pattern

**Informational (Blue)**:
- Use `text-blue-700 dark:text-blue-400` for labels (adjusts for contrast)
- Use `text-blue-900 dark:text-blue-300` for headings (adjusts for contrast)
- Use `bg-blue-500/10` with `border-blue-500/40` (opacity works well in both modes)

### Color Contrast Requirements

#### Minimum Contrast Ratios (WCAG AA)

- **Normal text**: 4.5:1 contrast ratio
- **Large text** (18pt+ or 14pt+ bold): 3:1 contrast ratio
- **Interactive elements**: 3:1 contrast ratio
- **UI components**: 3:1 contrast ratio

#### Testing Contrast

Always test your designs in both light and dark mode:

```tsx
// ❌ BAD: Hardcoded colors that don't adapt
<div className="bg-white text-gray-900 border-gray-300">
  Content
</div>

// ✅ GOOD: Theme-aware colors
<div className="bg-background text-foreground border-border">
  Content
</div>

// ✅ GOOD: Status colors with dark mode variants
<div className="bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800">
  Content
</div>
```

### Dark Mode Patterns

#### Conditional Dark Mode Classes

When you need different styles for dark mode:

```tsx
// Pattern: light-mode-class dark:dark-mode-class
<Typography className="text-blue-700 dark:text-blue-400">
  Label text
</Typography>

// For backgrounds with opacity
<div className="bg-blue-500/10 dark:bg-blue-500/20">
  Content
</div>
```

#### Status Colors with Dark Mode

```tsx
// Success cards
<div className="bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800">
  {/* Content */}
</div>

// Informational sections
<div className="bg-blue-500/10 dark:bg-blue-500/20 border-blue-500/40 dark:border-blue-500/50">
  {/* Content */}
</div>
```

### Common Dark Mode Issues to Avoid

1. **Hardcoded light colors**: Never use `bg-white`, `text-black`, `text-gray-900` without dark variants
2. **Low contrast borders**: Ensure borders are visible in dark mode (use `border-border` or adjust opacity)
3. **Transparent backgrounds**: Test opacity values (`/10`, `/20`, etc.) work in both modes
4. **Status colors**: Always verify emerald/blue colors maintain sufficient contrast in dark mode
5. **Progress bars**: Background colors like `bg-white/40` may need adjustment for dark mode

### Typography in Dark Mode

Use theme-aware typography variants:

```tsx
// ❌ BAD: Hardcoded colors
<Typography className="text-gray-700">Text</Typography>

// ✅ GOOD: Theme-aware
<Typography className="text-foreground">Text</Typography>
<Typography variant="secondary">Text</Typography>

// ✅ GOOD: Status colors with dark mode
<Typography className="text-blue-700 dark:text-blue-400">Label</Typography>
```

### Verification Checklist

Before finalizing any design:

- [ ] Test in both light mode and dark mode
- [ ] Verify all text meets WCAG AA contrast requirements (4.5:1 for normal text, 3:1 for large text)
- [ ] Check that borders are visible in both modes
- [ ] Ensure interactive elements (buttons, links) have sufficient contrast
- [ ] Verify status colors (emerald, blue) maintain meaning and contrast in both modes
- [ ] Test opacity values work appropriately in both modes
- [ ] Use theme tokens (`bg-background`, `text-foreground`, `border-border`) instead of hardcoded colors
- [ ] Ensure consistent spacing, sizing, and layout in both modes

---

## Typography

### Hierarchy

#### Section Labels (Uppercase)
```tsx
<Typography className="text-xs font-medium uppercase tracking-wide text-blue-700">
  Section Label
</Typography>
```

#### Page Headings
```tsx
<Typography className="text-2xl font-semibold text-blue-900">
  Main Heading
</Typography>
```

#### Card Titles
Use `CardTitle` component (from `@stackframe/stack-ui`)

#### Card Subtitles
Use `CardDescription` component (from `@stackframe/stack-ui`)

#### Body Text
```tsx
<Typography className="text-sm">
  Regular body text
</Typography>
```

#### Secondary Text
```tsx
<Typography variant="secondary" className="text-xs">
  Secondary information
</Typography>
```

#### Small Labels
```tsx
<Typography className="text-xs font-semibold uppercase text-foreground">
  Small Label
</Typography>
```

---

## Status System

### Status Types

Three status types are used throughout:

1. **`done`** - Task/item is complete
2. **`action`** - Task/item requires action (next up)
3. **`blocked`** - Task/item is blocked by errors/issues

### Status Metadata Pattern

```tsx
const STATUS_META: Record<
  StatusType,
  {
    badgeLabel: string,
    badgeVariant: React.ComponentProps<typeof Badge>["variant"],
    badgeClass?: string,
    cardClass: string,
    inactiveIcon: string,
  }
> = {
  done: {
    badgeLabel: "Complete",
    badgeVariant: "default",
    badgeClass: "bg-emerald-500 text-white",
    cardClass: "border-emerald-200 bg-emerald-50",
    inactiveIcon: "text-emerald-500",
  },
  action: {
    badgeLabel: "Up next",
    badgeVariant: "outline",
    cardClass: "border-border bg-background",
    inactiveIcon: "text-muted-foreground",
  },
  blocked: {
    badgeLabel: "Resolve",
    badgeVariant: "outline",
    cardClass: "border-border bg-background",
    inactiveIcon: "text-muted-foreground",
  },
};
```

### Status Icons

- **Complete**: `CheckCircle2` from `lucide-react` with `text-emerald-500`
- **Incomplete**: `Circle` from `lucide-react` with status-appropriate color

---

## Card Components

### Standard Card Structure

```tsx
<Card className={cn("transition-all", statusCardClass)}>
  <CardHeader className="flex flex-wrap justify-between gap-3">
    <div className="space-y-1">
      <CardTitle>{title}</CardTitle>
      <CardDescription>{subtitle}</CardDescription>
      <Badge variant={badgeVariant} className={badgeClass}>
        {badgeLabel}
      </Badge>
    </div>
  </CardHeader>
  <CardContent className="space-y-3">
    {/* Content */}
  </CardContent>
  <CardFooter className="flex justify-end">
    {/* Footer actions */}
  </CardFooter>
</Card>
```

### Card Styling

- Always include `transition-all` for smooth state changes
- Apply status-based classes via `cn()` utility
- Use `flex-wrap` in headers for responsive layouts
- Footer actions should be right-aligned (`flex justify-end`)

### Checklist Rows

Pattern for items within cards:

```tsx
<li className="flex items-start gap-3 rounded-lg border border-border/70 bg-background/80 px-3 py-2">
  <Icon className={cn("mt-1 h-4 w-4 flex-shrink-0", iconClass)} />
  <div className="space-y-1">
    <Typography className="text-sm font-medium leading-none">
      {title}
    </Typography>
    {detail}
  </div>
</li>
```

**Key characteristics:**
- `items-start` for top-aligned icons
- `gap-3` between icon and content
- `border-border/70` for subtle borders
- `bg-background/80` for slight transparency
- `px-3 py-2` for consistent padding
- `rounded-lg` for rounded corners
- Icons: `h-4 w-4` size, `mt-1` for alignment, `flex-shrink-0` to prevent squishing

---

## Spacing & Layout

### Vertical Spacing

- **Between major sections**: `gap-4` (grid or flex)
- **Within cards**: `space-y-3` (CardContent)
- **Between checklist items**: `space-y-2` (ul)
- **Within checklist items**: `space-y-1` (content wrapper)
- **Between related elements**: `gap-3` (flex containers)

### Horizontal Spacing

- **Between flex items**: `gap-3` or `gap-4`
- **Between badges/tags**: `gap-2`
- **Card padding**: Standard Card component padding

### Grid Layouts

```tsx
<div className="grid gap-4">
  {/* Cards */}
</div>
```

### Flex Layouts

```tsx
<div className="flex flex-wrap items-start justify-between gap-4">
  {/* Responsive flex content */}
</div>
```

---

## Interactive Elements

### Buttons

#### Primary Action (Status: action/blocked)
```tsx
<Button size="sm" onClick={handleAction}>
  Action Label
</Button>
```

#### Secondary Action (Status: done)
```tsx
<Button size="sm" variant="ghost" onClick={handleAction}>
  Action Label
</Button>
```

#### Toggle Buttons
```tsx
<Button
  size="sm"
  variant="ghost"
  onClick={() => setOpen((prev) => !prev)}
  className="justify-start px-2"
>
  {open ? "Hide content" : "Show content"}
</Button>
```

### Button Sizing

- Use `size="sm"` for card footers and inline actions
- Use default size for primary CTAs

### Links

Use `StyledLink` component for internal navigation:

```tsx
<StyledLink href={relativeUrl}>
  Link text
</StyledLink>
```

---

## Helper Sections

### Collapsible Helper Content

Pattern for expandable help sections:

```tsx
<div className="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-3">
  <Typography className="text-xs font-semibold uppercase text-foreground">
    Section Title
  </Typography>
  <Typography variant="secondary" className="text-xs">
    Description text
  </Typography>
  <Button
    size="sm"
    variant="ghost"
    onClick={() => setShowHelp((open) => !open)}
    className="justify-start px-2"
  >
    {showHelp ? "Hide help" : "Show help"}
  </Button>
  {showHelp && (
    {/* Collapsible content */}
  )}
</div>
```

**Styling:**
- `rounded-lg` border radius
- `border-border/60` for subtle border
- `bg-muted/20` for muted background
- `p-3` padding
- `space-y-3` vertical spacing

### Tabs in Helper Sections

```tsx
<Tabs defaultValue={defaultTab} className="w-full">
  <TabsList className="flex w-full flex-wrap justify-start gap-2">
    {tabs.map((tab) => (
      <TabsTrigger key={tab.id} value={tab.id}>
        {tab.label}
      </TabsTrigger>
    ))}
  </TabsList>
  {tabs.map((tab) => (
    <TabsContent key={tab.id} value={tab.id} className="space-y-1">
      {/* Content */}
    </TabsContent>
  ))}
</Tabs>
```

### Lists in Helper Sections

```tsx
<ol className="list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
  <li>First step</li>
  <li>Second step</li>
</ol>
```

---

## Progress Indicators

### Progress Bar

```tsx
<Progress
  value={Math.round(progressValue)}
  className="mt-4 h-2 bg-white/40"
/>
```

**Styling:**
- `h-2` for height
- `bg-white/40` for background (adjust based on context)
- `mt-4` for top margin

### Progress Summary Section

```tsx
<div className="rounded-xl border border-blue-500/40 bg-blue-500/10 p-5">
  <div className="flex flex-wrap items-start justify-between gap-4">
    <div className="space-y-2">
      <Typography className="text-xs font-medium uppercase tracking-wide text-blue-700">
        Status Label
      </Typography>
      <Typography className="text-2xl font-semibold text-blue-900">
        {statusText}
      </Typography>
    </div>
    <Badge variant="default" className="bg-blue-600 text-white">
      Badge Label
    </Badge>
  </div>
  <Progress value={progress} className="mt-4 h-2 bg-white/40" />
  <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
    {/* Next action or completion message */}
  </div>
</div>
```

**Styling:**
- `rounded-xl` for larger border radius
- `border-blue-500/40` for tinted border
- `bg-blue-500/10` for very subtle background tint
- `p-5` for padding

---

## Badges

### Status Badges

```tsx
<Badge variant={variant} className={customClass}>
  Label
</Badge>
```

**Variants:**
- `default` - Solid background (for done status)
- `outline` - Outlined (for action/blocked status)

**Custom Classes:**
- `bg-emerald-500 text-white` - Success/complete
- `bg-blue-600 text-white` - Informational
- `variant="outline"` - Default for non-complete states

### Tag Badges

For displaying multiple items:

```tsx
<div className="flex flex-wrap gap-2">
  {items.map((item) => (
    <Badge key={item.id} variant="outline">
      {item.label}
    </Badge>
  ))}
</div>
```

### Count Badge

```tsx
{items.length > maxVisible && (
  <Badge variant="outline">+{items.length - maxVisible}</Badge>
)}
```

---

## Inline Code

Use `InlineCode` component for displaying code snippets, URLs, or technical values:

```tsx
<InlineCode>{codeValue}</InlineCode>
```

---

## Special Sections

### Dashed Border Section

For special interactive sections (like toggles):

```tsx
<div className="rounded-lg border border-dashed border-border bg-background p-3">
  {/* Content */}
</div>
```

### Error Lists

```tsx
<ul className="list-disc space-y-1 pl-4 text-xs text-destructive">
  {errors.map((error) => (
    <li key={error.id}>
      {error.message}{" "}
      <StyledLink href={error.fixUrl}>fix link</StyledLink>
    </li>
  ))}
</ul>
```

---

## Code Examples

### Complete Task Card Pattern

```tsx
type TaskStatus = "done" | "action" | "blocked";

type Task = {
  id: string,
  title: string,
  subtitle: string,
  status: TaskStatus,
  actionLabel: string,
  onAction: () => void,
  items: Array<{
    id: string,
    title: string,
    done: boolean,
    detail?: React.ReactNode,
  }>,
};

function TaskCard({ task }: { task: Task }) {
  const meta = STATUS_META[task.status];
  
  return (
    <Card className={cn("transition-all", meta.cardClass)}>
      <CardHeader className="flex flex-wrap justify-between gap-3">
        <div className="space-y-1">
          <CardTitle>{task.title}</CardTitle>
          <CardDescription>{task.subtitle}</CardDescription>
          <Badge variant={meta.badgeVariant} className={meta.badgeClass}>
            {meta.badgeLabel}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="space-y-2">
          {task.items.map((item) => (
            <ChecklistRow
              key={item.id}
              status={task.status}
              title={item.title}
              done={item.done}
              detail={item.detail}
            />
          ))}
        </ul>
      </CardContent>
      <CardFooter className="flex justify-end">
        <Button
          size="sm"
          variant={task.status === "done" ? "ghost" : "default"}
          onClick={task.onAction}
        >
          {task.actionLabel}
        </Button>
      </CardFooter>
    </Card>
  );
}
```

### Checklist Row Component

```tsx
function ChecklistRow({
  status,
  title,
  done,
  detail,
}: {
  status: TaskStatus,
  title: string,
  done: boolean,
  detail?: React.ReactNode,
}) {
  const Icon = done ? CheckCircle2 : Circle;
  const iconClass = done
    ? "text-emerald-500"
    : STATUS_META[status].inactiveIcon;

  return (
    <li className="flex items-start gap-3 rounded-lg border border-border/70 bg-background/80 px-3 py-2">
      <Icon className={cn("mt-1 h-4 w-4 flex-shrink-0", iconClass)} />
      <div className="space-y-1">
        <Typography className="text-sm font-medium leading-none">
          {title}
        </Typography>
        {detail}
      </div>
    </li>
  );
}
```

---

## Best Practices

1. **Consistency**: Always use the same spacing, colors, and component patterns throughout the dashboard
2. **Dark Mode**: Ensure all designs work perfectly in both light mode and dark mode with proper color contrast
3. **Theme-Aware Colors**: Always use theme tokens (`bg-background`, `text-foreground`, `border-border`) instead of hardcoded colors
4. **Color Contrast**: Verify all text meets WCAG AA contrast requirements (4.5:1 for normal text, 3:1 for large text) in both modes
5. **Status Colors**: Use emerald for success, blue for info, muted for neutral - ensure they maintain contrast in dark mode
6. **Responsive**: Use `flex-wrap` and responsive gap utilities
7. **Transitions**: Add `transition-all` to cards for smooth state changes
8. **Typography**: Use Typography component with appropriate variants (prefer theme-aware over hardcoded colors)
9. **Icons**: Use lucide-react icons consistently (CheckCircle2 for done, Circle for incomplete)
10. **Opacity**: Use opacity modifiers (`/70`, `/60`, `/40`, `/20`, `/10`) for subtle effects - test in both modes
11. **Borders**: Use `border-border` with opacity modifiers for hierarchy - ensure visibility in dark mode
12. **Badges**: Match badge styles to status (emerald for done, outline for others)
13. **Buttons**: Use `size="sm"` in cards, ghost variant for completed states
14. **Testing**: Always test designs in both light and dark mode before finalizing

---

## Component Imports

Standard imports for pages following this design:

```tsx
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Progress,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Typography,
  cn,
} from "@stackframe/stack-ui";
import { CheckCircle2, Circle } from "lucide-react";
import { InlineCode } from "@/components/inline-code";
import { StyledLink } from "@/components/link";
import { PageLayout } from "../page-layout";
```

---

## Design Consistency & Dark Mode Requirements

**Critical**: When creating or updating any dashboard page:

1. **Design Consistency**: Ensure the design is consistent throughout the dashboard, using the same patterns, spacing, colors, and component styles documented in this guide.

2. **Dark Mode Support**: All designs must work perfectly in both light mode and dark mode. Always:
   - Use theme-aware color tokens (`bg-background`, `text-foreground`, `border-border`) instead of hardcoded colors
   - Test all components in both light and dark mode
   - Verify color contrast meets WCAG AA standards (4.5:1 for normal text, 3:1 for large text) in both modes
   - Ensure borders, backgrounds, and interactive elements are visible and functional in both modes

3. **Color Contrast**: Perfect color contrast is required in both modes. Use the patterns and examples in the [Dark Mode & Color Contrast](#dark-mode--color-contrast) section to ensure accessibility.

This guide should be referenced when creating new pages or updating existing ones to ensure visual and functional consistency across the dashboard.
