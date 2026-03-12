# Stack Auth Dashboard Design Guide

This guide defines the source of truth for dashboard UI design and implementation.
It is intentionally written for both humans and AI agents.

If this guide conflicts with older examples in the codebase, follow this guide.

---

## 1) Core Principle (Non-Negotiable)

Always prefer components from `apps/dashboard/src/components/design-components`.

- Do not build new ad-hoc visual primitives (for example custom `GlassCard`, custom badge pills, custom pill toggles, custom list rows) if a design-components component exists.
- If the desired UI can be achieved by tweaking/customizing/extending a design-components component, do that instead of creating a page-local alternative.
- In all cases, default to design-components first; only use a non-design-components approach when there is absolutely no viable way to achieve the result with design-components.
- Use `@/components/ui/*` primitives only when no design-components equivalent exists, or when the design-components component intentionally wraps the primitive.
- Match existing design-components behavior:
  - hover-exit transitions (`transition-* duration-150 hover:transition-none`)
  - glassmorphic surfaces where appropriate
  - semantic variants for alerts/badges
  - async-safe click handlers via design-components primitives

---

## 2) Fast Decision Tree

Use this when implementing a new dashboard UI quickly:

1. Need a section container/card?
   - Use `DesignCard`.
2. Need user-facing status/info/warning/error message?
   - Use `DesignAlert`.
3. Need small semantic label (sent, failed, queued, active)?
   - Use `DesignBadge`.
4. Need user action button, especially async?
   - Use `DesignButton`.
5. Need text input/selectors in design-components surfaces?
   - Use `DesignInput` and `DesignSelectorDropdown`.
6. Need a segmented/pill switcher?
   - Use `DesignPillToggle`.
7. Need category tabs with count badges?
   - Use `DesignCategoryTabs`.
8. Need row/list item with action buttons/menu?
   - Use `DesignListItemRow` (or `DesignUserList` for user rows).
9. Need settings/property grid editor?
   - Use `DesignEditableGrid`.
10. Need data table with consistent dashboard style?
   - Use `DesignDataTable`.
11. Need dropdown action/selector/toggle menu?
   - Use `DesignMenu`.

---

## 3) Allowed Base UI Usage

`@/components/ui/*` can still be used for primitives that do not currently have a design-components equivalent:

- dialogs/sheets/popovers (`ActionDialog`, `FormDialog`, `Sheet`, etc.)
- complex layout containers where design-components does not provide one
- highly specialized editor internals

When using a primitive directly:

- keep visual style compatible with design-components surfaces
- do not duplicate a design-components component API locally
- consider creating/extending a design-components component instead of repeating local patterns

---

## 3.1) Best Practices (Always Apply)

- Build with design-components primitives first, then add minimal page-level styling.
- Keep components composable: pass data/config via props instead of hardcoding display logic.
- Favor semantic APIs (`variant`, `color`, `gradient`) over raw class-heavy style forks.
- Use accessible defaults:
  - clear labels for icon-only controls
  - keyboard focus visibility (`focus-visible:*`)
  - semantic roles where applicable
- Keep behavior deterministic:
  - one visual language per screen
  - one status-color mapping across all routes
  - one interaction pattern per control type

---

## 3.2) Color System (Light + Dark Theme)

Use semantic tokens and design-components variants first. Avoid ad-hoc hardcoded colors unless there is a documented semantic reason.

### Theme token usage priority

1. Use component variants (`DesignAlert`, `DesignBadge`, `DesignCard` gradient, tab/toggle gradients).
2. Use semantic Tailwind tokens (`bg-background`, `text-foreground`, `text-muted-foreground`, `border-border`).
3. Use opacity layers for subtle surfaces (for example `bg-foreground/[0.03]`).

### Surface and text rules

- Primary surfaces: `bg-background` + subtle ring/border.
- Secondary/muted surfaces: low-opacity foreground overlays.
- Primary text: `text-foreground`.
- Secondary text: `text-muted-foreground`.
- Never use pure black/white hardcoded utility values for app UI text/surfaces.

### Semantic state colors

- Success: green/emerald (`DesignAlert variant="success"`, `DesignBadge color="green"`)
- Error: red (`DesignAlert variant="error"`, `DesignBadge color="red"`)
- Warning: orange/amber (`DesignAlert variant="warning"`, `DesignBadge color="orange"`)
- Info: blue/cyan (`DesignAlert variant="info"`, `DesignBadge color="blue"` or `"cyan"`)

### Light vs dark guidance

- Ensure every custom color choice has dark-mode readability.
- In dark mode, reduce high-contrast fills and rely on low-opacity tints + rings.
- Keep contrast high for text and medium for non-critical chrome.

---

## 3.3) Typography System

Keep typography concise and consistent. Prefer existing design-components/header patterns.

### Recommended scale and usage

- Page title: `text-xl sm:text-2xl font-semibold tracking-tight`
- Section heading: `text-xs font-semibold uppercase tracking-wider`
- Body/default control text: `text-sm`
- Secondary metadata: `text-xs text-muted-foreground`
- Micro labels/badges: `text-[10px]` to `text-[11px]`

### Typography rules

- Use uppercase tracking only for section labels and compact metadata headings.
- Avoid introducing new arbitrary font sizes when an existing size serves the purpose.
- Keep line-length short in cards and alerts for scanability.
- For numeric/stat values, use tabular numerals where needed.

---

## 3.4) Spacing and Layout Guidelines

Use a compact, repeatable spacing rhythm.

### Spacing rhythm

- `gap-1` (4px): tight icon/text coupling
- `gap-2` (8px): compact control spacing
- `gap-3` (12px): standard row spacing
- `gap-4` (16px): section-internal spacing
- `gap-5` (20px): larger section grouping

### Padding rhythm

- `p-2` / `px-3 py-2`: compact controls
- `p-3`: standard compact blocks
- `p-4` to `p-5`: card content/major sections

### Layout rules

- Use `rounded-2xl` for major containers/cards.
- Use `rounded-xl` for controls (inputs, toggles, small cards).
- Preserve visual hierarchy:
  - page spacing > section spacing > control spacing
- Avoid mixing unrelated spacing scales inside a single component.

---

## 3.5) Animation and Micro-Interactions

Motion should feel immediate, subtle, and informative.

### Core motion rules

- No hover-enter delay transitions.
- Use hover-exit transitions: `transition-* duration-150 hover:transition-none`.
- Keep interaction transitions short and subtle.
- Do not use large animated movement in dense admin surfaces.

### Duration guidance

- `50ms-100ms`: very small icon feedback
- `150ms`: standard hover/focus/press recovery
- `200ms-300ms`: layout/state transitions (panel collapse, sheet-like reveals)
- `>300ms`: only ambient/non-critical effects

### Micro-interaction patterns

- Hover:
  - text brightens slightly
  - ring/shadow intensifies subtly
- Press:
  - instant feedback (no delayed press animation)
- Focus:
  - visible `focus-visible` ring on all interactive elements
- Loading:
  - use design-components built-in loading states (`DesignButton`, tabs/toggles with async)
  - never freeze the UI without feedback

### Motion accessibility

- Respect `prefers-reduced-motion` for non-essential effects.
- Keep micro-interactions understandable without relying on animation alone.

---

## 3.6) Best-Practice Checklist (Visual + UX)

- [ ] Uses design-components primitives before custom wrappers.
- [ ] Uses semantic variants/colors instead of custom status styles.
- [ ] Works in both light and dark themes with readable contrast.
- [ ] Uses approved typography scale and hierarchy.
- [ ] Uses consistent spacing rhythm (`gap-2/3/4`, `p-3/4/5`).
- [ ] Uses snappy hover-exit transitions and clear focus rings.
- [ ] Provides clear loading/disabled/empty/error states.

---

## 4) Component-by-Component Contract

This section is prescriptive: use these components with these props for these scenarios.

### 4.1 `DesignCard`

File: `apps/dashboard/src/components/design-components/card.tsx`

Use for:

- page sections
- grouped controls
- analytics panels
- list containers
- glassmorphic blocks used in email/project pages

Props you should use most:

- `title`, `icon`, optional `subtitle` for section headers
- `gradient`: `"blue" | "cyan" | "purple" | "green" | "orange" | "default"`
- `glassmorphic` (optional explicit override)
- `contentClassName` for content spacing overrides

Important behavior:

- If `title` is provided, `icon` is required by type.
- Layout is auto-derived:
  - `title + subtitle` -> full header
  - `title only` -> compact header
  - no title -> body-only card
- `useGlassmorphicDefault()` makes nested components default to glassmorphic behavior.

Default recommendation:

- for dashboard sections, use `glassmorphic` style (either explicit or via nesting context)
- use `gradient="default"` unless there is semantic reason for colored tint

### 4.2 `DesignAlert`

File: `apps/dashboard/src/components/design-components/alert.tsx`

Use for:

- save success/failure
- warning states (for example SMTP/provider configuration warnings)
- informational notices

Props:

- `variant`: `"default" | "success" | "error" | "warning" | "info"`
- `title`
- `description`
- `glassmorphic` when rendered on glass surfaces

Rules:

- use semantic variant instead of custom alert class combinations
- keep title short and actionable
- put longer explanation in `description`

### 4.3 `DesignBadge`

File: `apps/dashboard/src/components/design-components/badge.tsx`

Use for:

- status chips (sent, failed, queued, draft, active)
- small semantic labels in headers and lists

Props:

- `label`
- `color`: `"blue" | "cyan" | "purple" | "green" | "orange" | "red"`
- `icon` (optional)
- `size`: `"sm" | "md"`
- `contentMode`: `"both" | "text" | "icon"`

Rules:

- choose color by meaning, not preference
- use `contentMode="icon"` only when `icon` is provided
- for icon-only badges, accessibility is already handled via `aria-label`

### 4.4 `DesignButton`

File: `apps/dashboard/src/components/design-components/button.tsx`

Use for:

- all primary/secondary actions in dashboard surfaces
- async submit/save/delete actions

Props:

- `variant`: `"default" | "destructive" | "outline" | "secondary" | "ghost" | "link" | "plain"`
- `size`: `"default" | "sm" | "lg" | "icon"`
- `onClick` (can be async)
- `loading` (optional controlled mode)
- `loadingStyle`: `"spinner" | "disabled"`
- `asChild` if composition with links/triggers is needed

Rules:

- prefer `DesignButton` over base `Button` for async behavior and consistent loading semantics
- do not hand-roll loading spinners for standard button actions

### 4.5 `DesignInput`

File: `apps/dashboard/src/components/design-components/input.tsx`

Use for:

- text fields inside design-components surfaces
- compact filter fields and inline settings inputs

Props:

- `size`: `"sm" | "md" | "lg"`
- `prefixItem` for fixed prefix UI
- `leadingIcon` for icon-leading input
- regular input props (placeholder, value, onChange, disabled, etc.)

Rules:

- use `prefixItem` for prefixed values (domains/paths/currency symbols)
- use `leadingIcon` for search or query fields

### 4.6 `DesignSelectorDropdown`

File: `apps/dashboard/src/components/design-components/select.tsx`

Use for:

- standard single-select dropdowns in dashboard settings and filters

Props:

- `value`
- `onValueChange`
- `options: { value, label, disabled? }[]`
- `placeholder`
- `size`: `"sm" | "md" | "lg"`
- `disabled`

Rules:

- prefer this instead of raw `Select` in feature pages unless custom behavior is required

### 4.7 `DesignPillToggle`

File: `apps/dashboard/src/components/design-components/pill-toggle.tsx`

Use for:

- segmented controls
- viewport switches
- compact mode switches

Props:

- `options: { id, label, icon? }[]`
- `selected`
- `onSelect`
- `size`: `"sm" | "md" | "lg"`
- `gradient`
- `showLabels` (set false for icon-only controls)
- `glassmorphic`

Rules:

- do not create custom inline pill toggle components if this fits
- use `showLabels={false}` only with clear icons and tooltip-friendly labels

### 4.8 `DesignCategoryTabs`

File: `apps/dashboard/src/components/design-components/tabs.tsx`

Use for:

- top-level category switching with optional count badges

Props:

- `categories: { id, label, count?, badgeCount? }[]`
- `selectedCategory`
- `onSelect`
- `showBadge`
- `size`: `"sm" | "md"`
- `gradient`
- `glassmorphic`

Rules:

- use for category-level navigation, not micro toggles
- if there are no category counts and control is small, `DesignPillToggle` may be better

### 4.9 `DesignMenu`

File: `apps/dashboard/src/components/design-components/menu.tsx`

Use for:

- standard row/card action menus
- selector menu (radio group)
- toggles menu (checkbox items)

Variants and required props:

- `variant="actions"` with `items`
- `variant="selector"` with `options`, `value`, `onValueChange`
- `variant="toggles"` with `options`, `onToggleChange`

Common shared props:

- `trigger`: `"button" | "icon"`
- `triggerLabel`
- `triggerIcon`
- `align`
- `label`
- `withIcons`

Rules:

- prefer this over local `DropdownMenu` wrappers for common action menus

### 4.10 `DesignListItemRow` and `DesignUserList`

File: `apps/dashboard/src/components/design-components/list.tsx`

Use for:

- structured list rows with optional per-row actions
- user activity/user list rows

`DesignListItemRow` props:

- `title`, optional `subtitle`
- `icon`
- `size`: `"sm" | "lg"`
- `buttons` (direct actions or menu actions)
- `onClick`

`DesignUserList` props:

- `users: { name, email, time, color? }[]`
- `onUserClick`
- `showAvatar`
- `gradient`: `"blue-purple" | "cyan-blue" | "none"`

Rules:

- use `size="sm"` for dense lists
- use `size="lg"` for card-like list entries
- replace custom row/card list items with this unless layout is truly unique

### 4.11 `DesignEditableGrid`

File: `apps/dashboard/src/components/design-components/editable-grid.tsx`

Use for:

- key/value settings editors
- mixed-type setting controls
- deferred save/discard patterns

Props:

- `items` (typed union: `text`, `boolean`, `dropdown`, `custom-dropdown`, `custom-button`, `custom`)
- `columns`: `1 | 2`
- `deferredSave`, `hasChanges`, `onSave`, `onDiscard`
- `externalModifiedKeys`

Rules:

- prefer this for config forms that are row-based and editable inline
- use deferred save mode when many fields should be committed together

### 4.12 `DesignDataTable`

File: `apps/dashboard/src/components/design-components/table.tsx`

Use for:

- dashboard data tables where shared table behavior is required

Props:

- `columns`, `data`
- `defaultColumnFilters`
- `defaultSorting`
- `showDefaultToolbar`
- `showResetFilters`
- `onRowClick`

Rules:

- use this wrapper instead of raw `DataTable` for consistency unless you need a custom table architecture

### 4.13 `CursorBlastEffect`

File: `apps/dashboard/src/components/design-components/cursor-blast-effect.tsx`

Use for:

- optional high-feedback interactions (playground/internal prototyping)

Props:

- `blastLifetimeMs`
- `maxActiveBlasts`
- `rageClickThreshold`
- `rageClickWindowMs`
- `rageClickRadiusPx`
- `containerRef`

Rules:

- keep as optional enhancement, not required UX
- avoid distracting overuse in production-critical flows

---

## 5) Route-Specific Guidance (Project + Email Surfaces)

Reference surfaces:

- `apps/dashboard/src/app/(main)/(protected)/projects/[projectId]`
- `apps/dashboard/src/app/(main)/(protected)/projects/[projectId]/emails`
- `apps/dashboard/src/app/(main)/(protected)/projects/[projectId]/email-drafts`
- `apps/dashboard/src/app/(main)/(protected)/projects/[projectId]/email-outbox`
- `apps/dashboard/src/app/(main)/(protected)/projects/[projectId]/email-templates`
- `apps/dashboard/src/app/(main)/(protected)/projects/[projectId]/email-themes`

Current pattern in these pages often uses custom card/header/pill components. New and refactored code should standardize to design-components primitives as follows.

### 5.1 `/projects/[projectId]/emails`

Use:

- section containers: `DesignCard` (`title`, `icon`, optional `subtitle`, `gradient`)
- alerts: `DesignAlert` (`variant` by state)
- status chips: `DesignBadge` (`green` for sent, `red` for failed)
- actions: `DesignButton`
- table: `DesignDataTable`

Avoid:

- custom `GlassCard`
- custom status-badge component
- raw `Alert` unless special composition is required

### 5.2 `/projects/[projectId]/email-drafts` (list)

Use:

- list container: `DesignCard`
- row items: `DesignListItemRow` (`size="lg"` for card rows or `size="sm"` for dense list)
- row menus: `DesignMenu` with `variant="actions"`
- empty state action: `DesignButton`

Avoid:

- custom `DraftCard` for standard list row behavior

### 5.3 `/projects/[projectId]/email-drafts/[draftId]` (editor)

Use:

- status/sync alerts: `DesignAlert`
- scope/status chips: `DesignBadge`
- editor side controls: `DesignButton`, `DesignSelectorDropdown`, `DesignInput` as needed

Keep:

- specialized editor layout systems if no design-components equivalent exists

### 5.4 `/projects/[projectId]/email-outbox`

Use:

- section cards: `DesignCard` (preferred for visual consistency with other email screens)
- filters: `DesignSelectorDropdown`, `DesignInput`
- status badges: `DesignBadge`
- action buttons/menus: `DesignButton`, `DesignMenu`
- data grid/list table: `DesignDataTable` when feasible

Avoid:

- mixed badge systems (`Badge` in some places, custom badges elsewhere)

### 5.5 `/projects/[projectId]/email-templates`

Use:

- template item containers: `DesignCard` (`gradient` per semantic section)
- alerts/warnings: `DesignAlert`
- actions: `DesignButton`
- template row action menu: `DesignMenu`

Avoid:

- inline repeated glass class blocks for each template card

### 5.6 `/projects/[projectId]/email-templates/[templateId]`

Use:

- save/error notices: `DesignAlert`
- top actions: `DesignButton`
- state tags: `DesignBadge` where needed

### 5.7 `/projects/[projectId]/email-themes`

Use:

- section containers: `DesignCard`
- viewport/device selector: `DesignPillToggle`
- status messages: `DesignAlert`
- theme state badges: `DesignBadge`
- actions: `DesignButton`, `DesignMenu`

Avoid:

- custom `ViewportSelector` if `DesignPillToggle` supports the same behavior

### 5.8 `/projects/[projectId]/email-themes/[themeId]`

Use:

- state feedback: `DesignAlert`
- actions: `DesignButton`
- optional segmented controls: `DesignPillToggle`

---

## 6) Semantic Mapping Rules

Use consistent semantic color/variant mapping across all pages:

- Success/completed/sent -> `DesignAlert variant="success"` and `DesignBadge color="green"`
- Error/failed -> `DesignAlert variant="error"` and `DesignBadge color="red"`
- Warning/attention -> `DesignAlert variant="warning"` and `DesignBadge color="orange"`
- Info/neutral updates -> `DesignAlert variant="info"` and `DesignBadge color="blue"` or `"cyan"`

Gradient mapping for cards/tabs/toggles:

- Blue: primary navigation/state
- Cyan: analytics/activity
- Purple: templates/themes or creative tools
- Green: success/completion
- Orange: warnings/caution
- Default: neutral/system sections

---

## 7) Interaction and Motion Rules

These rules must be preserved in custom styling and overrides:

- no hover-enter delays
- use hover-exit transitions: `transition-* duration-150 hover:transition-none`
- keep controls snappy and readable
- avoid heavy animation in dense admin workflows

For async actions:

- prefer design-components primitives that already handle async/loading
- do not swallow async errors; use existing alert-aware async utilities through design-components primitives

---

## 8) AI-Readable Implementation Checklist

Use this checklist before opening a dashboard UI PR:

- [ ] Replaced ad-hoc cards with `DesignCard` where possible.
- [ ] Replaced ad-hoc alerts with `DesignAlert`.
- [ ] Replaced ad-hoc badges/status pills with `DesignBadge`.
- [ ] Replaced ad-hoc segmented controls with `DesignPillToggle` or `DesignCategoryTabs`.
- [ ] Replaced ad-hoc row/list cards with `DesignListItemRow` or `DesignUserList`.
- [ ] Used `DesignButton` for async actions.
- [ ] Used `DesignSelectorDropdown`/`DesignInput` for standard field controls.
- [ ] Used `DesignDataTable` for standard tables.
- [ ] Did not introduce duplicate local wrappers for components already in design-components.
- [ ] Kept hover/motion behavior aligned with this guide.

---

## 9) Quick Snippets (Canonical)

### Section Card

```tsx
<DesignCard
  title="Email Log"
  subtitle="View and manage email sending history"
  icon={Envelope}
  gradient="default"
>
  {/* content */}
</DesignCard>
```

### Semantic Alert

```tsx
<DesignAlert
  variant="error"
  title="Failed to send email"
  description="Please verify provider configuration and try again."
/>
```

### Status Badge

```tsx
<DesignBadge
  label="Sent"
  color="green"
  icon={CheckCircle}
  size="sm"
/>
```

### Viewport Toggle

```tsx
<DesignPillToggle
  options={[
    { id: "desktop", label: "Desktop", icon: Desktop },
    { id: "tablet", label: "Tablet", icon: DeviceTablet },
    { id: "mobile", label: "Mobile", icon: DeviceMobile },
  ]}
  selected={viewport}
  onSelect={setViewport}
  size="sm"
  gradient="default"
/>
```

### Category Tabs

```tsx
<DesignCategoryTabs
  categories={[
    { id: "all", label: "All", count: 42 },
    { id: "failed", label: "Failed", count: 3 },
  ]}
  selectedCategory={category}
  onSelect={setCategory}
  gradient="blue"
/>
```

---

## 10) Anti-Patterns (Do Not Introduce)

- Creating local `GlassCard` components instead of `DesignCard`.
- Creating local status pills instead of `DesignBadge`.
- Creating local segmented/pill selectors instead of `DesignPillToggle`.
- Using raw `Alert`/`Button` in standard dashboard surfaces where `DesignAlert`/`DesignButton` should be used.
- Repeating large inline class strings for common design-components patterns.

---

## 11) Migration Priority for Existing Email Surfaces

When touching existing email/project pages, migrate in this order:

1. Cards/surfaces (`DesignCard`)
2. Alerts (`DesignAlert`)
3. Badges (`DesignBadge`)
4. Toggles/tabs (`DesignPillToggle` / `DesignCategoryTabs`)
5. Rows/lists (`DesignListItemRow`)
6. Buttons/menus (`DesignButton` / `DesignMenu`)
7. Tables/forms (`DesignDataTable`, `DesignInput`, `DesignSelectorDropdown`, `DesignEditableGrid`)

This order yields the biggest consistency win first.

---

## 12) Maintenance Rule

Whenever a new reusable visual pattern is introduced in dashboard features:

- add or extend a design-components component first
- then document the component contract and preferred usage here
- avoid introducing permanent page-local UI primitives that duplicate design-components behavior

