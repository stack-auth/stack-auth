"use client";

import React, { useContext, useEffect, useId } from "react";

// IF_PLATFORM react-like

/** When true, component previews inside the dev tool do not duplicate registry entries. */
const DevToolComponentPreviewContext = React.createContext(false);

export function DevToolComponentPreviewProvider({ children }: { children: React.ReactNode }) {
  return (
    <DevToolComponentPreviewContext.Provider value={true}>
      {children}
    </DevToolComponentPreviewContext.Provider>
  );
}

// Global component registry that works even without DevToolProvider context
// Uses a simple pub/sub pattern so the dev tool can observe components

type ComponentEntry = {
  name: string;
  instanceId: string;
  props: Record<string, unknown>;
  mountedAt: number;
};

export type DevToolComponentCatalogEntry = {
  /** Component identifier */
  id: string;
  /** Label in the list (defaults to `id`) */
  displayName?: string;
};

type RegistryListener = (components: Map<string, ComponentEntry>) => void;

const globalRegistry = {
  components: new Map<string, ComponentEntry>(),
  /** App-defined components to always list (e.g. layout shells); keyed by `id` */
  customCatalog: new Map<string, { displayName: string }>(),
  listeners: new Set<RegistryListener>(),

  register(name: string, instanceId: string, props: Record<string, unknown>) {
    this.components.set(instanceId, { name, instanceId, props, mountedAt: Date.now() });
    this.notify();
  },

  unregister(instanceId: string) {
    this.components.delete(instanceId);
    this.notify();
  },

  subscribe(listener: RegistryListener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  },

  notify() {
    for (const listener of this.listeners) {
      listener(new Map(this.components));
    }
  },
};

/**
 * Register component names that should always appear in the dev tool Components tab.
 * Call once from a client component (e.g. root layout shell). Development only.
 */
export function registerDevToolComponentCatalog(entries: ReadonlyArray<DevToolComponentCatalogEntry>) {
  if (process.env.NODE_ENV !== "development") {
    return;
  }
  globalRegistry.customCatalog.clear();
  for (const e of entries) {
    globalRegistry.customCatalog.set(e.id, { displayName: e.displayName ?? e.id });
  }
  globalRegistry.notify();
}

// Expose globally for the dev tool panel to read
if (typeof globalThis !== 'undefined') {
  (globalThis as any).__STACK_DEV_TOOL_REGISTRY__ = globalRegistry;
}

/**
 * Wraps a component with automatic dev tool mount tracking.
 * In production, returns the original component unchanged (zero overhead).
 * In development, returns a thin wrapper that registers/unregisters
 * with the global registry on mount/unmount.
 */
export function withDevToolTracking<P extends Record<string, any>>(
  name: string,
  Component: React.ComponentType<P>,
): (props: P) => React.ReactElement | null {
  if (process.env.NODE_ENV !== 'development') {
    return Component as any;
  }

  function Tracked(props: P) {
    const instanceId = useId();
    const isPreview = useContext(DevToolComponentPreviewContext);

    useEffect(() => {
      if (isPreview) return;
      globalRegistry.register(name, instanceId, props as Record<string, unknown>);
      return () => globalRegistry.unregister(instanceId);
    }, [instanceId, isPreview, name, props]);

    // Update props on change
    useEffect(() => {
      if (isPreview) return;
      const existing = globalRegistry.components.get(instanceId);
      if (existing) {
        existing.props = props as Record<string, unknown>;
        globalRegistry.notify();
      }
    }); // runs every render to catch prop changes

    return React.createElement(Component, props);
  }

  Tracked.displayName = name;
  return Tracked;
}

export { globalRegistry };

// END_PLATFORM
