# Stack Auth Dashboard Design Guide

This guide documents the visual design system used in the Stack Auth dashboard. Use these patterns to create consistent, cohesive UI throughout the application.

---

## Table of Contents

1. [Color System](#color-system)
2. [Typography](#typography)
3. [Spacing & Layout](#spacing--layout)
4. [Glassmorphism & Surfaces](#glassmorphism--surfaces)
5. [Borders & Shadows](#borders--shadows)
6. [Interactive States](#interactive-states)
7. [Component Patterns](#component-patterns)
8. [Animation Guidelines](#animation-guidelines)
9. [Icons](#icons)
10. [Charts & Data Visualization](#charts--data-visualization)

---

## Color System

### CSS Variables (Dark Mode - Primary Theme)

```css
/* Base Colors */
--background: 240 10% 3.9%;     /* Near-black: hsl(240, 10%, 3.9%) - #09090b */
--foreground: 0 0% 98%;          /* Off-white: hsl(0, 0%, 98%) - #fafafa */

/* Surface Colors */
--card: 240 10% 9.4% / 0.5;      /* Semi-transparent dark card */
--popover: 240 10% 3.9%;         /* Same as background */

/* Semantic Colors */
--primary: 0 0% 98%;             /* White for primary actions */
--secondary: 240 3.7% 15.9%;     /* Subtle dark gray */
--muted: 240 3.7% 15.9%;         /* Muted background */
--muted-foreground: 240 5% 64.9%; /* Muted text ~#a1a1aa */
--accent: 240 3.7% 15.9%;        /* Accent background */

/* Status Colors */
--destructive: 0 62.8% 50%;      /* Red for destructive actions */
--success: 120 40% 50%;          /* Green for success states */

/* Border & Input */
--border: 240 3.7% 35.9%;        /* Subtle border */
--input: 240 3.7% 25.9%;         /* Input background */
--ring: 240 4.9% 83.9%;          /* Focus ring */
```

### Accent Colors (Used for Active States)

```css
/* Primary Blue Accent */
Blue-500: #3B82F6
Blue-600: #2563EB (dark text on light)
Blue-400: hsl(240, 71%, 70%) (dark mode highlight)

/* Semantic Accent Colors */
Cyan: hsl(200, 91%, 70%)   /* Daily Active Users */
Purple: hsl(240, 71%, 70%) /* Feature Requests */
Green: emerald-400/500     /* Success, Changelog */
Orange: orange-400/500     /* Support, Alerts */
```

### Color Usage Patterns

```tsx
// Foreground opacity layers (most common pattern)
"bg-foreground/[0.03]"  // Subtle hover backgrounds
"bg-foreground/[0.04]"  // Icon backgrounds, tags
"bg-foreground/[0.05]"  // Slightly more visible
"bg-foreground/[0.06]"  // Active states
"bg-foreground/[0.08]"  // Ring/border highlights
"bg-foreground/[0.10]"  // Prominent backgrounds

// Border opacity layers
"border-foreground/5"   // Very subtle borders
"border-foreground/[0.06]" // Standard borders
"border-foreground/[0.08]" // Highlighted borders
"border-border/10"      // Alternative subtle border
"border-border/30"      // Section dividers
```

---

## Typography

### Font Family

```tsx
// Primary: Geist Sans (variable)
font-family: var(--font-geist-sans);

// Monospace: Geist Mono (for code, numbers)
font-family: var(--font-geist-mono);
```

### Type Scale

```tsx
// Page Title
"text-xl sm:text-2xl font-semibold tracking-tight"

// Section Headers
"text-xs font-semibold uppercase tracking-wider"

// Body Text
"text-sm font-medium"

// Small/Caption Text
"text-xs font-medium"
"text-[11px] font-medium"

// Micro Text (badges, labels)
"text-[10px] font-bold uppercase tracking-wide"
"text-[9px]"
```

### Text Colors

```tsx
// Primary text
"text-foreground"

// Secondary/muted text
"text-muted-foreground"

// Interactive text (in muted state)
"text-muted-foreground hover:text-foreground"

// Accent text (when active)
"text-blue-600 dark:text-blue-400"
```

---

## Spacing & Layout

### Standard Spacing Scale

```tsx
// Gaps between elements
gap-1    // 4px - tight spacing
gap-2    // 8px - compact spacing
gap-2.5  // 10px - slightly larger
gap-3    // 12px - standard spacing
gap-4    // 16px - section spacing
gap-5    // 20px - larger section spacing (sm:gap-5)

// Padding
p-2      // 8px - compact padding
p-3      // 12px - standard padding
p-4      // 16px - generous padding
p-5      // 20px - section padding
px-3 py-2    // Horizontal/vertical separate
px-4 sm:px-6 // Responsive padding
```

### Container Widths

```tsx
// Sidebar
w-[248px]     // Expanded sidebar
w-[64px]      // Collapsed sidebar

// Content
max-w-7xl     // Maximum content width

// Cards/Widgets
minmax(90px, 1fr)  // Grid items
```

### Layout Patterns

```tsx
// Main page layout
<div className="py-4 px-4 sm:py-6 sm:px-6 flex justify-center flex-1">

// Grid layouts
"grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-5"
"grid grid-cols-[repeat(auto-fill,minmax(90px,1fr))] gap-2"

// Sticky elements
"sticky top-3"     // Header
"sticky top-20"    // Sidebar (below header)

// Flex patterns
"flex items-center gap-2"
"flex flex-col gap-3"
```

---

## Glassmorphism & Surfaces

### Primary Surface Pattern (Header, Sidebar, Panels)

```tsx
// Light mode
"bg-gray-100/80 border border-border/10 backdrop-blur-xl"

// Dark mode
"dark:bg-foreground/5 dark:border-foreground/5 backdrop-blur-xl"

// Combined (common pattern)
"bg-gray-100/80 dark:bg-foreground/5 border border-border/10 dark:border-foreground/5 backdrop-blur-xl"
```

### Card Surfaces

```tsx
// Glassmorphic card (charts, widgets)
"bg-background/60 backdrop-blur-xl ring-1 ring-foreground/[0.06]"

// Standard card (from globals.css)
// Applied automatically with .bg-card class:
// - backdrop-filter: blur(12px)
// - radial-gradient backgrounds
// - box-shadow on light mode

// Chart card pattern
<div className={cn(
  "group relative rounded-2xl bg-background/60 backdrop-blur-xl",
  "ring-1 ring-foreground/[0.06] hover:ring-foreground/[0.1]",
  "shadow-sm hover:shadow-md hover:z-10"
)}>
```

### Tooltip/Popover Surface

```tsx
"rounded-xl bg-background/95 px-3.5 py-2.5 shadow-lg backdrop-blur-xl ring-1 ring-foreground/[0.08]"
```

### Floating Companion Handle

```tsx
"bg-foreground/[0.03] backdrop-blur-xl border border-foreground/5 shadow-sm"
```

---

## Borders & Shadows

### Border Patterns

```tsx
// Very subtle (default)
"border border-border/10 dark:border-foreground/5"

// Section dividers
"border-t border-border/30"
"border-b border-foreground/[0.05]"

// Focus/active ring
"ring-1 ring-foreground/[0.06]"
"ring-1 ring-blue-500/20"  // Active accent
```

### Shadow Patterns

```tsx
// Subtle shadow (cards)
"shadow-sm"

// Interactive hover shadow
"shadow-sm hover:shadow-md"

// Prominent shadow (floating elements)
"shadow-lg"
"shadow-xl"
"shadow-2xl"  // Main container border effect

// Glow effects (active states)
"shadow-[0_0_12px_rgba(59,130,246,0.15)]"  // Blue glow
"shadow-[0_0_20px_rgba(59,130,246,0.45)]"  // Intense blue glow (hover)
```

### Border Radius

```tsx
// Standard scale
"rounded-lg"    // 8px (var(--radius))
"rounded-xl"    // 12px - Common for cards, buttons
"rounded-2xl"   // 16px - Large containers, panels
"rounded-full"  // Circular - Pills, avatar

// Specific values
"rounded-[20%]" // App icons (superellipse)
```

---

## Interactive States

### Active/Selected State (Navigation, Tabs)

```tsx
// Blue gradient highlight with glow
"bg-gradient-to-r from-blue-500/[0.15] to-blue-500/[0.08] text-foreground shadow-[0_0_12px_rgba(59,130,246,0.15)] ring-1 ring-blue-500/20"

// Icon color when active
"text-blue-600 dark:text-blue-400"
```

### Hover States

```tsx
// Background hover
"hover:bg-foreground/[0.03]"  // Subtle
"hover:bg-foreground/[0.05]"  // More visible
"hover:bg-foreground/[0.06]"  // Prominent
"hover:bg-background/60"       // Navigation items

// Text hover
"text-muted-foreground hover:text-foreground"

// Ring hover
"ring-1 ring-foreground/[0.06] hover:ring-foreground/[0.1]"

// Shadow hover
"shadow-sm hover:shadow-md"
```

### Transition Pattern (CRITICAL)

```tsx
// Always use hover-EXIT transitions, not hover-ENTER
// This makes the UI feel snappy, not sluggish

// CORRECT: Fast transition on hover-out, instant on hover-in
"transition-all duration-150 hover:transition-none"
"transition-colors duration-150 hover:transition-none"
"transition-transform duration-150 hover:transition-none"

// For very slow animations (like icon hover effects)
"transition-all duration-750 group-hover:transition-none"

// WRONG: Don't do this (causes delays on hover-in)
"transition-all duration-300"  // ❌ Delays feel sluggish
```

### Button States

```tsx
// Primary button
"bg-primary text-primary-foreground hover:bg-primary/90"

// Ghost button (most common)
"hover:bg-accent hover:text-accent-foreground"

// Custom styled button
"h-9 w-9 p-0 text-muted-foreground hover:text-foreground hover:bg-background/60 rounded-lg"

// Active button with accent
"bg-foreground/10 text-foreground shadow-sm ring-1 ring-foreground/5"
```

---

## Component Patterns

### Navigation Item (Sidebar)

```tsx
// Container
<button className={cn(
  "group flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm font-medium",
  "transition-all duration-150 hover:transition-none",
  isActive
    ? "bg-gradient-to-r from-blue-500/[0.15] to-blue-500/[0.08] text-foreground shadow-[0_0_12px_rgba(59,130,246,0.15)] ring-1 ring-blue-500/20"
    : "hover:bg-background/60 text-muted-foreground hover:text-foreground"
)}>

// Icon
<IconComponent className={cn(
  "h-4 w-4 flex-shrink-0 transition-colors duration-150 group-hover:transition-none",
  isActive ? "text-blue-600 dark:text-blue-400" : "text-muted-foreground group-hover:text-foreground"
)} />
```

### Sub-navigation Indicator Dot

```tsx
<span className={cn(
  "h-2 w-2 rounded-full transition-all duration-150 group-hover:transition-none",
  isActive
    ? "bg-blue-600 dark:bg-blue-400"
    : "bg-muted-foreground/40 group-hover:bg-blue-500/50"
)} />
```

### Quick Access Item (App Grid)

```tsx
<Link
  href={appPath}
  className="group flex flex-col items-center gap-2.5 pt-3 pb-2 rounded-xl hover:bg-foreground/[0.03] transition-all duration-750 hover:transition-none"
>
  <div className="relative transition-transform duration-750 group-hover:transition-none group-hover:scale-105">
    <AppIcon
      appId={appId}
      className="shadow-sm group-hover:shadow-[0_0_20px_rgba(59,130,246,0.45)] group-hover:brightness-110 group-hover:saturate-110 transition-all duration-750 group-hover:transition-none"
    />
  </div>
  <span className="text-[11px] font-medium text-center group-hover:text-foreground transition-colors duration-750 group-hover:transition-none">
    {app.displayName}
  </span>
</Link>
```

### Section Header with Icon

```tsx
<div className="flex items-center gap-2 mb-4">
  <div className="p-1.5 rounded-lg bg-foreground/[0.04]">
    <LayoutGrid className="h-3.5 w-3.5" />
  </div>
  <span className="text-xs font-semibold text-foreground uppercase tracking-wider">
    Quick Access
  </span>
</div>
```

### Time Range Toggle (Pill Buttons)

```tsx
<div className="flex items-center gap-1 rounded-xl bg-foreground/[0.04] p-1 backdrop-blur-sm">
  {options.map((option) => (
    <button
      key={option.value}
      className={cn(
        "px-3 py-1.5 text-xs font-medium rounded-lg transition-all duration-150 hover:transition-none",
        isActive
          ? "bg-background text-foreground shadow-sm ring-1 ring-foreground/[0.06] dark:bg-[hsl(240,71%,70%)]/10 dark:text-[hsl(240,71%,90%)] dark:ring-[hsl(240,71%,70%)]/20"
          : "text-muted-foreground hover:text-foreground hover:bg-background/50"
      )}
    >
      {option.label}
    </button>
  ))}
</div>
```

### Chart Card

```tsx
<div className={cn(
  "group relative rounded-2xl bg-background/60 backdrop-blur-xl transition-all duration-150 hover:transition-none",
  "ring-1 ring-foreground/[0.06] hover:ring-foreground/[0.1]",
  "shadow-sm hover:shadow-md hover:z-10"
)}>
  {/* Glassmorphic gradient overlay */}
  <div className="absolute inset-0 bg-gradient-to-br from-foreground/[0.02] to-transparent pointer-events-none rounded-2xl overflow-hidden" />
  
  {/* Accent hover tint */}
  <div className={cn(
    "absolute inset-0 transition-colors duration-150 group-hover:transition-none pointer-events-none rounded-2xl overflow-hidden",
    "group-hover:bg-cyan-500/[0.03]"  // or blue, purple, etc.
  )} />
  
  <div className="relative h-full flex flex-col">
    {/* Card content */}
  </div>
</div>
```

### Tab Indicator (Underline Style)

```tsx
<button className={cn(
  "relative px-3 py-3.5 text-xs font-medium transition-all duration-150 hover:transition-none rounded-t-lg",
  isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground"
)}>
  {label}
  {isActive && (
    <div className="absolute bottom-0 left-3 right-3 h-0.5 rounded-full bg-cyan-500 dark:bg-[hsl(200,91%,70%)]" />
  )}
</button>
```

### User List Item (Clickable Row)

```tsx
<button className={cn(
  "w-full flex items-center gap-3 p-2.5 rounded-xl transition-all duration-150 hover:transition-none text-left group",
  "hover:bg-cyan-500/[0.06]"  // accent color hover
)}>
  <UserAvatar user={user} size={32} border />
  <div className="flex-1 min-w-0">
    <div className="text-sm font-medium truncate text-foreground group-hover:text-foreground transition-colors duration-150 group-hover:transition-none">
      {user.display_name}
    </div>
    <div className="text-[11px] text-muted-foreground truncate">
      {subtitle}
    </div>
  </div>
</button>
```

### Legend/Tag Pills

```tsx
<div className={cn(
  "flex items-center gap-1.5 rounded-full bg-foreground/[0.03] ring-1 ring-foreground/[0.06]",
  "transition-colors duration-150 hover:transition-none hover:bg-foreground/[0.05]",
  "px-3 py-1.5 text-xs"  // or compact: "px-2.5 py-1 text-[10px]"
)}>
  <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
  <span className="font-medium text-foreground">{label}</span>
  <span className="text-muted-foreground">{percentage}%</span>
</div>
```

---

## Animation Guidelines

### Core Principles

1. **Hover-Exit Transitions Only**: Apply transitions only when the user stops hovering
2. **Instant Feedback**: No delay on hover-in states
3. **Smooth Recovery**: Gentle transition back to default state

```tsx
// Standard pattern
"transition-all duration-150 hover:transition-none"

// For longer animations (icon effects)
"transition-all duration-750 group-hover:transition-none"
```

### Transition Durations

```tsx
duration-[50ms]   // Very fast (button icon scale)
duration-150      // Standard interactions
duration-200      // Layout changes (sidebar collapse)
duration-300      // Drawer/panel animations
duration-750      // Slow ambient effects (icon hover)
```

### Transform Effects

```tsx
// Scale on hover
"group-hover:scale-105"

// Rotate on state change
"transition-transform duration-200"
isCollapsed && "rotate-180"

// Translate for collapse/expand
"translate-y-0" / "translate-y-2"
```

### Animation Keyframes (globals.css)

```css
@keyframes fadeIn {
  0% { opacity: 0; }
  100% { opacity: 1; }
}

/* Usage */
"animate-fade-in"  // 0.3s ease-in-out
```

---

## Icons

### Icon Sizing

```tsx
// Navigation icons
"h-4 w-4"

// Section header icons
"h-3.5 w-3.5"

// Large feature icons
"h-5 w-5"
"w-[30px] h-[30px]"

// Status badges
"w-3 h-3 sm:w-3.5 sm:h-3.5"
```

### Icon Colors

```tsx
// Default/muted
"text-muted-foreground"

// Hover
"text-muted-foreground group-hover:text-foreground"

// Active (blue accent)
"text-blue-600 dark:text-blue-400"

// Color-coded (companion sidebar)
"text-blue-600 dark:text-blue-400"    // Docs
"text-purple-600 dark:text-purple-400" // Feature Requests
"text-green-600 dark:text-green-400"   // Changelog
"text-orange-600 dark:text-orange-400" // Support
```

### App Icon Component

```tsx
// Uses superellipse corners and gradient backgrounds
// See: packages/stack-shared/src/apps/apps-ui.tsx

<AppIcon
  appId={appId}
  variant={isEnabled ? "installed" : "default"}
  className="shadow-sm group-hover:shadow-[0_0_20px_rgba(59,130,246,0.45)]"
/>
```

---

## Charts & Data Visualization

### Chart Colors

```tsx
// Daily Active Users
"hsl(180, 95%, 53%)"  // Light mode
"hsl(200, 91%, 70%)"  // Dark mode (cyan)

// Daily Sign-Ups
"hsl(221, 83%, 53%)"  // Light mode
"hsl(240, 71%, 70%)"  // Dark mode (blue/purple)
```

### Chart Card Layout

```tsx
<ChartCard gradientColor="cyan">
  {/* Tab bar */}
  <div className="flex items-center justify-between border-b border-foreground/[0.05] px-4">
    {/* Tabs with underline indicator */}
  </div>
  
  {/* Content */}
  <div className="p-4 pt-3 flex flex-col justify-center flex-1 min-h-0">
    {/* Chart or list content */}
  </div>
</ChartCard>
```

### Bar Chart Styling

```tsx
// Grid
strokeDasharray="3 3"
stroke="hsl(var(--border))"
opacity={0.3}

// Bars
radius={[4, 4, 0, 0]}  // Rounded top corners
fill="var(--color-activity)"
opacity={isWeekend ? 0.5 : 1}  // Dimmed weekends
```

### Chart Tooltip

```tsx
<div className="rounded-xl bg-background/95 px-3.5 py-2.5 shadow-lg backdrop-blur-xl ring-1 ring-foreground/[0.08]">
  <span className="text-[11px] font-medium text-muted-foreground tracking-wide">
    {date}
  </span>
  <div className="flex items-center gap-2.5">
    <span className="h-2 w-2 rounded-full ring-2 ring-white/20" style={{ backgroundColor: color }} />
    <span className="text-[11px] text-muted-foreground">Activity</span>
    <span className="ml-auto font-mono text-xs font-semibold tabular-nums text-foreground">
      {value}
    </span>
  </div>
</div>
```

---

## Background Effects

### Page Background Shine (Dark Mode Only)

```tsx
// Blurred gradient orbs in top-right corner
// See: apps/dashboard/src/app/background-shine.tsx

<div className="fixed inset-0 hidden dark:block opacity-75 -z-10000">
  {/* Purple/blue gradient orb */}
  <div style={{
    background: 'linear-gradient(to bottom, #4E61B3, #9196F4)',
    filter: 'blur(100px)',
    borderRadius: '100%',
  }} />
  {/* Additional accent orbs... */}
</div>
```

### Card Gradient Overlays

```tsx
// Subtle top-left to transparent gradient
"bg-gradient-to-br from-foreground/[0.02] to-transparent"

// Dark mode card backgrounds (from globals.css)
background-image: radial-gradient(ellipse at top, #18182288, transparent),
                  radial-gradient(ellipse at bottom, #19191988, transparent);
```

---

## Responsive Patterns

### Breakpoints

```tsx
// Tailwind defaults used
sm: 640px   // Small devices
md: 768px   // Medium devices
lg: 1024px  // Large devices (sidebar visible)
xl: 1280px  // Extra large
2xl: 1400px // Container max width
```

### Common Responsive Patterns

```tsx
// Show/hide sidebar
"hidden lg:flex"
"lg:hidden"

// Responsive padding
"py-4 px-4 sm:py-6 sm:px-6"
"p-3 sm:p-4"

// Responsive grid
"grid-cols-1 lg:grid-cols-12"
"grid-cols-1 sm:grid-cols-2"

// Responsive text
"text-xl sm:text-2xl"
"text-[11px] sm:text-xs"
```

---

## Quick Reference: Common Class Combinations

```tsx
// Glassmorphic surface
"bg-gray-100/80 dark:bg-foreground/5 border border-border/10 dark:border-foreground/5 backdrop-blur-xl rounded-2xl shadow-sm"

// Card surface
"bg-background/60 backdrop-blur-xl ring-1 ring-foreground/[0.06] rounded-2xl shadow-sm"

// Hover item background
"hover:bg-foreground/[0.03] transition-all duration-150 hover:transition-none"

// Active state (blue accent)
"bg-gradient-to-r from-blue-500/[0.15] to-blue-500/[0.08] shadow-[0_0_12px_rgba(59,130,246,0.15)] ring-1 ring-blue-500/20"

// Muted text that brightens on hover
"text-muted-foreground hover:text-foreground transition-colors duration-150 hover:transition-none"

// Icon button
"h-9 w-9 p-0 rounded-lg text-muted-foreground hover:text-foreground hover:bg-background/60 transition-all duration-150 hover:transition-none"

// Section header
"flex items-center gap-2 mb-4"
"p-1.5 rounded-lg bg-foreground/[0.04]"
"text-xs font-semibold uppercase tracking-wider"

// Toggle pill group
"flex items-center gap-1 rounded-xl bg-foreground/[0.04] p-1 backdrop-blur-sm"
```

---

## Do's and Don'ts

### ✅ Do

- Use `hover:transition-none` for snappy interactions
- Use opacity-based backgrounds (`bg-foreground/[0.03]`)
- Apply `backdrop-blur-xl` for glassmorphic effects
- Use `rounded-2xl` for major containers
- Use `ring-1 ring-foreground/[0.06]` instead of heavy borders
- Use gradient highlights for active states

### ❌ Don't

- Add hover-enter transitions (feels sluggish)
- Use solid background colors (loses glass effect)
- Use thick, prominent borders
- Mix different border-radius scales in the same component
- Use pure black or white (use `foreground`/`background` variables)
- Forget dark mode variants for custom colors
