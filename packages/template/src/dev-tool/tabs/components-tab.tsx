"use client";

import { stringCompare } from "@stackframe/stack-shared/dist/utils/strings";
import React, { Suspense, useEffect, useState } from "react";
import { TooltipProvider } from "@stackframe/stack-ui";
import { CATALOG_NAMES, COMPONENT_CATALOG } from "../component-catalog";
import { DevToolComponentPreviewProvider, globalRegistry } from "../hooks/use-component-registry";

// IF_PLATFORM react-like

type ComponentInfo = {
  name: string;
  instanceId: string;
  props: Record<string, unknown>;
  mountedAt: number;
};

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatPropValue(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value.toString();
  if (typeof value === 'string') return `"${value}"`;
  if (typeof value === 'number') return value.toString();
  if (typeof value === 'function') return 'fn()';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value, null, 0).slice(0, 80);
    } catch {
      return '[Object]';
    }
  }
  return String(value);
}

function getInstancesForName(components: Map<string, ComponentInfo>, name: string): ComponentInfo[] {
  return [...components.values()]
    .filter((c) => c.name === name)
    .sort((a, b) => a.mountedAt - b.mountedAt);
}

function sanitizeForPreview(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (typeof value === "function") {
    return async () => {};
  }
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value !== "object") {
    return value;
  }
  if (React.isValidElement(value)) {
    return value;
  }
  if (value instanceof Date) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForPreview(item, seen));
  }
  if (seen.has(value)) {
    return value;
  }
  seen.add(value);
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === "children") {
      continue;
    }
    result[key] = sanitizeForPreview(entry, seen);
  }
  return result;
}

function sanitizeForPrompt(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === "function") {
    return "[function]";
  }
  if (typeof value !== "object") {
    return value;
  }
  if (React.isValidElement(value)) {
    return "[ReactElement]";
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForPrompt(item, seen));
  }
  if (seen.has(value)) {
    return "[Circular]";
  }
  seen.add(value);
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === "children") {
      continue;
    }
    result[key] = sanitizeForPrompt(entry, seen);
  }
  return result;
}

function formatJsxPropValue(value: unknown): string | null {
  if (value === undefined) {
    return null;
  }
  if (value === null) {
    return "{null}";
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return `{${String(value)}}`;
  }
  if (Array.isArray(value) || typeof value === "object") {
    return `{${JSON.stringify(value, null, 2)}}`;
  }
  return null;
}

function formatJsxSnippet(name: string, propsSnapshot: Record<string, unknown>): string {
  const propLines = Object.entries(sanitizeForPrompt(propsSnapshot) as Record<string, unknown>)
    .map(([key, value]) => {
      const formatted = formatJsxPropValue(value);
      if (formatted === null) {
        return null;
      }
      return `  ${key}=${formatted}`;
    })
    .filter((line): line is string => line !== null);

  if (propLines.length === 0) {
    return `<${name} />`;
  }

  return [
    `<${name}`,
    ...propLines,
    `/>`,
  ].join("\n");
}

function getBuiltInPrompt(name: string, propsSnapshot: Record<string, unknown>): string {
  const entry = COMPONENT_CATALOG[name];
  const promptLines = [
    `Implement the Stack Auth \`${name}\` component shown in the dev tool preview.`,
    "",
    "Requirements:",
    "- Use the project's existing Stack Auth provider/setup.",
    "- Import the component from the same Stack Auth SDK package this app already uses, for example `@stackframe/react` or `@stackframe/stack`.",
    "- Prefer the built-in Stack Auth component instead of reimplementing the auth flow manually.",
  ];

  for (const note of entry.promptNotes ?? []) {
    promptLines.push(`- ${note}`);
  }

  promptLines.push(
    "",
    "Start from this JSX usage:",
    "```tsx",
    `import { ${name} } from "@stackframe/react";`,
    "",
    formatJsxSnippet(name, propsSnapshot),
    "```"
  );

  const sanitized = sanitizeForPrompt(propsSnapshot) as Record<string, unknown>;
  if (Object.keys(sanitized).length > 0) {
    promptLines.push(
      "",
      "Current prop snapshot from the dev tool:",
      "```json",
      JSON.stringify(sanitized, null, 2),
      "```"
    );
  }

  return promptLines.join("\n");
}

function getCustomPrompt(name: string, propsSnapshot: Record<string, unknown>, displayName?: string): string {
  const sanitized = sanitizeForPrompt(propsSnapshot) as Record<string, unknown>;
  const promptLines = [
    `Implement the React component \`${displayName ?? name}\` so it matches the dev tool preview and preserves the existing public API.`,
    "",
    "Requirements:",
    "- Keep the component name and external behavior aligned with the existing app.",
    "- Reuse the current design system and surrounding app patterns instead of inventing a new UI direction.",
    "- Treat the prop snapshot below as the starting contract unless the codebase already defines something stricter.",
    "",
    "Start from this JSX usage:",
    "```tsx",
    formatJsxSnippet(name, propsSnapshot),
    "```",
  ];

  if (Object.keys(sanitized).length > 0) {
    promptLines.push(
      "",
      "Current prop snapshot from the dev tool:",
      "```json",
      JSON.stringify(sanitized, null, 2),
      "```"
    );
  }

  return promptLines.join("\n");
}

function getImplementationPrompt(name: string, propsSnapshot: Record<string, unknown>, displayName?: string): string {
  if (name in COMPONENT_CATALOG) {
    return getBuiltInPrompt(name, propsSnapshot);
  }
  return getCustomPrompt(name, propsSnapshot, displayName);
}

type PreviewErrorBoundaryState = { error: Error | null };

class PreviewErrorBoundary extends React.Component<
  { children: React.ReactNode },
  PreviewErrorBoundaryState
> {
  state: PreviewErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): PreviewErrorBoundaryState {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="sdt-preview-error">
          Preview could not render this component ({this.state.error.message}). It may require auth,
          navigation, or async data that is not available in the panel.
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * Renders a live preview of a catalog component. Uses the catalog entry's
 * `preview` field: `'none'` skips it, a function overrides, otherwise the
 * component is rendered directly with the given props.
 */
function DevToolComponentPreview({ name, propsSnapshot }: { name: string; propsSnapshot: Record<string, unknown> }) {
  if (!Object.prototype.hasOwnProperty.call(COMPONENT_CATALOG, name)) {
    return <div className="sdt-preview-unavailable">Unknown component: {name}</div>;
  }
  const entry = COMPONENT_CATALOG[name];

  if (entry.preview === 'none') {
    return (
      <div className="sdt-preview-unavailable">
        Live preview is not available for {name}.
      </div>
    );
  }

  const sanitized = sanitizeForPreview(propsSnapshot) as Record<string, unknown>;
  const content = entry.preview
    ? entry.preview(sanitized)
    : React.createElement(entry.component, sanitized);

  return (
    <PreviewErrorBoundary>
      <Suspense fallback={<div className="sdt-preview-loading">Loading preview…</div>}>
        <TooltipProvider>
          <DevToolComponentPreviewProvider>{content}</DevToolComponentPreviewProvider>
        </TooltipProvider>
      </Suspense>
    </PreviewErrorBoundary>
  );
}

function ComponentPreviewHeader(props: {
  name: string;
  propsSnapshot: Record<string, unknown>;
  displayName?: string;
}) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const prompt = getImplementationPrompt(props.name, props.propsSnapshot, props.displayName);

  return (
    <div className="sdt-component-preview-header">
      <div className="sdt-component-preview-label">Preview</div>
      <button
        className="sdt-secondary-btn"
        type="button"
        onClick={() => {
          navigator.clipboard.writeText(prompt).then(() => {
            setCopyState("copied");
            window.setTimeout(() => setCopyState("idle"), 1500);
          }, () => {
            setCopyState("error");
            window.setTimeout(() => setCopyState("idle"), 2000);
          });
        }}
        title="Copy an implementation prompt for this component"
      >
        {copyState === "copied" ? "Copied" : copyState === "error" ? "Copy failed" : "Copy prompt"}
      </button>
    </div>
  );
}

function MountedComponentDetail({ component }: { component: ComponentInfo }) {
  const propEntries = Object.entries(component.props).filter(
    ([key]) => key !== 'children'
  );

  return (
    <div className="sdt-component-detail">
      <h3>&lt;{component.name} /&gt;</h3>
      <div className="sdt-component-detail-sub">
        Mounted at {formatTime(component.mountedAt)} &bull; Instance: {component.instanceId}
      </div>

      <ComponentPreviewHeader
        name={component.name}
        propsSnapshot={component.props}
      />
      <div className="sdt-component-preview-frame">
        <DevToolComponentPreview
          key={component.instanceId}
          name={component.name}
          propsSnapshot={component.props}
        />
      </div>

      {propEntries.length > 0 ? (
        <table className="sdt-props-table">
          <thead>
            <tr>
              <th>Prop</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            {propEntries.map(([key, value]) => (
              <tr key={key}>
                <td>{key}</td>
                <td>{formatPropValue(value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="sdt-empty-state" style={{ padding: '20px' }}>
          <div>No props passed</div>
        </div>
      )}
    </div>
  );
}

function UnmountedComponentDetail({ name }: { name: string }) {
  return (
    <div className="sdt-component-detail">
      <h3>&lt;{name} /&gt;</h3>
      <div className="sdt-component-detail-sub">Not mounted on the current route</div>

      <ComponentPreviewHeader
        name={name}
        propsSnapshot={{}}
      />
      <div className="sdt-component-preview-frame">
        <DevToolComponentPreview name={name} propsSnapshot={{}} />
      </div>

      <p className="sdt-unmounted-hint">
        This component is not rendered on the current page.
      </p>
    </div>
  );
}

function ComponentNameRows(props: {
  names: readonly string[];
  labelForName: (name: string) => string;
  components: Map<string, ComponentInfo>;
  selectedInstanceId: string | null;
  selectedUnmountedName: string | null;
  expandedNames: Set<string>;
  setExpandedNames: React.Dispatch<React.SetStateAction<Set<string>>>;
  setSelectedInstanceId: (id: string | null) => void;
  setSelectedUnmountedName: (name: string | null) => void;
}) {
  const {
    names,
    labelForName,
    components,
    selectedInstanceId,
    selectedUnmountedName,
    expandedNames,
    setExpandedNames,
    setSelectedInstanceId,
    setSelectedUnmountedName,
  } = props;

  return (
    <>
      {names.map((name) => {
        const instances = getInstancesForName(components, name);
        const inUse = instances.length > 0;
        const isExpanded = expandedNames.has(name);
        const rowSelected =
          (selectedUnmountedName === name && !inUse) ||
          (inUse && instances.some((i) => i.instanceId === selectedInstanceId));

        const openOrSelect = () => {
          setSelectedUnmountedName(null);
          if (!inUse) {
            setSelectedInstanceId(null);
            setSelectedUnmountedName(name);
            return;
          }
          if (instances.length === 1) {
            setSelectedInstanceId(instances[0].instanceId);
            return;
          }
          setExpandedNames((prev) => {
            const next = new Set(prev);
            if (next.has(name)) {
              next.delete(name);
            } else {
              next.add(name);
            }
            return next;
          });
        };

        return (
          <React.Fragment key={name}>
            <div
              className="sdt-component-item"
              data-selected={rowSelected}
              onClick={openOrSelect}
            >
              <span
                className={`sdt-component-status ${inUse ? "sdt-component-status--on" : "sdt-component-status--off"}`}
                title={inUse ? "In use on this page" : "Not mounted on this page"}
              />
              <span>{labelForName(name)}</span>
              {instances.length > 1 && (
                <span className="sdt-component-expand" aria-hidden>
                  {instances.length}×{isExpanded ? " \u2212" : " +"}
                </span>
              )}
            </div>
            {instances.length > 1 && isExpanded
              ? instances.map((inst, index) => (
                <div
                  key={inst.instanceId}
                  className="sdt-component-item sdt-component-item-nested"
                  data-selected={selectedInstanceId === inst.instanceId}
                  onClick={(e) => {
                      e.stopPropagation();
                      setSelectedUnmountedName(null);
                      setSelectedInstanceId(inst.instanceId);
                  }}
                >
                  <span className="sdt-component-status sdt-component-status--on" />
                  <span>
                      #{index + 1} · {formatTime(inst.mountedAt)}
                  </span>
                </div>
              ))
              : null}
          </React.Fragment>
        );
      })}
    </>
  );
}

export function ComponentsTab() {
  const [components, setComponents] = useState<Map<string, ComponentInfo>>(
    () => new Map(globalRegistry.components)
  );
  const [catalog, setCatalog] = useState(() => new Map(globalRegistry.customCatalog));
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);
  const [selectedUnmountedName, setSelectedUnmountedName] = useState<string | null>(null);
  const [expandedNames, setExpandedNames] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    setComponents(new Map(globalRegistry.components));
    setCatalog(new Map(globalRegistry.customCatalog));
    return globalRegistry.subscribe(() => {
      setComponents(new Map(globalRegistry.components));
      setCatalog(new Map(globalRegistry.customCatalog));
    });
  }, []);

  useEffect(() => {
    if (selectedInstanceId == null) {
      return;
    }
    const comp = components.get(selectedInstanceId);
    if (comp == null) {
      return;
    }
    const group = getInstancesForName(components, comp.name);
    if (group.length > 1) {
      setExpandedNames((prev) => new Set(prev).add(comp.name));
    }
  }, [selectedInstanceId, components]);

  const builtinSet = new Set(CATALOG_NAMES);
  const instanceNames = new Set([...components.values()].map((c) => c.name));
  const extraNames = [...instanceNames].filter((n) => !builtinSet.has(n) && !catalog.has(n));
  const yourAppNames = [...new Set([...catalog.keys(), ...extraNames])].sort(stringCompare);

  const selectedComponent =
    selectedInstanceId != null ? components.get(selectedInstanceId) ?? null : null;

  const labelForCatalog = (name: string) => catalog.get(name)?.displayName ?? name;

  return (
    <div className="sdt-split-pane">
      <div className="sdt-split-left">
        <div className="sdt-component-list">
          <div className="sdt-component-group-label">Stack SDK</div>
          <ComponentNameRows
            names={CATALOG_NAMES}
            labelForName={(name) => name}
            components={components}
            selectedInstanceId={selectedInstanceId}
            selectedUnmountedName={selectedUnmountedName}
            expandedNames={expandedNames}
            setExpandedNames={setExpandedNames}
            setSelectedInstanceId={setSelectedInstanceId}
            setSelectedUnmountedName={setSelectedUnmountedName}
          />
          {yourAppNames.length > 0 ? (
            <>
              <div className="sdt-component-group-label">Your app</div>
              <ComponentNameRows
                names={yourAppNames}
                labelForName={labelForCatalog}
                components={components}
                selectedInstanceId={selectedInstanceId}
                selectedUnmountedName={selectedUnmountedName}
                expandedNames={expandedNames}
                setExpandedNames={setExpandedNames}
                setSelectedInstanceId={setSelectedInstanceId}
                setSelectedUnmountedName={setSelectedUnmountedName}
              />
            </>
          ) : null}
        </div>
      </div>
      <div className="sdt-split-right">
        {selectedComponent ? (
          <MountedComponentDetail component={selectedComponent} />
        ) : selectedUnmountedName != null ? (
          <UnmountedComponentDetail name={selectedUnmountedName} />
        ) : (
          <div className="sdt-empty-state">
            <div className="sdt-empty-state-icon">{'\u2190'}</div>
            <div>Select a component to view details</div>
            <div style={{ fontSize: '12px', color: 'var(--sdt-text-tertiary)', marginTop: '8px' }}>
              Green = mounted on this route. Gray = not rendered here.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// END_PLATFORM
