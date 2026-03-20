"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { getBaseUrl } from "../lib/stack-app/apps/implementations/common";
import { stackAppInternalsSymbol, type StackClientApp } from "../lib/stack-app";

// IF_PLATFORM react-like

export type TabId = 'overview' | 'components' | 'docs' | 'dashboard' | 'console' | 'support';

export type RegisteredComponent = {
  name: string;
  instanceId: string;
  props: Record<string, unknown>;
  mountedAt: number;
};

export type ApiLogEntry = {
  id: string;
  timestamp: number;
  method: string;
  url: string;
  status?: number;
  duration?: number;
  error?: string;
};

export type EventLogEntry = {
  id: string;
  timestamp: number;
  type: 'sign-in' | 'sign-out' | 'sign-up' | 'token-refresh' | 'error' | 'info';
  message: string;
};

export type ConsoleSubTab = 'console' | 'events' | 'info';

export type DevToolState = {
  isOpen: boolean;
  activeTab: TabId;
  consoleSubTab: ConsoleSubTab;
  panelWidth: number;
  panelHeight: number;
};

const STORAGE_KEY = '__stack-dev-tool-state';
const MAX_LOG_ENTRIES = 500;

const DEFAULT_STATE: DevToolState = {
  isOpen: false,
  activeTab: 'overview',
  consoleSubTab: 'console',
  panelWidth: 800,
  panelHeight: 520,
};

function loadState(): DevToolState {
  try {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        return { ...DEFAULT_STATE, ...parsed };
      }
    }
  } catch {
    // ignore
  }
  return DEFAULT_STATE;
}

function saveState(state: DevToolState) {
  try {
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Global log store — survives React remounts / navigations (SPA)
// ---------------------------------------------------------------------------
type LogListener = () => void;

const globalLogStore = {
  apiLogs: [] as ApiLogEntry[],
  eventLogs: [] as EventLogEntry[],
  listeners: new Set<LogListener>(),

  addApiLog(entry: ApiLogEntry) {
    this.apiLogs = [entry, ...this.apiLogs].slice(0, MAX_LOG_ENTRIES);
    this.notify();
  },

  addEventLog(entry: EventLogEntry) {
    this.eventLogs = [entry, ...this.eventLogs].slice(0, MAX_LOG_ENTRIES);
    this.notify();
  },

  clear() {
    this.apiLogs = [];
    this.eventLogs = [];
    this.notify();
  },

  subscribe(listener: LogListener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  },

  notify() {
    for (const listener of this.listeners) {
      listener();
    }
  },
};

// Expose globally so the fetch interceptor (which may be installed once) can
// always reach the latest store even after HMR / remounts.
if (typeof globalThis !== 'undefined') {
  (globalThis as any).__STACK_DEV_TOOL_LOG_STORE__ = globalLogStore;
}

/**
 * React hook that subscribes to the global log store and returns the current
 * snapshot plus mutation helpers. The snapshot reference only changes when the
 * store is actually mutated, so downstream memoisation works correctly.
 */
function useGlobalLogStore() {
  const [, forceRender] = useState(0);

  useEffect(() => {
    return globalLogStore.subscribe(() => forceRender((n) => n + 1));
  }, []);

  const addApiLog = useCallback((entry: ApiLogEntry) => globalLogStore.addApiLog(entry), []);
  const addEventLog = useCallback((entry: EventLogEntry) => globalLogStore.addEventLog(entry), []);
  const clearLogs = useCallback(() => globalLogStore.clear(), []);

  return {
    apiLogs: globalLogStore.apiLogs,
    eventLogs: globalLogStore.eventLogs,
    addApiLog,
    addEventLog,
    clearLogs,
  };
}

// ---------------------------------------------------------------------------

type DevToolContextValue = {
  state: DevToolState;
  setState: React.Dispatch<React.SetStateAction<DevToolState>>;
  components: Map<string, RegisteredComponent>;
  registerComponent: (name: string, instanceId: string, props: Record<string, unknown>) => void;
  unregisterComponent: (instanceId: string) => void;
  apiLogs: ApiLogEntry[];
  addApiLog: (entry: ApiLogEntry) => void;
  eventLogs: EventLogEntry[];
  addEventLog: (entry: EventLogEntry) => void;
  clearLogs: () => void;
};

const DevToolContext = createContext<DevToolContextValue | null>(null);

export function DevToolProvider({ children }: { children: React.ReactNode }) {
  const [state, setStateRaw] = useState<DevToolState>(loadState);
  const [components, setComponents] = useState<Map<string, RegisteredComponent>>(new Map());
  const { apiLogs, addApiLog, eventLogs, addEventLog, clearLogs } = useGlobalLogStore();

  const setState: React.Dispatch<React.SetStateAction<DevToolState>> = useCallback((action) => {
    setStateRaw((prev) => {
      const next = typeof action === 'function' ? action(prev) : action;
      saveState(next);
      return next;
    });
  }, []);

  const registerComponent = useCallback((name: string, instanceId: string, props: Record<string, unknown>) => {
    setComponents((prev) => {
      const next = new Map(prev);
      next.set(instanceId, { name, instanceId, props, mountedAt: Date.now() });
      return next;
    });
  }, []);

  const unregisterComponent = useCallback((instanceId: string) => {
    setComponents((prev) => {
      const next = new Map(prev);
      next.delete(instanceId);
      return next;
    });
  }, []);

  const value = useMemo(() => ({
    state,
    setState,
    components,
    registerComponent,
    unregisterComponent,
    apiLogs,
    addApiLog,
    eventLogs,
    addEventLog,
    clearLogs,
  }), [state, setState, components, registerComponent, unregisterComponent, apiLogs, addApiLog, eventLogs, addEventLog, clearLogs]);

  return (
    <DevToolContext.Provider value={value}>
      {children}
    </DevToolContext.Provider>
  );
}

export function useDevToolContext() {
  const context = useContext(DevToolContext);
  if (!context) {
    throw new Error('useDevToolContext must be used within a DevToolProvider');
  }
  return context;
}

/**
 * Derives the dashboard base URL from the resolved Stack Auth API base URL.
 *
 * Mapping:
 *   - Production API  `https://api.stack-auth.com`  → `https://app.stack-auth.com`
 *   - Local dev API   `http://localhost:8102`        → `http://localhost:8101`  (port XX02 → XX01)
 *   - Self-hosted     `https://api.myapp.com`        → `https://app.myapp.com`
 */
export function deriveDashboardBaseUrl(apiBaseUrl: string): string {
  try {
    const url = new URL(apiBaseUrl);

    // localhost / 127.0.0.1: shift port from XX02 → XX01
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
      const port = url.port;
      if (port && port.endsWith('02')) {
        url.port = port.slice(0, -2) + '01';
      }
      return url.origin;
    }

    // Hosted: api.example.com → app.example.com
    if (url.hostname.startsWith('api.')) {
      url.hostname = 'app.' + url.hostname.slice(4);
      return url.origin;
    }

    return url.origin;
  } catch {
    return 'https://app.stack-auth.com';
  }
}

/**
 * Resolves the API base URL from a StackClientApp instance.
 */
export function resolveApiBaseUrl(app: StackClientApp<true>): string {
  const opts = app[stackAppInternalsSymbol].getConstructorOptions();
  return getBaseUrl(opts.baseUrl);
}

/**
 * Returns the full project-specific dashboard URL for the given app.
 */
export function resolveDashboardUrl(app: StackClientApp<true>): string {
  const apiUrl = resolveApiBaseUrl(app);
  const base = deriveDashboardBaseUrl(apiUrl);
  return `${base}/projects/${encodeURIComponent(app.projectId)}`;
}

/**
 * Redacts the middle of API keys for safe display in the dev tool.
 */
export function maskProjectKey(value: string | undefined): string {
  if (value == null || value === '') {
    return 'Not set';
  }
  if (value.length <= 8) {
    return '\u2022'.repeat(value.length);
  }
  return `${value.slice(0, 8)}\u2026${value.slice(-4)}`;
}

// END_PLATFORM
