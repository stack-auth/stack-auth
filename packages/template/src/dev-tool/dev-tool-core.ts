// IF_PLATFORM js-like

import type { RequestLogEntry } from "@stackframe/stack-shared/dist/interface/client-interface";
import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";
import { isLocalhost } from "@stackframe/stack-shared/dist/utils/urls";
import { stringCompare } from "@stackframe/stack-shared/dist/utils/strings";
import type { StackClientApp } from "../lib/stack-app";
import { envVars } from "../lib/env";
import { getBaseUrl } from "../lib/stack-app/apps/implementations/common";
import type { HandlerUrlOptions, HandlerUrls, HandlerUrlTarget } from "../lib/stack-app/common";
import { stackAppInternalsSymbol } from "../lib/stack-app/common";
import { getPagePrompt } from "../lib/stack-app/url-targets";
import { devToolCSS } from "./dev-tool-styles";
import type { TriggerCorner, TriggerPlacement } from "./dev-tool-trigger-position";
import { clampTriggerPosition, getSnappedTriggerPlacement, resolveTriggerPosition } from "./dev-tool-trigger-position";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TabId = 'overview' | 'heatmaps' | 'customize' | 'ai' | 'dashboard' | 'console' | 'support';

type TabResult = { element: HTMLElement, cleanup?: () => void };

type ApiLogEntry = {
  id: string;
  timestamp: number;
  method: string;
  url: string;
  status?: number;
  duration?: number;
  error?: string;
};

type EventLogEntry = {
  id: string;
  timestamp: number;
  type: 'error' | 'info';
  message: string;
};

type DevToolState = {
  isOpen: boolean;
  activeTab: TabId;
  panelWidth: number;
  panelHeight: number;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Hexclave rebrand: UI-only local prefs — straight rename (one-time reset is harmless)
const STORAGE_KEY = '__hexclave-dev-tool-state';
const TRIGGER_POS_KEY = 'hexclave-devtool-trigger-position';
const ROOT_ID = '__hexclave-dev-tool-root';
const GLOBAL_INSTANCE_KEY = '__hexclave-dev-tool-instance';
const MAX_LOG_ENTRIES = 500;
const CONSOLE_LOG_BATCH_SIZE = 100;
const DRAG_THRESHOLD = 5;
const DOCS_URL = 'https://docs.hexclave.com';

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'overview', label: 'Overview', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>' },
  { id: 'heatmaps', label: 'Heatmaps', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 9h.01"/><path d="M15 8h.01"/><path d="M12 15h.01"/><path d="M19 11h.01"/><path d="M5 16h.01"/><path d="M3 3l18 18"/><path d="M14 14l7 7"/><path d="M5 5l5 5"/></svg>' },
  { id: 'customize', label: 'Customize', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>' },
  { id: 'ai', label: 'AI', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>' },
  { id: 'console', label: 'Console', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>' },
  { id: 'dashboard', label: 'Dashboard', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>' },
  { id: 'support', label: 'Support', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>' },
];

const DEFAULT_STATE: DevToolState = {
  isOpen: false,
  activeTab: 'overview',
  panelWidth: 800,
  panelHeight: 520,
};

// Hexclave mark — hexagon outline with three radial bars, monochrome via currentColor
// so it inherits the trigger logo's color. Sourced from apps/dashboard/public/hexclave-icon.svg
// (gradient + glow stripped; this is a tiny trigger glyph, not the full brand mark).
const HEXCLAVE_LOGO_SVG = '<svg width="16" height="16" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="miter"><path d="M 24 4 L 41.32 14 L 41.32 34 L 24 44 L 6.68 34 L 6.68 14 Z"/><path d="M 11 16.87 L 14 15.13 L 14 32.87 L 11 31.13 Z" fill="currentColor" stroke="none"/><path d="M 11 16.87 L 14 15.13 L 14 32.87 L 11 31.13 Z" fill="currentColor" stroke="none" transform="rotate(120 24 24)"/><path d="M 11 16.87 L 14 15.13 L 14 32.87 L 11 31.13 Z" fill="currentColor" stroke="none" transform="rotate(240 24 24)"/></svg>';

// ---------------------------------------------------------------------------
// State management
// ---------------------------------------------------------------------------

function loadState(): DevToolState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Migrate old 'components' tab name to 'customize'
      if (parsed.activeTab === 'components') parsed.activeTab = 'customize';
      if (parsed.activeTab === 'docs') parsed.activeTab = 'overview';
      return { ...DEFAULT_STATE, ...parsed, isOpen: false };
    }
  } catch {}
  return { ...DEFAULT_STATE };
}

function saveState(state: DevToolState) {
  try {
    // Keep layout preferences across pages, but do not reopen the panel automatically on remount.
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, isOpen: false }));
  } catch {}
}

function createStateStore() {
  let state = loadState();
  const listeners = new Set<() => void>();

  return {
    get: () => state,
    update(partial: Partial<DevToolState>) {
      state = { ...state, ...partial };
      saveState(state);
      listeners.forEach((fn) => fn());
    },
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Global log store (survives remounts, shared across instances)
// ---------------------------------------------------------------------------

type LogStore = {
  apiLogs: ApiLogEntry[];
  eventLogs: EventLogEntry[];
  listeners: Set<() => void>;
  addApiLog(entry: ApiLogEntry): void;
  addEventLog(entry: EventLogEntry): void;
  clear(): void;
  subscribe(fn: () => void): () => void;
};

type DevToolGlobalInstance = {
  cleanup: () => void;
};

function isDevToolGlobalInstance(value: unknown): value is DevToolGlobalInstance {
  return typeof value === 'object' && value !== null && typeof Reflect.get(value, 'cleanup') === 'function';
}

function getGlobalDevToolInstance(): DevToolGlobalInstance | null {
  if (typeof window === 'undefined') return null;
  const value: unknown = Reflect.get(window, GLOBAL_INSTANCE_KEY);
  return isDevToolGlobalInstance(value) ? value : null;
}

function setGlobalDevToolInstance(instance: DevToolGlobalInstance | null) {
  if (typeof window === 'undefined') return;
  if (instance === null) {
    Reflect.deleteProperty(window, GLOBAL_INSTANCE_KEY);
  } else {
    Reflect.set(window, GLOBAL_INSTANCE_KEY, instance);
  }
}

function getGlobalLogStore(): LogStore {
  const g = globalThis as any;
  if (!g.__STACK_DEV_TOOL_LOG_STORE__) {
    g.__STACK_DEV_TOOL_LOG_STORE__ = {
      apiLogs: [] as ApiLogEntry[],
      eventLogs: [] as EventLogEntry[],
      listeners: new Set<() => void>(),
      addApiLog(entry: ApiLogEntry) {
        this.apiLogs = [entry, ...this.apiLogs].slice(0, MAX_LOG_ENTRIES);
        this.listeners.forEach((fn: () => void) => fn());
      },
      addEventLog(entry: EventLogEntry) {
        this.eventLogs = [entry, ...this.eventLogs].slice(0, MAX_LOG_ENTRIES);
        this.listeners.forEach((fn: () => void) => fn());
      },
      clear() {
        this.apiLogs = [];
        this.eventLogs = [];
        this.listeners.forEach((fn: () => void) => fn());
      },
      subscribe(fn: () => void) {
        this.listeners.add(fn);
        return () => {
          this.listeners.delete(fn);
        };
      },
    };
  }
  return g.__STACK_DEV_TOOL_LOG_STORE__;
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

let _idCounter = 0;
function nextId() {
  return `sdt-${++_idCounter}-${Date.now()}`;
}

function resolveApiBaseUrl(app: StackClientApp<true>): string {
  const opts = app[stackAppInternalsSymbol].getConstructorOptions();
  return getBaseUrl(opts.baseUrl);
}

function shouldShowDashboardTab(app: StackClientApp<true>): boolean {
  return envVars.NEXT_PUBLIC_STACK_IS_LOCAL_EMULATOR === "true" && isLocalhost(resolveApiBaseUrl(app));
}

function getTabsForApp(app: StackClientApp<true>): { id: TabId; label: string; icon: string }[] {
  if (shouldShowDashboardTab(app)) {
    return TABS;
  }
  return TABS.filter((tab) => tab.id !== 'dashboard');
}

function deriveDashboardBaseUrl(apiBaseUrl: string): string {
  try {
    const url = new URL(apiBaseUrl);
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]') {
      const port = url.port;
      if (port && port.endsWith('02')) {
        url.port = port.slice(0, -2) + '01';
      }
      return url.origin;
    }
    if (url.hostname.startsWith('api.')) {
      url.hostname = 'app.' + url.hostname.slice(4);
      return url.origin;
    }
    return url.origin;
  } catch {
    return 'https://app.hexclave.com';
  }
}

function resolveDashboardUrl(app: StackClientApp<true>): string {
  const base = deriveDashboardBaseUrl(resolveApiBaseUrl(app));
  return `${base}/projects/${encodeURIComponent(app.projectId)}`;
}

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
  } as any);
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function generateRandomEmail(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 8; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return `dev-${id}@test.hexclave.com`;
}

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Record<string, any> | null,
  ...children: (string | Node | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null) continue;
      if (k === 'className') {
        el.className = v;
      } else if (k === 'style' && typeof v === 'object') {
        Object.assign(el.style, v);
      } else if (k.startsWith('on') && typeof v === 'function') {
        el.addEventListener(k.slice(2).toLowerCase(), v);
      } else {
        el.setAttribute(k, String(v));
      }
    }
  }
  for (const child of children) {
    if (child == null) continue;
    el.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return el;
}

function setHtml(el: HTMLElement, html: string) {
  el.innerHTML = html;
}

function hasAppendChild(value: unknown): value is { appendChild(node: Node): void } {
  return typeof value === 'object' && value !== null && typeof Reflect.get(value, 'appendChild') === 'function';
}

function parseMarkdownImage(line: string): { alt: string, src: string } | null {
  const match = line.trim().match(/^!\[([^\]]*)\]\((.+)\)$/);
  if (!match) return null;

  const [, alt, src] = match;
  const normalizedSrc = src.trim();
  if (normalizedSrc === '') return null;

  return {
    alt: alt.trim(),
    src: normalizedSrc,
  };
}

function appendInlineMarkdown(container: HTMLElement, text: string) {
  const tokenPattern = /(\[[^\]]+\]\([^)]+\)|`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenPattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      container.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
    }

    const token = match[0];
    if (token.startsWith("`")) {
      container.appendChild(h("code", { className: "sdt-ai-inline-code" }, token.slice(1, -1)));
    } else if (token.startsWith("**") || token.startsWith("__")) {
      const bold = h("strong", { className: "sdt-ai-bold" });
      appendInlineMarkdown(bold, token.slice(2, -2));
      container.appendChild(bold);
    } else if (token.startsWith("*") || token.startsWith("_")) {
      const italic = h("em");
      appendInlineMarkdown(italic, token.slice(1, -1));
      container.appendChild(italic);
    } else {
      const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (linkMatch) {
        const [, linkText, href] = linkMatch;
        const trimmedHref = href.trim();
        if (/^(https?:\/\/|mailto:)/i.test(trimmedHref)) {
          const link = h("a", {
            className: "sdt-ai-link",
            href: trimmedHref,
            target: "_blank",
            rel: "noopener noreferrer",
          });
          appendInlineMarkdown(link, linkText);
          container.appendChild(link);
        } else {
          container.appendChild(document.createTextNode(token));
        }
      } else {
        container.appendChild(document.createTextNode(token));
      }
    }

    lastIndex = tokenPattern.lastIndex;
  }

  if (lastIndex < text.length) {
    container.appendChild(document.createTextNode(text.slice(lastIndex)));
  }
}

// ---------------------------------------------------------------------------
// Trigger button (draggable pill — corner-snapping, icon only)
// ---------------------------------------------------------------------------

function createTrigger(onClick: () => void): { element: HTMLElement; cleanup: () => void } {
  type Position = { left: number; top: number };
  type Placement = TriggerPlacement;

  // Measured lazily after the element is appended to the DOM.
  let triggerSize = { width: 36, height: 36 };

  function isPosition(value: unknown): value is Position {
    if (typeof value !== 'object' || value === null) return false;
    return typeof Reflect.get(value, 'left') === 'number' && typeof Reflect.get(value, 'top') === 'number';
  }

  function isPlacement(value: unknown): value is Placement {
    if (typeof value !== 'object' || value === null) return false;
    const corner = Reflect.get(value, 'corner');
    return ['top-left', 'top-right', 'bottom-left', 'bottom-right'].includes(String(corner));
  }

  function loadPlacement(): Placement | null {
    try {
      const raw = localStorage.getItem(TRIGGER_POS_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);

      if (isPlacement(parsed)) return parsed;

      // Migrate old side-based placement { side, offset } to nearest corner.
      if (typeof parsed === 'object' && parsed !== null && 'side' in parsed && 'offset' in parsed) {
        const side = String(Reflect.get(parsed, 'side'));
        const offset = Number(Reflect.get(parsed, 'offset'));
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        let corner: TriggerCorner;
        if (side === 'right')  corner = offset < vh / 2 ? 'top-right'   : 'bottom-right';
        else if (side === 'left')   corner = offset < vh / 2 ? 'top-left'    : 'bottom-left';
        else if (side === 'top')    corner = offset < vw / 2 ? 'top-left'    : 'top-right';
        else                        corner = offset < vw / 2 ? 'bottom-left' : 'bottom-right';
        return { corner };
      }

      // Migrate old absolute position.
      if (isPosition(parsed)) {
        return getSnappedTriggerPlacement(parsed, triggerSize, { width: window.innerWidth, height: window.innerHeight });
      }
    } catch {}
    return null;
  }

  function savePlacement(placement: Placement) {
    try {
      localStorage.setItem(TRIGGER_POS_KEY, JSON.stringify(placement));
    } catch {}
  }

  let animationTimeout: number | null = null;

  function setPositionAnimation(isAnimated: boolean) {
    if (animationTimeout !== null) {
      window.clearTimeout(animationTimeout);
      animationTimeout = null;
    }
    btn.classList.toggle('sdt-trigger-position-animated', isAnimated);
    if (isAnimated) {
      animationTimeout = window.setTimeout(() => {
        animationTimeout = null;
        btn.classList.remove('sdt-trigger-position-animated');
      }, 180);
    }
  }

  function applyPos(nextPos: Position, options?: { animate?: boolean }) {
    setPositionAnimation(options?.animate === true);
    pos = nextPos;
    btn.style.left = pos.left + 'px';
    btn.style.top = pos.top + 'px';
  }

  const btn = h('button', {
    className: 'sdt-trigger',
    'aria-label': 'Toggle Hexclave Dev Tools',
    'data-hexclave-devtool-trigger': 'true',
    title: 'Hexclave Dev Tools',
  });
  const logoSpan = h('span', { className: 'sdt-trigger-logo' });
  setHtml(logoSpan, HEXCLAVE_LOGO_SVG);
  btn.appendChild(logoSpan);

  let placement = loadPlacement() ?? { corner: 'bottom-right' as TriggerCorner };
  let pos = resolveTriggerPosition(placement, triggerSize, { width: window.innerWidth, height: window.innerHeight });
  applyPos(pos);

  let dragState: { startX: number; startY: number; startLeft: number; startTop: number; didDrag: boolean } | null = null;

  // After mount, measure the actual rendered size and re-snap if needed.
  requestAnimationFrame(() => {
    const rect = btn.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      triggerSize = { width: rect.width, height: rect.height };
      const measured = resolveTriggerPosition(placement, triggerSize, { width: window.innerWidth, height: window.innerHeight });
      if (measured.left !== pos.left || measured.top !== pos.top) {
        applyPos(measured, { animate: true });
      }
    }
  });

  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    setPositionAnimation(false);
    btn.setPointerCapture(e.pointerId);
    dragState = { startX: e.clientX, startY: e.clientY, startLeft: pos.left, startTop: pos.top, didDrag: false };
  });

  btn.addEventListener('pointermove', (e) => {
    if (!dragState) return;
    const dx = e.clientX - dragState.startX;
    const dy = e.clientY - dragState.startY;
    if (!dragState.didDrag && Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return;
    dragState.didDrag = true;
    applyPos(clampTriggerPosition(
      { left: dragState.startLeft + dx, top: dragState.startTop + dy },
      triggerSize,
      { width: window.innerWidth, height: window.innerHeight },
    ));
  });

  btn.addEventListener('pointerup', (e) => {
    const ds = dragState;
    dragState = null;
    if (!ds) return;
    btn.releasePointerCapture(e.pointerId);
    if (ds.didDrag) {
      placement = getSnappedTriggerPlacement(pos, triggerSize, { width: window.innerWidth, height: window.innerHeight });
      applyPos(resolveTriggerPosition(placement, triggerSize, { width: window.innerWidth, height: window.innerHeight }), { animate: true });
      savePlacement(placement);
    } else {
      onClick();
    }
  });

  // On viewport resize, reapply the existing corner placement to the new dimensions.
  // Placement (corner) only changes when the user drags.
  function onResize() {
    const resizedPos = resolveTriggerPosition(placement, triggerSize, { width: window.innerWidth, height: window.innerHeight });
    if (resizedPos.left !== pos.left || resizedPos.top !== pos.top) {
      applyPos(resizedPos, { animate: true });
    }
  }

  window.addEventListener('resize', onResize);

  return {
    element: btn,
    cleanup: () => {
      if (animationTimeout !== null) {
        window.clearTimeout(animationTimeout);
      }
      window.removeEventListener('resize', onResize);
    },
  };
}

// ---------------------------------------------------------------------------
// Tab bar with sliding indicator
// ---------------------------------------------------------------------------

function createTabBar(
  tabs: { id: string; label: string; icon?: string }[],
  activeTab: string,
  onTabChange: (id: string) => void,
  opts?: { variant?: 'bar' | 'pills'; trailing?: HTMLElement },
): { el: HTMLElement; setActive: (id: string) => void } {
  const variant = opts?.variant ?? 'bar';
  const barClass = variant === 'pills' ? 'sdt-console-tabs' : 'sdt-tabbar';
  const tabClass = variant === 'pills' ? 'sdt-console-tab' : 'sdt-tab';
  const indicatorClass = variant === 'pills' ? 'sdt-console-tab-indicator' : 'sdt-tab-indicator';

  const bar = h('div', { className: barClass });
  const indicator = h('div', { className: indicatorClass });
  indicator.style.opacity = '0';
  bar.appendChild(indicator);

  let current = activeTab;
  let isInitial = true;

  const buttons = tabs.map((tab) => {
    const btn = h('button', {
      className: tabClass,
      'data-tab-id': tab.id,
      'data-active': String(tab.id === activeTab),
    });
    if (tab.icon) {
      const iconSpan = h('span', { className: 'sdt-tab-icon' });
      setHtml(iconSpan, tab.icon);
      btn.appendChild(iconSpan);
    }
    btn.appendChild(document.createTextNode(tab.label));
    btn.addEventListener('click', () => onTabChange(tab.id));
    bar.appendChild(btn);
    return btn;
  });

  if (variant === 'bar') {
    bar.appendChild(h('div', { className: 'sdt-tabbar-spacer' }));
  }
  if (opts?.trailing) {
    bar.appendChild(opts.trailing);
  }

  function measure() {
    const btn = bar.querySelector<HTMLElement>(`[data-tab-id="${current}"]`);
    if (!btn) return;
    indicator.style.transform = `translateX(${btn.offsetLeft}px)`;
    indicator.style.width = btn.offsetWidth + 'px';
    indicator.style.height = btn.offsetHeight + 'px';
    indicator.style.opacity = '1';
    indicator.style.transition = isInitial ? 'none' : '';
    isInitial = false;
  }

  const ro = new ResizeObserver(measure);
  ro.observe(bar);
  requestAnimationFrame(measure);

  function setActive(id: string) {
    current = id;
    buttons.forEach((btn) => {
      const tabId = btn.getAttribute('data-tab-id');
      btn.setAttribute('data-active', String(tabId === id));
    });
    measure();
  }

  return { el: bar, setActive };
}

// ---------------------------------------------------------------------------
// Iframe helper
// ---------------------------------------------------------------------------

function createIframeTab(src: string, title: string, loadingMsg = 'Loading\u2026', errorMsg = 'Unable to load content', errorDetail?: string, openExternallyLabel?: string): HTMLElement {
  const container = h('div', { className: 'sdt-iframe-container' });
  if (openExternallyLabel != null) {
    container.appendChild(h('div', { className: 'sdt-iframe-toolbar' },
      h('a', { href: src, target: '_blank', rel: 'noopener noreferrer', className: 'sdt-iframe-open-link' }, openExternallyLabel),
    ));
  }
  const loadingEl = h('div', { className: 'sdt-iframe-loading' }, loadingMsg);
  container.appendChild(loadingEl);

  const iframe = document.createElement('iframe');
  iframe.src = src;
  iframe.title = title;
  iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-forms');
  iframe.style.display = 'none';

  iframe.addEventListener('load', () => {
    loadingEl.style.display = 'none';
    iframe.style.display = 'block';
  });

  iframe.addEventListener('error', () => {
    loadingEl.style.display = 'none';
    container.innerHTML = '';
    const errDiv = h('div', { className: 'sdt-iframe-error' });
    errDiv.appendChild(h('div', null, errorMsg));
    if (errorDetail) {
      errDiv.appendChild(h('div', { style: { fontSize: '12px', color: 'var(--sdt-text-tertiary)' } }, errorDetail));
    }
    const retryBtn = h('button', { className: 'sdt-iframe-error-btn' }, 'Retry');
    retryBtn.addEventListener('click', () => {
      container.replaceWith(createIframeTab(src, title, loadingMsg, errorMsg, errorDetail, openExternallyLabel));
    });
    errDiv.appendChild(retryBtn);
    const link = h('a', { href: src, target: '_blank', rel: 'noopener noreferrer', style: { color: 'var(--sdt-accent)', fontSize: '12px', textDecoration: 'none' } }, 'Open in new tab');
    errDiv.appendChild(link);
    container.appendChild(errDiv);
  });

  container.appendChild(iframe);
  return container;
}

// ===========================================================================================
// TABS
// ===========================================================================================

// ---------------------------------------------------------------------------
// Overview tab
// ---------------------------------------------------------------------------

function hasPersistentTokenStoreForDevTool(app: StackClientApp<boolean>): boolean {
  return app[stackAppInternalsSymbol].getConstructorOptions().tokenStore !== null;
}

function createOverviewTab(app: StackClientApp<true>): TabResult {
  const container = h('div', { className: 'sdt-ov' });
  const hasPersistentTokenStore = hasPersistentTokenStoreForDevTool(app);

  // ── Identity card ──────────────────────────────────────────────────────────
  const heroCard = h('div', { className: 'sdt-ov-card sdt-ov-card-hero' });
  heroCard.appendChild(h('div', { className: 'sdt-ov-label' }, 'Identity'));

  const userRow = h('div', { className: 'sdt-ov-user-row' });
  const avatar = h('div', { className: 'sdt-ov-avatar' }, '?');
  const userMeta = h('div', { className: 'sdt-ov-user-meta' });
  const userName = h('div', { className: 'sdt-ov-user-name' }, 'Loading\u2026');
  const userEmail = h('div', { className: 'sdt-ov-user-email' }, '');
  const authIndicator = h('div', { className: 'sdt-ov-auth-indicator', style: { display: 'none' } }, 'Authenticated');
  userMeta.append(userName, userEmail, authIndicator);
  userRow.append(avatar, userMeta);
  heroCard.appendChild(userRow);

  const actions = h('div', { className: 'sdt-ov-actions' });
  const toast = h('div', { className: 'sdt-ov-toast', style: { display: 'none' } });
  const emailRow = h('div', { className: 'sdt-ov-email-input' });
  const emailInput = h('input', { type: 'email', placeholder: 'Sign in as email\u2026' }) as HTMLInputElement;
  const emailBtn = h('button', null);
  setHtml(emailBtn, '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>');
  emailRow.append(emailInput, emailBtn);

  function isBestEffortOverviewError(error: unknown) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return true;
    }
    if (error instanceof TypeError) {
      return true;
    }
    if (error instanceof Error) {
      return error.message.includes('Failed to fetch')
        || error.message.includes('NetworkError')
        || error.message.includes('Load failed')
        || error.message.includes('network connection');
    }
    return false;
  }

  function showToast(msg: string, type: 'success' | 'error') {
    toast.textContent = msg;
    toast.className = `sdt-ov-toast sdt-ov-toast-${type}`;
    toast.style.display = '';
    setTimeout(() => {
      toast.style.display = 'none';
    }, 4000);
  }

  let currentUser: any = null;
  let loading = false;

  function rebuildActions() {
    actions.innerHTML = '';
    if (!hasPersistentTokenStore) {
      userName.textContent = 'Current user unavailable';
      userEmail.textContent = 'This app was initialized without a token store';
      actions.appendChild(h('button', { className: 'sdt-ov-btn sdt-ov-btn-wide', disabled: 'true' }, 'Session actions unavailable'));
      return;
    }
    if (currentUser) {
      const signOutBtn = h('button', { className: 'sdt-ov-btn sdt-ov-btn-danger' }, 'Sign Out');
      signOutBtn.disabled = loading;
      signOutBtn.addEventListener('click', () => {
        runAsynchronously(async () => {
          loading = true;
          rebuildActions();
          try {
            await currentUser.signOut();
            showToast('Signed out', 'success');
          } catch (e: any) {
            showToast(e.message || 'Sign out failed', 'error');
          }
          loading = false;
          await refreshUser();
        });
      });
      const randomBtn = h('button', { className: 'sdt-ov-btn sdt-ov-btn-primary' }, 'Random User');
      randomBtn.disabled = loading;
      randomBtn.addEventListener('click', () => {
        runAsynchronously(doQuickSignIn());
      });
      actions.append(signOutBtn, randomBtn);
    } else {
      const quickBtn = h('button', { className: 'sdt-ov-btn sdt-ov-btn-primary sdt-ov-btn-wide' }, loading ? 'Working\u2026' : 'Quick Sign In');
      quickBtn.disabled = loading;
      quickBtn.addEventListener('click', () => {
        runAsynchronously(doQuickSignIn());
      });
      actions.appendChild(quickBtn);
    }
    emailInput.placeholder = currentUser ? 'Switch to email\u2026' : 'Sign in as email\u2026';
    actions.appendChild(emailRow);
  }

  async function doQuickSignIn() {
    if (!isLocalhost(window.location.href)) {
      showToast('Quick sign-in is only available on localhost', 'error');
      return;
    }
    loading = true;
    rebuildActions();
    const email = generateRandomEmail();
    try {
      const signUpResult = await app.signUpWithCredential({ email, password: email, noRedirect: true } as any);
      if (signUpResult.status === 'error') {
        showToast(`Sign up failed: ${signUpResult.error.message}`, 'error');
        loading = false;
        rebuildActions();
        return;
      }
      const signInResult = await app.signInWithCredential({ email, password: email, noRedirect: true });
      if (signInResult.status === 'error') {
        showToast(`Sign in failed: ${signInResult.error.message}`, 'error');
      } else {
        showToast(`Signed in as ${email}`, 'success');
      }
    } catch (e: any) {
      showToast(e.message || 'Unknown error', 'error');
    }
    loading = false;
    await refreshUser();
  }

  async function doSignInAs(targetEmail: string) {
    if (!targetEmail.trim()) return;
    if (!isLocalhost(window.location.href)) {
      showToast('Quick sign-in is only available on localhost', 'error');
      return;
    }
    loading = true;
    rebuildActions();
    const trimmed = targetEmail.trim();
    try {
      const signInResult = await app.signInWithCredential({ email: trimmed, password: trimmed, noRedirect: true });
      if (signInResult.status === 'ok') {
        showToast(`Signed in as ${trimmed}`, 'success');
        emailInput.value = '';
        loading = false;
        await refreshUser();
        return;
      }
      const signUpResult = await app.signUpWithCredential({ email: trimmed, password: trimmed, noRedirect: true } as any);
      if (signUpResult.status === 'error') {
        showToast(`Failed: ${signUpResult.error.message}`, 'error');
        loading = false;
        rebuildActions();
        return;
      }
      const retryResult = await app.signInWithCredential({ email: trimmed, password: trimmed, noRedirect: true });
      if (retryResult.status === 'error') {
        showToast(`Sign in failed: ${retryResult.error.message}`, 'error');
      } else {
        showToast(`Signed in as ${trimmed}`, 'success');
        emailInput.value = '';
      }
    } catch (e: any) {
      showToast(e.message || 'Unknown error', 'error');
    }
    loading = false;
    await refreshUser();
  }

  emailBtn.addEventListener('click', () => {
    runAsynchronously(doSignInAs(emailInput.value));
  });
  emailInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      runAsynchronously(doSignInAs(emailInput.value));
    }
  });

  heroCard.append(actions, toast);

  // ── Auth methods card ──────────────────────────────────────────────────────
  const methodsCard = h('div', { className: 'sdt-ov-card sdt-ov-card-auth' });
  methodsCard.appendChild(h('div', { className: 'sdt-ov-label' }, 'Auth Methods'));
  const authGrid = h('div', { className: 'sdt-ov-auth-grid' });
  for (let i = 0; i < 3; i++) {
    authGrid.appendChild(h('div', { className: 'sdt-ov-method sdt-ov-skeleton-pill' }));
  }
  methodsCard.appendChild(authGrid);
  let hasActiveAuthMethod: boolean | null = null;

  async function loadAuthMethods() {
    try {
      const project = await app.getProject();
      authGrid.innerHTML = '';
      const config = project.config;
      hasActiveAuthMethod = config.credentialEnabled
        || config.magicLinkEnabled
        || config.passkeyEnabled
        || config.oauthProviders.length > 0;
      const methods = [
        { label: 'Password', enabled: config.credentialEnabled },
        { label: 'Magic Link', enabled: config.magicLinkEnabled },
        { label: 'Passkey', enabled: config.passkeyEnabled },
      ];
      for (const m of methods) {
        const pill = h('div', { className: `sdt-ov-method ${m.enabled ? 'sdt-ov-method-on' : 'sdt-ov-method-off'}` });
        pill.appendChild(h('span', { className: 'sdt-ov-method-name' }, m.label));
        authGrid.appendChild(pill);
      }
      for (const p of config.oauthProviders) {
        const pill = h('div', { className: 'sdt-ov-method sdt-ov-method-on sdt-ov-method-oauth' });
        pill.appendChild(h('span', { className: 'sdt-ov-method-name' }, p.id));
        authGrid.appendChild(pill);
      }
      if (!config.signUpEnabled) {
        const pill = h('div', { className: 'sdt-ov-method sdt-ov-method-warn' });
        pill.appendChild(h('span', { className: 'sdt-ov-method-name' }, 'Sign-up off'));
        authGrid.appendChild(pill);
      }
      buildChecklist();
    } catch (error) {
      authGrid.innerHTML = '<div style="font-size:11px;color:var(--sdt-text-tertiary)">Could not load auth methods</div>';
      hasActiveAuthMethod = null;
      buildChecklist();
      if (!isBestEffortOverviewError(error)) {
        throw error;
      }
    }
  }

  // Overview hydration is best-effort while the local Stack backend is still booting.
  runAsynchronously(loadAuthMethods());

  // ── Setup checklist (only shown when something is incomplete) ──────────────
  const checksCard = h('div', { className: 'sdt-ov-card sdt-ov-card-checks' });
  const projectId = app.projectId;
  let checksCardMounted = false;

  function buildChecklist() {
    checksCard.innerHTML = '';
    const currentUserCheck = hasPersistentTokenStore
      ? { ok: !!currentUser, label: 'Sign in a test user', hint: 'Use \u201cQuick Sign In\u201d above \u2192' }
      : { ok: true, label: 'Current-user tools unavailable', hint: null };
    const checks = [
      { ok: !!projectId && projectId !== 'default', label: 'Project configured', hint: null },
      { ok: hasActiveAuthMethod === true, label: 'Auth method active', hint: hasActiveAuthMethod === null ? 'Still checking project config' : null },
      currentUserCheck,
    ];
    const passCount = checks.filter((c) => c.ok).length;
    const allGood = passCount === checks.length;

    if (allGood) {
      if (checksCardMounted && checksCard.parentElement) {
        container.removeChild(checksCard);
        checksCardMounted = false;
      }
      return;
    }

    if (!checksCardMounted) {
      container.appendChild(checksCard);
      checksCardMounted = true;
    }

    const titleRow = h('div', { className: 'sdt-ov-checks-header' });
    const titleLabel = h('div', { className: 'sdt-ov-label', style: { marginBottom: '0', color: 'var(--sdt-warning)' } }, 'Setup');
    const badge = h('span', { className: 'sdt-ov-checks-badge sdt-ov-checks-badge-warn' }, `${passCount}\u200a/\u200a${checks.length}`);
    titleRow.append(titleLabel, badge);
    checksCard.appendChild(titleRow);

    const bar = h('div', { className: 'sdt-ov-checks-bar' });
    const fill = h('div', { className: 'sdt-ov-checks-bar-fill' });
    fill.style.width = `${(passCount / checks.length) * 100}%`;
    bar.appendChild(fill);
    checksCard.appendChild(bar);

    for (const c of checks) {
      const row = h('div', { className: 'sdt-ov-setup-row' });
      row.appendChild(h('span', { className: `sdt-ov-setup-dot ${c.ok ? 'sdt-ov-setup-dot-ok' : 'sdt-ov-setup-dot-warn'}` }));
      row.appendChild(h('span', { className: 'sdt-ov-setup-label' }, c.label));
      if (!c.ok && c.hint) {
        row.appendChild(h('span', { className: 'sdt-ov-setup-hint' }, c.hint));
      }
      checksCard.appendChild(row);
    }
  }

  async function refreshUser() {
    if (!hasPersistentTokenStore) {
      avatar.className = 'sdt-ov-avatar';
      avatar.textContent = '?';
      userName.textContent = 'Current user unavailable';
      userEmail.textContent = 'This app was initialized without a token store';
      authIndicator.style.display = 'none';
      currentUser = null;
      rebuildActions();
      buildChecklist();
      return;
    }
    try {
      currentUser = await app.getUser();

      if (currentUser) {
        const initials = (currentUser.displayName || currentUser.primaryEmail || '?')
          .split(' ').map((s: string) => s[0]).join('').slice(0, 2).toUpperCase();
        avatar.className = 'sdt-ov-avatar sdt-ov-avatar-active';
        if (currentUser.profileImageUrl) {
          avatar.innerHTML = `<img src="${escapeHtml(currentUser.profileImageUrl)}" alt="" />`;
        } else {
          avatar.textContent = initials;
        }
        userName.textContent = currentUser.displayName || 'Anonymous';
        userEmail.textContent = currentUser.primaryEmail || 'No email';
        authIndicator.style.display = '';
      } else {
        avatar.className = 'sdt-ov-avatar';
        avatar.textContent = '?';
        userName.textContent = 'No user signed in';
        userEmail.textContent = 'Sign in to test auth flows';
        authIndicator.style.display = 'none';
      }
    } catch (error) {
      avatar.className = 'sdt-ov-avatar';
      avatar.textContent = '?';
      userName.textContent = 'Could not load user';
      userEmail.textContent = 'Check your local Stack backend';
      authIndicator.style.display = 'none';
      currentUser = null;
      if (!isBestEffortOverviewError(error)) {
        throw error;
      }
    }
    rebuildActions();
    buildChecklist();
  }

  container.append(heroCard, methodsCard);
  buildChecklist();
  runAsynchronously(refreshUser());
  const userPoll = setInterval(() => {
    runAsynchronously(refreshUser());
  }, 3000);

  return { element: container, cleanup: () => clearInterval(userPoll) };
}

// ---------------------------------------------------------------------------
// Console tab
// ---------------------------------------------------------------------------

type MergedLogEntry =
  | { kind: 'api', entry: ApiLogEntry }
  | { kind: 'event', entry: EventLogEntry };

function createConsoleTab(logStore: LogStore): TabResult {
  const container = h('div', { className: 'sdt-console-panel' });

  const EVENT_TYPE_STYLES: Record<string, string> = {
    'error': 'sdt-badge-error',
    'info': 'sdt-badge-info',
  };

  const title = h('div', { className: 'sdt-console-title' }, 'Logs');
  const actions = h('div', { className: 'sdt-console-actions' });
  const copyBtn = h('button', { className: 'sdt-console-action-btn', title: 'Copy logs' });
  setHtml(copyBtn, '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Copy');
  const exportBtn = h('button', { className: 'sdt-console-action-btn', title: 'Export logs' });
  setHtml(exportBtn, '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Export');
  const clearBtn = h('button', { className: 'sdt-console-action-btn', title: 'Clear logs' });
  setHtml(clearBtn, '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>Clear');
  actions.append(copyBtn, exportBtn, clearBtn);
  container.appendChild(h('div', { className: 'sdt-console-header' }, title, actions));

  const contentArea = h('div', { className: 'sdt-console-log-scroll sdt-tab-content-fade' });
  container.appendChild(contentArea);

  let visibleLogCount = CONSOLE_LOG_BATCH_SIZE;

  function getMergedLogs(): MergedLogEntry[] {
    return [
      ...logStore.apiLogs.map((entry) => ({ kind: 'api' as const, entry })),
      ...logStore.eventLogs.map((entry) => ({ kind: 'event' as const, entry })),
    ].sort((a, b) => b.entry.timestamp - a.entry.timestamp);
  }

  function formatLogLine(item: MergedLogEntry): string {
    if (item.kind === 'api') {
      const log = item.entry;
      const status = log.status !== undefined ? ` [${log.status}]` : '';
      const duration = log.duration !== undefined ? ` ${log.duration}ms` : '';
      const error = log.error !== undefined ? ` ${log.error}` : '';
      return `${new Date(log.timestamp).toISOString()} ${log.method} ${log.url}${status}${duration}${error}`;
    }

    const log = item.entry;
    return `${new Date(log.timestamp).toISOString()} ${log.type.toUpperCase()} ${log.message}`;
  }

  function formatLogsForExport(): string {
    const lines = [
      '=== Hexclave Dev Tool Logs ===',
      `Generated: ${new Date().toISOString()}`,
      `Total logs: ${getMergedLogs().length}`,
      '',
      ...getMergedLogs().map(formatLogLine),
    ];
    return lines.join('\n');
  }

  function renderLogItem(item: MergedLogEntry): HTMLElement {
    if (item.kind === 'api') {
      const log = item.entry;
      const row = h('div', { className: 'sdt-log-item' });
      row.appendChild(h('span', { className: 'sdt-log-time' }, formatTimestamp(log.timestamp)));
      row.appendChild(h('span', { className: `sdt-log-method sdt-log-method-${log.method.toLowerCase()}` }, log.method));
      row.appendChild(h('span', { className: 'sdt-log-url' }, log.url));
      if (log.status !== undefined) {
        row.appendChild(h('span', { className: `sdt-log-status ${log.status < 400 ? 'sdt-log-status-ok' : 'sdt-log-status-err'}` }, String(log.status)));
      }
      if (log.duration !== undefined) {
        row.appendChild(h('span', { className: 'sdt-log-time' }, log.duration + 'ms'));
      }
      return row;
    }

    const log = item.entry;
    const row = h('div', { className: 'sdt-log-item' });
    row.appendChild(h('span', { className: 'sdt-log-time' }, formatTimestamp(log.timestamp)));
    row.appendChild(h('span', { className: `sdt-badge ${EVENT_TYPE_STYLES[log.type] || 'sdt-badge-info'}` }, log.type));
    row.appendChild(h('span', { className: 'sdt-log-message' }, log.message));
    return row;
  }

  function renderLogs() {
    const previousScrollTop = contentArea.scrollTop;
    contentArea.innerHTML = '';
    const merged = getMergedLogs();
    visibleLogCount = Math.min(Math.max(visibleLogCount, CONSOLE_LOG_BATCH_SIZE), Math.max(merged.length, CONSOLE_LOG_BATCH_SIZE));

    if (merged.length === 0) {
      contentArea.innerHTML = '<div class="sdt-empty-state"><div class="sdt-empty-state-icon">\uD83D\uDCCB</div><div>No logs recorded yet</div><div style="font-size:12px;color:var(--sdt-text-tertiary)">API calls and auth events will appear here</div></div>';
      return;
    }

    const list = h('div', { className: 'sdt-log-list' });
    for (const item of merged.slice(0, visibleLogCount)) {
      list.appendChild(renderLogItem(item));
    }
    if (visibleLogCount < merged.length) {
      list.appendChild(h('div', { className: 'sdt-log-load-hint' }, `${merged.length - visibleLogCount} older logs available`));
    }
    contentArea.appendChild(list);
    contentArea.scrollTop = Math.min(previousScrollTop, contentArea.scrollHeight);
  }

  function maybeLoadOlderLogs() {
    const mergedLength = getMergedLogs().length;
    if (visibleLogCount >= mergedLength) return;
    const distanceFromBottom = contentArea.scrollHeight - contentArea.scrollTop - contentArea.clientHeight;
    if (distanceFromBottom <= 48) {
      visibleLogCount = Math.min(visibleLogCount + CONSOLE_LOG_BATCH_SIZE, mergedLength);
      renderLogs();
    }
  }

  contentArea.addEventListener('scroll', maybeLoadOlderLogs);
  renderLogs();

  copyBtn.addEventListener('click', () => {
    runAsynchronously(
      navigator.clipboard.writeText(formatLogsForExport()).then(() => {
        copyBtn.textContent = '\u2713 Copied';
        setTimeout(() => {
          setHtml(copyBtn, '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Copy');
        }, 1500);
      })
    );
  });

  exportBtn.addEventListener('click', () => {
    const blob = new Blob([formatLogsForExport()], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = h('a', { href: url, download: `stack-auth-dev-tool-logs-${new Date().toISOString()}.txt` });
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  });

  clearBtn.addEventListener('click', () => {
    visibleLogCount = CONSOLE_LOG_BATCH_SIZE;
    logStore.clear();
  });

  const unsub = logStore.subscribe(() => {
    renderLogs();
  });

  return {
    element: container,
    cleanup: () => {
      contentArea.removeEventListener('scroll', maybeLoadOlderLogs);
      unsub();
    },
  };
}

// ---------------------------------------------------------------------------
// AI tab
// ---------------------------------------------------------------------------

function createAITab(app: StackClientApp<true>): HTMLElement {
  const container = h('div', { className: 'sdt-ai-container' });
  const apiBaseUrl = resolveApiBaseUrl(app);

  type ToolCallState = 'running' | 'success' | 'error';
  type ToolCall = {
    id: string,
    toolName: string,
    argsText: string | null,
    resultText: string | null,
    state: ToolCallState,
    errorText: string | null,
    isExpanded: boolean,
  };
  type AssistantPart =
    | { type: 'text', content: string }
    | { type: 'tool', toolCallId: string };
  type UserMessage = { role: 'user'; content: string };
  type AssistantMessage = { role: 'assistant'; parts: AssistantPart[]; toolCallsById: Map<string, ToolCall> };
  type Message = UserMessage | AssistantMessage;
  const messages: Message[] = [];
  let aiLoading = false;
  let activeAiAbortController: AbortController | null = null;

  const messagesArea = h('div', { className: 'sdt-ai-messages' });
  const inputArea = h('div', { className: 'sdt-ai-input-area' });

  const SUGGESTED_QUESTIONS = [
    { icon: '\uD83D\uDD12', text: 'How do I protect a Next.js route?' },
    { icon: '\uD83D\uDC65', text: 'How do teams and permissions work?' },
    { icon: '\uD83D\uDD17', text: 'How do I add OAuth providers?' },
    { icon: '\u2709\uFE0F', text: 'How do I customize auth emails?' },
  ];

  function getHeaders(): Record<string, string> {
    const opts = app[stackAppInternalsSymbol].getConstructorOptions();
    // Hexclave rebrand: emit x-hexclave-* request headers (backend dual-accepts).
    const headers: Record<string, string> = {
      'X-Hexclave-Access-Type': 'client',
      'X-Hexclave-Project-Id': app.projectId,
    };
    if ('publishableClientKey' in opts && opts.publishableClientKey) {
      headers['X-Hexclave-Publishable-Client-Key'] = opts.publishableClientKey as string;
    }
    return headers;
  }

  function renderToolCard(toolCall: ToolCall): HTMLElement {
    const toolCard = h('div', { className: 'sdt-ai-tool-card' });
    const header = h('button', { className: 'sdt-ai-tool-header', type: 'button' });
    header.appendChild(h('span', { className: 'sdt-ai-tool-name' }, toolCall.toolName));
    header.appendChild(h('span', { className: `sdt-ai-tool-status sdt-ai-tool-status-${toolCall.state}` }, toolCall.state));
    header.appendChild(h('span', { className: `sdt-ai-tool-chevron${toolCall.isExpanded ? ' sdt-ai-tool-chevron-open' : ''}` }, '\u25BE'));
    header.addEventListener('click', () => {
      toolCall.isExpanded = !toolCall.isExpanded;
      renderMessages();
    });
    toolCard.appendChild(header);

    if (toolCall.isExpanded) {
      const body = h('div', { className: 'sdt-ai-tool-body' });
      if (toolCall.argsText !== null) {
        body.appendChild(h('div', { className: 'sdt-ai-tool-label' }, 'Args'));
        const argsPre = h('pre', { className: 'sdt-ai-tool-pre' });
        argsPre.appendChild(h('code', null, toolCall.argsText));
        body.appendChild(argsPre);
      }
      if (toolCall.resultText !== null) {
        body.appendChild(h('div', { className: 'sdt-ai-tool-label' }, toolCall.state === 'error' ? 'Error' : 'Result'));
        const resultPre = h('pre', { className: 'sdt-ai-tool-pre' });
        resultPre.appendChild(h('code', null, toolCall.resultText));
        body.appendChild(resultPre);
      }
      if (toolCall.state === 'running') {
        body.appendChild(h('div', { className: 'sdt-ai-tool-running' }, 'Running...'));
      }
      toolCard.appendChild(body);
    }

    return toolCard;
  }

  function renderMessages() {
    messagesArea.innerHTML = '';

    if (messages.length === 0) {
      const empty = h('div', { className: 'sdt-ai-empty' });
      const icon = h('div', { className: 'sdt-ai-empty-icon' });
      setHtml(icon, '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>');
      empty.appendChild(icon);
      empty.appendChild(h('div', { className: 'sdt-ai-empty-title' }, 'Ask AI'));
      empty.appendChild(h('div', { className: 'sdt-ai-empty-desc' }, 'Get help with Hexclave integration, troubleshooting, and best practices.'));

      const suggestions = h('div', { className: 'sdt-ai-suggestions' });
      for (const q of SUGGESTED_QUESTIONS) {
        const btn = h('button', { className: 'sdt-ai-suggestion' });
        btn.appendChild(h('span', { className: 'sdt-ai-suggestion-icon' }, q.icon));
        btn.appendChild(h('span', null, q.text));
        btn.addEventListener('click', () => {
          runAsynchronously(sendMessage(q.text));
        });
        suggestions.appendChild(btn);
      }
      empty.appendChild(suggestions);
      messagesArea.appendChild(empty);
      return;
    }

    const list = h('div', { className: 'sdt-ai-message-list' });
    for (const msg of messages) {
      if (msg.role === 'user') {
        const msgDiv = h('div', { className: 'sdt-ai-msg sdt-ai-msg-user' });
        const bubble = h('div', { className: 'sdt-ai-bubble sdt-ai-bubble-user' });
        bubble.appendChild(h('p', null, msg.content));
        msgDiv.appendChild(bubble);
        const avatarDiv = h('div', { className: 'sdt-ai-avatar sdt-ai-avatar-user' });
        setHtml(avatarDiv, '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>');
        msgDiv.appendChild(avatarDiv);
        list.appendChild(msgDiv);
      } else {
        const msgDiv = h('div', { className: 'sdt-ai-msg sdt-ai-msg-assistant' });
        const avatarDiv = h('div', { className: 'sdt-ai-avatar sdt-ai-avatar-assistant' });
        setHtml(avatarDiv, '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>');
        msgDiv.appendChild(avatarDiv);
        const bubble = h('div', { className: 'sdt-ai-bubble sdt-ai-bubble-assistant' });
        if (msg.parts.length === 0) {
          bubble.innerHTML = '<div class="sdt-ai-thinking"><span class="sdt-ai-thinking-dot"></span><span class="sdt-ai-thinking-dot"></span><span class="sdt-ai-thinking-dot"></span></div>';
        } else {
          for (const part of msg.parts) {
            if (part.type === 'text') {
              const textContainer = h('div', { className: 'sdt-ai-part-text' });
              renderMarkdownInto(textContainer, part.content);
              bubble.appendChild(textContainer);
              continue;
            }

            const toolCall = msg.toolCallsById.get(part.toolCallId);
            if (toolCall == null) {
              const missingTool = h('div', { className: 'sdt-ai-tool-card' });
              const missingBody = h('div', { className: 'sdt-ai-tool-body' });
              missingBody.appendChild(h('div', { className: 'sdt-ai-tool-label' }, 'Error'));
              const missingPre = h('pre', { className: 'sdt-ai-tool-pre' });
              missingPre.appendChild(h('code', null, `Missing tool call state for ${part.toolCallId}`));
              missingBody.appendChild(missingPre);
              missingTool.appendChild(missingBody);
              bubble.appendChild(missingTool);
              continue;
            }
            const toolsContainer = h('div', { className: 'sdt-ai-tools' });
            toolsContainer.appendChild(renderToolCard(toolCall));
            bubble.appendChild(toolsContainer);
          }
        }
        msgDiv.appendChild(bubble);
        list.appendChild(msgDiv);
      }
    }
    messagesArea.appendChild(list);
    messagesArea.scrollTop = messagesArea.scrollHeight;
  }

  function renderMarkdownInto(el: HTMLElement, content: string) {
    function appendBlockWithInlineMarkdown(tag: "p" | "li" | "h1" | "h2" | "h3", className: string, text: string) {
      const block = h(tag, { className });
      appendInlineMarkdown(block, text);
      el.appendChild(block);
    }

    const lines = content.split('\n');
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];

      if (line.startsWith('```')) {
        const lang = line.slice(3).trim();
        const codeLines: string[] = [];
        i++;
        while (i < lines.length && !lines[i].startsWith('```')) {
          codeLines.push(lines[i]);
          i++;
        }
        i++;
        const block = h('div', { className: 'sdt-ai-code-block' });
        const header = h('div', { className: 'sdt-ai-code-header' });
        header.appendChild(h('span', { className: 'sdt-ai-code-lang' }, lang || 'CODE'));
        const copyBtn = h('button', { className: 'sdt-ai-copy-btn' }, '\u2398');
        const code = codeLines.join('\n');
        copyBtn.addEventListener('click', () => {
          runAsynchronously(navigator.clipboard.writeText(code).then(() => {
            copyBtn.textContent = '\u2713';
            setTimeout(() => {
              copyBtn.textContent = '\u2398';
            }, 1500);
          }));
        });
        header.appendChild(copyBtn);
        block.appendChild(header);
        const pre = h('pre', { className: 'sdt-ai-code-pre' });
        pre.appendChild(h('code', null, code));
        block.appendChild(pre);
        el.appendChild(block);
        continue;
      }

      const headingMatch = line.match(/^(#{1,3}) (.+)/);
      if (headingMatch) {
        const tag = `h${headingMatch[1].length}` as 'h1' | 'h2' | 'h3';
        appendBlockWithInlineMarkdown(tag, "sdt-ai-heading", headingMatch[2]);
        i++;
        continue;
      }

      if (/^[-*] /.test(line)) {
        const ul = h('ul', { className: 'sdt-ai-list' });
        while (i < lines.length && /^[-*] /.test(lines[i])) {
          const li = h("li");
          appendInlineMarkdown(li, lines[i].replace(/^[-*] /, ""));
          ul.appendChild(li);
          i++;
        }
        el.appendChild(ul);
        continue;
      }

      if (/^\d+\. /.test(line)) {
        const ol = h('ol', { className: 'sdt-ai-list sdt-ai-list-ordered' });
        while (i < lines.length && /^\d+\. /.test(lines[i])) {
          const li = h("li");
          appendInlineMarkdown(li, lines[i].replace(/^\d+\. /, ""));
          ol.appendChild(li);
          i++;
        }
        el.appendChild(ol);
        continue;
      }

      if (line.trim() === '') {
        i++;
        continue;
      }

      appendBlockWithInlineMarkdown("p", "sdt-ai-paragraph", line);
      i++;
    }
  }

  function stringifyForDebug(value: unknown): string {
    if (value === undefined || typeof value === 'function' || typeof value === 'symbol') {
      return String(value);
    }
    return JSON.stringify(value, null, 2);
  }

  function getLastItem<T>(items: readonly T[]): T | undefined {
    return items.length > 0 ? items[items.length - 1] : undefined;
  }

  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  function expectObject(value: unknown, payload: string): Record<string, unknown> {
    if (!isRecord(value)) {
      throw new Error(`SSE payload must be an object: ${payload}`);
    }
    return value;
  }

  function getRequiredStringField(event: Record<string, unknown>, field: string, payload: string): string {
    const value = event[field];
    if (typeof value !== 'string') {
      throw new Error(`SSE event '${String(event.type)}' missing string '${field}': ${payload}`);
    }
    return value;
  }

  function getCurrentAssistantMessage(): AssistantMessage {
    const lastMessage = getLastItem(messages);
    if (lastMessage?.role !== 'assistant') {
      throw new Error('Expected current message to be an assistant message');
    }
    return lastMessage;
  }

  function appendTextDelta(delta: string) {
    const assistantMessage = getCurrentAssistantMessage();
    const lastPart = getLastItem(assistantMessage.parts);
    if (lastPart?.type === 'text') {
      lastPart.content += delta;
      return;
    }
    assistantMessage.parts.push({ type: 'text', content: delta });
  }

  function ensureToolPart(assistantMessage: AssistantMessage, toolCallId: string) {
    const hasPart = assistantMessage.parts.some(part => part.type === 'tool' && part.toolCallId === toolCallId);
    if (!hasPart) {
      assistantMessage.parts.push({ type: 'tool', toolCallId });
    }
  }

  function findOrCreateToolCall(toolCallId: string, fallbackToolName: string): ToolCall {
    const assistantMessage = getCurrentAssistantMessage();
    const existing = assistantMessage.toolCallsById.get(toolCallId);
    if (existing != null) {
      if (existing.toolName === 'tool' && fallbackToolName !== 'tool') {
        existing.toolName = fallbackToolName;
      }
      ensureToolPart(assistantMessage, toolCallId);
      return existing;
    }

    const created: ToolCall = {
      id: toolCallId,
      toolName: fallbackToolName,
      argsText: null,
      resultText: null,
      state: 'running',
      errorText: null,
      isExpanded: false,
    };
    assistantMessage.toolCallsById.set(toolCallId, created);
    ensureToolPart(assistantMessage, toolCallId);
    return created;
  }

  async function sendMessage(text: string) {
    if (!text.trim() || aiLoading) return;
    messages.push({ role: 'user', content: text.trim() });
    messages.push({ role: 'assistant', parts: [], toolCallsById: new Map<string, ToolCall>() });
    aiLoading = true;
    renderMessages();
    renderInput();

    try {
      const abortController = new AbortController();
      activeAiAbortController = abortController;
      const res = await fetch(`${apiBaseUrl}/api/latest/ai/query/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getHeaders(),
        },
        signal: abortController.signal,
        body: JSON.stringify({
          systemPrompt: 'command-center-ask-ai',
          tools: ['docs'],
          quality: 'smart',
          speed: 'slow',
          messages: messages
            .slice(0, -1)
            .map((m) => ({
              role: m.role,
              content: [{ type: 'text', text: m.role === 'user' ? m.content : m.parts.filter(part => part.type === 'text').map(part => part.content).join('') }],
            })),
        }),
      });

      if (!res.ok) {
        throw new Error(`AI request failed with status ${res.status}`);
      }
      if (!res.body) {
        throw new Error('AI request returned no response body');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const streamLines = buffer.split('\n');
        buffer = streamLines.pop() || '';

        for (const streamLine of streamLines) {
          const line = streamLine.trim();
          if (line === '' || line.startsWith(':')) continue;
          if (!line.startsWith('data: ')) {
            throw new Error(`Unexpected SSE line: ${line}`);
          }

          const payload = line.slice(6);
          if (payload === '[DONE]') continue;
          const event = expectObject(JSON.parse(payload), payload);
          const eventType = getRequiredStringField(event, 'type', payload);

          switch (eventType) {
            case 'start':
            case 'start-step':
            case 'finish-step':
            case 'finish':
            case 'message-metadata':
            case 'text-start':
            case 'text-end':
            case 'reasoning-start':
            case 'reasoning-delta':
            case 'reasoning-end':
            case 'source-url':
            case 'source-document':
            case 'file': {
              break;
            }
            case 'text-delta': {
              const delta = getRequiredStringField(event, 'delta', payload);
              appendTextDelta(delta);
              break;
            }
            case 'tool-input-start': {
              const toolCallId = getRequiredStringField(event, 'toolCallId', payload);
              const toolName = getRequiredStringField(event, 'toolName', payload);
              const toolCall = findOrCreateToolCall(toolCallId, toolName);
              toolCall.state = 'running';
              toolCall.resultText = null;
              toolCall.errorText = null;
              toolCall.argsText = '';
              break;
            }
            case 'tool-input-delta': {
              const toolCallId = getRequiredStringField(event, 'toolCallId', payload);
              const inputTextDelta = getRequiredStringField(event, 'inputTextDelta', payload);
              const toolCall = findOrCreateToolCall(toolCallId, 'tool');
              toolCall.argsText = (toolCall.argsText ?? '') + inputTextDelta;
              break;
            }
            case 'tool-input-available': {
              const toolCallId = getRequiredStringField(event, 'toolCallId', payload);
              const toolName = getRequiredStringField(event, 'toolName', payload);
              const toolCall = findOrCreateToolCall(toolCallId, toolName);
              toolCall.argsText = stringifyForDebug(event.input);
              break;
            }
            case 'tool-input-error': {
              const toolCallId = getRequiredStringField(event, 'toolCallId', payload);
              const toolName = getRequiredStringField(event, 'toolName', payload);
              const errorText = getRequiredStringField(event, 'errorText', payload);
              const toolCall = findOrCreateToolCall(toolCallId, toolName);
              toolCall.state = 'error';
              toolCall.errorText = errorText;
              toolCall.resultText = errorText;
              break;
            }
            case 'tool-output-available': {
              const toolCallId = getRequiredStringField(event, 'toolCallId', payload);
              const toolCall = findOrCreateToolCall(toolCallId, 'tool');
              const preliminary = event.preliminary === true;
              toolCall.resultText = stringifyForDebug(event.output);
              if (!preliminary) {
                toolCall.state = 'success';
              }
              break;
            }
            case 'tool-output-error': {
              const toolCallId = getRequiredStringField(event, 'toolCallId', payload);
              const errorText = getRequiredStringField(event, 'errorText', payload);
              const toolCall = findOrCreateToolCall(toolCallId, 'tool');
              toolCall.state = 'error';
              toolCall.errorText = errorText;
              toolCall.resultText = errorText;
              break;
            }
            case 'tool-output-denied': {
              const toolCallId = getRequiredStringField(event, 'toolCallId', payload);
              const toolCall = findOrCreateToolCall(toolCallId, 'tool');
              toolCall.state = 'error';
              toolCall.errorText = 'Tool output denied';
              toolCall.resultText = 'Tool output denied';
              break;
            }
            case 'tool-approval-request': {
              const toolCallId = getRequiredStringField(event, 'toolCallId', payload);
              const approvalId = getRequiredStringField(event, 'approvalId', payload);
              const toolCall = findOrCreateToolCall(toolCallId, 'tool');
              toolCall.state = 'running';
              toolCall.resultText = `Approval requested (${approvalId})`;
              break;
            }
            case 'abort': {
              const reason = typeof event.reason === 'string' ? event.reason : 'unknown reason';
              throw new Error(`AI stream aborted: ${reason}`);
            }
            case 'error': {
              throw new Error(
                typeof event.errorText === 'string'
                  ? `AI stream error: ${event.errorText}`
                  : `AI stream error event: ${payload}`
              );
            }
            default: {
              if (eventType.startsWith('data-')) {
                break;
              }
              throw new Error(`Unexpected AI stream event type: ${eventType}`);
            }
          }
        }

        renderMessages();
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        const assistantMessage = getCurrentAssistantMessage();
        if (assistantMessage.parts.length === 0) {
          assistantMessage.parts.push({ type: 'text', content: 'Stopped.' });
        }
        renderMessages();
        return;
      }

      const message = error instanceof Error ? error.message : 'Unknown AI stream error';
      const lastMessage = getLastItem(messages);
      if (lastMessage?.role === 'assistant') {
        lastMessage.parts = [{ type: 'text', content: message }];
        lastMessage.toolCallsById.clear();
      }
      renderMessages();
      alert(`AI stream failed: ${message}`);
    } finally {
      aiLoading = false;
      activeAiAbortController = null;
      renderMessages();
      renderInput();
    }
  }

  const inputWrapper = h('div', { className: 'sdt-ai-input-wrapper' });
  const input = h('input', {
    type: 'text',
    className: 'sdt-ai-input',
    placeholder: 'Ask anything about Hexclave...',
    autocomplete: 'off',
    autocorrect: 'off',
    spellcheck: 'false',
  }) as HTMLInputElement;
  const sendBtn = h('button', { className: 'sdt-ai-send-btn', title: 'Send' });
  setHtml(sendBtn, '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>');

  function renderInput() {
    input.disabled = false;
    input.placeholder = messages.length === 0 ? 'Ask anything about Hexclave...' : 'Ask a follow-up...';
    if (aiLoading) {
      sendBtn.classList.add('sdt-ai-send-btn-active');
      sendBtn.classList.add('sdt-ai-stop-btn');
      sendBtn.setAttribute('title', 'Stop');
      setHtml(sendBtn, '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>');
    } else if (input.value.trim()) {
      sendBtn.classList.add('sdt-ai-send-btn-active');
      sendBtn.classList.remove('sdt-ai-stop-btn');
      sendBtn.setAttribute('title', 'Send');
      setHtml(sendBtn, '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>');
    } else {
      sendBtn.classList.remove('sdt-ai-send-btn-active');
      sendBtn.classList.remove('sdt-ai-stop-btn');
      sendBtn.setAttribute('title', 'Send');
      setHtml(sendBtn, '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>');
    }
  }

  input.addEventListener('input', renderInput);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (aiLoading) {
        activeAiAbortController?.abort();
      } else {
        runAsynchronously(sendMessage(input.value));
        input.value = '';
      }
      renderInput();
    }
  });
  sendBtn.addEventListener('click', () => {
    if (aiLoading) {
      activeAiAbortController?.abort();
    } else {
      runAsynchronously(sendMessage(input.value));
      input.value = '';
    }
    renderInput();
  });

  const newChatBtn = h('button', { className: 'sdt-ai-new-chat', title: 'New conversation', style: { display: 'none' } });
  setHtml(newChatBtn, '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>');
  newChatBtn.addEventListener('click', () => {
    if (aiLoading) {
      activeAiAbortController?.abort();
    }
    messages.length = 0;
    input.value = '';
    renderMessages();
    renderInput();
    newChatBtn.style.display = 'none';
  });

  inputWrapper.append(input, sendBtn);
  inputArea.append(newChatBtn, inputWrapper);

  container.append(messagesArea, inputArea);
  renderMessages();
  renderInput();

  return container;
}

// ---------------------------------------------------------------------------
// Heatmaps tab
// ---------------------------------------------------------------------------

type DevToolClickGroup = {
  selector: string;
  label: string;
  count: number;
  element: Element | null;
  rect: DOMRect | null;
};

type HeatmapGroupOverlayElement = {
  marker: HTMLElement;
  outline: HTMLElement;
};

const HEATMAP_TOOL_ROOT_ID = '__hexclave-dev-tool-root';
const HEATMAP_TOKEN_STORAGE_KEY = 'hexclave-heatmap-overlay-token';
const HEATMAP_ORIGIN_STORAGE_KEY = 'hexclave-heatmap-overlay-origin';
const HEATMAP_PROJECT_STORAGE_KEY = 'hexclave-heatmap-overlay-project-id';
const HEATMAP_FILTERS_STORAGE_KEY = 'hexclave-heatmap-overlay-filters';

type HeatmapRangeKey = '24h' | '7d' | '30d';
type HeatmapDeviceKey = 'all' | 'mobile' | 'tablet' | 'laptop' | 'desktop' | 'widescreen' | 'tv';

type HeatmapFilters = {
  range: HeatmapRangeKey,
  device: HeatmapDeviceKey,
  urlPattern: string,
  elementSearch: string,
};

const HEATMAP_DEFAULT_FILTERS: HeatmapFilters = {
  range: '7d',
  device: 'all',
  urlPattern: '',
  elementSearch: '',
};

const HEATMAP_RANGE_MS: Record<HeatmapRangeKey, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

function isHeatmapRangeKey(value: unknown): value is HeatmapRangeKey {
  return value === '24h' || value === '7d' || value === '30d';
}
function isHeatmapDeviceKey(value: unknown): value is HeatmapDeviceKey {
  return value === 'all' || value === 'mobile' || value === 'tablet' || value === 'laptop' || value === 'desktop' || value === 'widescreen' || value === 'tv';
}
const HEATMAP_BLOCKED_POINTER_EVENTS = ['pointerdown', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu'] as const;
const HEATMAP_BLOCKED_KEY_EVENTS = ['keydown', 'keypress', 'keyup', 'beforeinput', 'input'] as const;
const HEATMAP_DOM_INDEX_DEBOUNCE_MS = 250;

type DevToolServerHeatmapSelector = {
  selector: string;
  clicks: number;
};

type DevToolServerHeatmapElement = {
  elementsChain: string;
  elementsText: string;
  tagName: string;
  href: string | null;
  clicks: number;
};

type DevToolServerHeatmap = {
  path: string;
  // True aggregate click total returned for the active filter (summed across
  // every matching route), independent of how many elements can be drawn on the
  // current page's DOM. The overlay can only render elements that exist on the
  // page you're viewing, but this count reflects the full pattern.
  totalClicks: number;
  selectors: DevToolServerHeatmapSelector[];
  elements: DevToolServerHeatmapElement[];
};

type ElementsChainSegment = {
  tag: string;
  classes: string[];
  attrs: Record<string, string>;
  text: string | null;
  nthChild: number | null;
  nthOfType: number | null;
  href: string | null;
};

function parseElementsChain(chain: string): ElementsChainSegment[] {
  // Split top-level by ';' respecting quoted strings.
  const segments: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < chain.length; i++) {
    const ch = chain[i];
    if (ch === '\\' && i + 1 < chain.length) {
      current += ch + chain[i + 1];
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
      continue;
    }
    if (ch === ';' && !inQuotes) {
      segments.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.length > 0) {
    segments.push(current);
  }
  return segments.map(parseElementsChainSegment).filter((segment): segment is ElementsChainSegment => segment != null);
}

// Split a string on unescaped occurrences of `.`, unescaping `\.`, `\:` and `\\`
// back to their literal characters. Used to recover class tokens from the
// dot-joined segment prefix, which the event tracker escapes during serialization.
function splitEscapedDots(input: string): string[] {
  const out: string[] = [];
  let cur = '';
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === '\\' && i + 1 < input.length) {
      cur += input[i + 1];
      i += 1;
      continue;
    }
    if (ch === '.') {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function parseElementsChainSegment(segment: string): ElementsChainSegment | null {
  const trimmed = segment.trim();
  if (trimmed === '') return null;

  // Find first ':' at top level — separates tag/classes prefix from attribute pairs.
  let prefixEnd = trimmed.length;
  let inQuotes = false;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === '\\' && i + 1 < trimmed.length) {
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === ':' && !inQuotes) {
      prefixEnd = i;
      break;
    }
  }

  const prefix = trimmed.slice(0, prefixEnd);
  const rest = trimmed.slice(prefixEnd);
  const prefixParts = splitEscapedDots(prefix);
  const tag = prefixParts[0].trim().toLowerCase();
  if (tag === '') return null;
  const classes = prefixParts.slice(1).map((c) => c.trim()).filter((c) => c !== '');

  const attrs: Record<string, string> = {};
  let nthChild: number | null = null;
  let nthOfType: number | null = null;
  let text: string | null = null;
  let href: string | null = null;

  // Parse :key="value" pairs from rest.
  let i = 0;
  while (i < rest.length) {
    if (rest[i] !== ':') {
      i += 1;
      continue;
    }
    i += 1; // skip ':'
    // read key up to '='
    let keyEnd = i;
    while (keyEnd < rest.length && rest[keyEnd] !== '=' && rest[keyEnd] !== ':') keyEnd += 1;
    const key = rest.slice(i, keyEnd).trim();
    if (keyEnd >= rest.length || rest[keyEnd] !== '=') {
      i = keyEnd;
      continue;
    }
    let valStart = keyEnd + 1;
    if (rest[valStart] !== '"') {
      // unquoted — read until next ':' at top level
      let end = valStart;
      while (end < rest.length && rest[end] !== ':') end += 1;
      const value = rest.slice(valStart, end);
      const result = applyElementsChainAttr(key, value);
      if (result.nthChild != null) nthChild = result.nthChild;
      if (result.nthOfType != null) nthOfType = result.nthOfType;
      if (result.text != null) text = result.text;
      if (result.href != null) href = result.href;
      if (result.attrKey != null) attrs[result.attrKey] = result.attrValue ?? '';
      i = end;
      continue;
    }
    // quoted value — find unescaped closing quote
    valStart += 1;
    let end = valStart;
    let value = '';
    while (end < rest.length) {
      const ch = rest[end];
      if (ch === '\\' && end + 1 < rest.length) {
        const next = rest[end + 1];
        if (next === '"' || next === '\\') {
          value += next;
          end += 2;
          continue;
        }
        value += ch;
        end += 1;
        continue;
      }
      if (ch === '"') break;
      value += ch;
      end += 1;
    }
    const result = applyElementsChainAttr(key, value);
    if (result.nthChild != null) nthChild = result.nthChild;
    if (result.nthOfType != null) nthOfType = result.nthOfType;
    if (result.text != null) text = result.text;
    if (result.href != null) href = result.href;
    if (result.attrKey != null) attrs[result.attrKey] = result.attrValue ?? '';
    i = end + 1; // skip closing quote
  }

  return { tag, classes, attrs, text, nthChild, nthOfType, href };
}

type ElementsChainAttrResult = {
  nthChild?: number,
  nthOfType?: number,
  text?: string,
  href?: string,
  attrKey?: string,
  attrValue?: string,
};

function applyElementsChainAttr(key: string, value: string): ElementsChainAttrResult {
  if (key === 'nth-child') {
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) ? { nthChild: n } : {};
  }
  if (key === 'nth-of-type') {
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) ? { nthOfType: n } : {};
  }
  if (key === 'text') {
    return { text: value };
  }
  if (key === 'href') {
    return { href: value, attrKey: key, attrValue: value };
  }
  if (key.startsWith('attr__')) {
    return { attrKey: key.slice('attr__'.length), attrValue: value };
  }
  return { attrKey: key, attrValue: value };
}

function cssEscapeAttrValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function readChainAttr(segment: ElementsChainSegment, attr: string): string {
  if (!Object.prototype.hasOwnProperty.call(segment.attrs, attr)) return '';
  const value = segment.attrs[attr];
  return typeof value === 'string' ? value : '';
}

function cssEscapeIdent(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return value.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
}

function formatHeatmapCount(value: number): string {
  if (value >= 1000) return `${Math.round(value / 100) / 10}k`;
  return String(value);
}

function getHeatmapHue(count: number, maxCount: number): number {
  if (maxCount <= 1) return 185;
  const intensity = Math.min(1, count / maxCount);
  return 185 - Math.round(intensity * 155);
}

// Use event.composedPath() rather than target.closest(): the path is captured
// at dispatch time and stays valid even if the original target has since been
// detached from the DOM (e.g. an icon's <svg>/<path> that was replaced by an
// innerHTML reset between mousedown and click). With .closest(), detached
// targets have no ancestors so the check spuriously returns false, the page-
// interaction blocker eats the click, and the icon button looks dead.
function isInsideDevToolEvent(event: Event): boolean {
  const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
  for (const node of path) {
    if (node instanceof Element && node.id === HEATMAP_TOOL_ROOT_ID) {
      return true;
    }
  }
  // Fallback for environments without composedPath: best-effort ancestor walk.
  const target = event.target;
  if (target instanceof Element) {
    return target.closest(`#${HEATMAP_TOOL_ROOT_ID}`) != null;
  }
  return false;
}

function isHeatmapNavigationModifierEvent(event: Event): event is MouseEvent {
  return event instanceof MouseEvent && (event.metaKey || event.ctrlKey);
}

function getHeatmapNavigationHref(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) {
    return null;
  }
  const link = target.closest('a[href]');
  if (!(link instanceof HTMLAnchorElement)) {
    return null;
  }
  if (link.hasAttribute('download')) {
    return null;
  }
  const href = link.href;
  if (href === '' || href.startsWith('javascript:')) {
    return null;
  }
  return href;
}

function maybeNavigateFromHeatmapModifierClick(event: Event): boolean {
  if (!isHeatmapNavigationModifierEvent(event)) {
    return false;
  }
  if (event.type !== 'click') {
    return true;
  }

  const href = getHeatmapNavigationHref(event.target);
  if (href == null) {
    return true;
  }

  // Drop a sentinel into sessionStorage so the dev tool on the next page can
  // auto-reopen straight back into the heatmap tab. We can't soft-navigate
  // from outside the host framework reliably (Next.js App Router gates on a
  // private history-state marker, so a generic pushState+popstate doesn't
  // re-render the tree), so we hard-nav and rehydrate the panel on load.
  try {
    sessionStorage.setItem('hexclave-heatmap-overlay-resume', '1');
  } catch {
    // ignore (private mode, etc.)
  }
  window.location.assign(href);
  return true;
}

function getReadableElementLabel(element: Element): string {
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel != null && ariaLabel.trim() !== '') {
    return ariaLabel.trim().slice(0, 80);
  }
  const title = element.getAttribute('title');
  if (title != null && title.trim() !== '') {
    return title.trim().slice(0, 80);
  }
  const text = element.textContent.trim().replace(/\s+/g, ' ');
  if (text !== '') {
    return text.slice(0, 80);
  }
  return element.tagName.toLowerCase();
}

function isElementVisibleForHeatmap(element: Element): boolean {
  if (element.closest(`#${HEATMAP_TOOL_ROOT_ID}`) != null) {
    return false;
  }
  if (element.closest('[hidden], [aria-hidden="true"], [inert]') != null) {
    return false;
  }
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return false;
  }
  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
    return false;
  }
  return true;
}

function getElementFromSelector(selector: string): Element | null {
  try {
    const elements = Array.from(document.querySelectorAll(selector));
    return elements.find(isElementVisibleForHeatmap) ?? null;
  } catch {
    return null;
  }
}

function getProjectHeatmapTokenStorageKey(projectId: string): string {
  return `${HEATMAP_TOKEN_STORAGE_KEY}:${projectId}`;
}

function getProjectHeatmapOriginStorageKey(projectId: string): string {
  return `${HEATMAP_ORIGIN_STORAGE_KEY}:${projectId}`;
}

function getSessionStorageString(key: string): string | null {
  try {
    const value = sessionStorage.getItem(key);
    return value == null || value.trim() === '' ? null : value;
  } catch {
    return null;
  }
}

function getActiveHeatmapProjectId(fallbackProjectId: string): string {
  return getSessionStorageString(HEATMAP_PROJECT_STORAGE_KEY) ?? fallbackProjectId;
}

function removeSessionStorageItem(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // Storage can be blocked in private or embedded contexts; the toolbar keeps
    // rendering the actionable error state in that case.
  }
}

function getJwtPayloadProjectId(token: string): string | null {
  const tokenParts = token.split('.');
  if (tokenParts.length < 2 || tokenParts[1] === '') {
    return null;
  }
  try {
    const payloadPart = tokenParts[1];
    const normalized = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const payload: unknown = JSON.parse(atob(padded));
    if (typeof payload !== 'object' || payload === null) {
      return null;
    }
    const projectId = Reflect.get(payload, 'project_id');
    return typeof projectId === 'string' ? projectId : null;
  } catch {
    return null;
  }
}

function getHeatmapTokenFromStorage(projectId: string): string | null {
  const activeProjectId = getActiveHeatmapProjectId(projectId);
  const projectToken = getSessionStorageString(getProjectHeatmapTokenStorageKey(activeProjectId));
  if (projectToken != null) {
    return projectToken;
  }
  const legacyToken = getSessionStorageString(HEATMAP_TOKEN_STORAGE_KEY);
  if (legacyToken == null) {
    return null;
  }
  const legacyProjectId = getJwtPayloadProjectId(legacyToken);
  return legacyProjectId == null || legacyProjectId === activeProjectId ? legacyToken : null;
}

function getHeatmapOriginFromStorage(projectId: string): string | null {
  const activeProjectId = getActiveHeatmapProjectId(projectId);
  return getSessionStorageString(getProjectHeatmapOriginStorageKey(activeProjectId)) ?? getSessionStorageString(HEATMAP_ORIGIN_STORAGE_KEY);
}

function clearHeatmapTokenStorage(projectId: string): void {
  const activeProjectId = getActiveHeatmapProjectId(projectId);
  removeSessionStorageItem(getProjectHeatmapTokenStorageKey(activeProjectId));
  removeSessionStorageItem(getProjectHeatmapOriginStorageKey(activeProjectId));
  removeSessionStorageItem(HEATMAP_PROJECT_STORAGE_KEY);
  const legacyToken = getSessionStorageString(HEATMAP_TOKEN_STORAGE_KEY);
  const legacyProjectId = legacyToken == null ? null : getJwtPayloadProjectId(legacyToken);
  if (legacyProjectId == null || legacyProjectId === activeProjectId) {
    removeSessionStorageItem(HEATMAP_TOKEN_STORAGE_KEY);
    removeSessionStorageItem(HEATMAP_ORIGIN_STORAGE_KEY);
  }
}

function readNumberProperty(value: unknown, key: string): number | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const property = Reflect.get(value, key);
  return typeof property === 'number' && Number.isFinite(property) ? property : null;
}

function readStringProperty(value: unknown, key: string): string | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const property = Reflect.get(value, key);
  return typeof property === 'string' && property !== '' ? property : null;
}

function parseServerHeatmapResponse(value: unknown, path: string): DevToolServerHeatmap {
  const selectorsValue = typeof value === 'object' && value !== null ? Reflect.get(value, 'selectors') : undefined;
  const selectors: DevToolServerHeatmapSelector[] = [];
  if (Array.isArray(selectorsValue)) {
    for (const selectorValue of selectorsValue) {
      const selector = readStringProperty(selectorValue, 'selector');
      const clicks = readNumberProperty(selectorValue, 'clicks');
      if (selector != null && clicks != null) {
        selectors.push({ selector, clicks });
      }
    }
  }

  const elementsValue = typeof value === 'object' && value !== null ? Reflect.get(value, 'elements') : undefined;
  const elements: DevToolServerHeatmapElement[] = [];
  if (Array.isArray(elementsValue)) {
    for (const elementValue of elementsValue) {
      const elementsChain = readStringProperty(elementValue, 'elements_chain');
      const clicks = readNumberProperty(elementValue, 'clicks');
      if (elementsChain == null || clicks == null) continue;
      elements.push({
        elementsChain,
        elementsText: readStringProperty(elementValue, 'elements_text') ?? '',
        tagName: readStringProperty(elementValue, 'tag_name') ?? '',
        href: readStringProperty(elementValue, 'href'),
        clicks,
      });
    }
  }

  const routesValue = typeof value === 'object' && value !== null ? Reflect.get(value, 'routes') : undefined;
  let totalClicks = 0;
  if (Array.isArray(routesValue)) {
    for (const routeValue of routesValue) {
      const clicks = readNumberProperty(routeValue, 'clicks');
      if (clicks != null) totalClicks += clicks;
    }
  }

  return { path, totalClicks, selectors, elements };
}

// Heuristic: does this path segment look like an opaque per-entity id (a UUID,
// numeric id, Mongo ObjectId, ULID, etc.) rather than a human-readable slug?
// Used to auto-wildcard slug routes so a single heatmap pattern aggregates
// across every user/team instead of just the one currently in the URL.
function isDynamicPathSegment(segment: string): boolean {
  if (segment === '') return false;
  let decoded = segment;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    // keep the raw segment if it isn't valid percent-encoding
  }
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(decoded)) return true; // UUID
  if (/^[0-9a-f]{32}$/i.test(decoded)) return true; // UUID without dashes / md5
  if (/^[0-9a-f]{24}$/i.test(decoded)) return true; // Mongo ObjectId
  if (/^[0-9A-HJKMNP-TV-Z]{26}$/i.test(decoded)) return true; // ULID
  if (/^\d+$/.test(decoded)) return true; // numeric id
  return false;
}

// Turn the current pathname into a heatmap URL pattern by replacing id-like
// segments with `*` (PostHog-style wildcards). Stable slugs are preserved so
// e.g. `/teams/<uuid>/settings` becomes `/teams/*/settings`.
function wildcardizePathname(pathname: string): string {
  const trailingSlash = pathname.length > 1 && pathname.endsWith('/');
  const segments = pathname.split('/').map((segment) => (isDynamicPathSegment(segment) ? '*' : segment));
  const joined = segments.join('/');
  return trailingSlash ? `${joined}/` : joined;
}

// Does `path` match a PostHog-style URL pattern (where `*` is a wildcard)?
// Used to tell the user when the page they're on isn't covered by the pattern,
// so the overlay can't be drawn here even though aggregate data exists.
function patternMatchesPath(pattern: string, path: string): boolean {
  if (pattern === '') return true;
  const regexSource = pattern
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  try {
    return new RegExp(`^${regexSource}$`).test(path);
  } catch {
    return false;
  }
}

function createHeatmapsTab(app: StackClientApp<true>, onBack: () => void): TabResult {
  const container = h('div', { className: 'sdt-hm' });
  const overlayRoot = h('div', { className: 'sdt-hm-overlay-root', 'aria-hidden': 'true' });
  const statsCount = h('div', { className: 'sdt-hm-stat-value' }, '0');
  const selectorCount = h('div', { className: 'sdt-hm-stat-value' }, '0');
  const viewportValue = h('div', { className: 'sdt-hm-stat-value' }, `${window.innerWidth}x${window.innerHeight}`);
  const list = h('div', { className: 'sdt-hm-list' });
  const empty = h('div', { className: 'sdt-hm-empty' }, 'Paste a heatmap token from the dashboard to load aggregated element clicks for this page.');
  const status = h('div', { className: 'sdt-hm-token-status' });
  const overlayToggle = h('button', { className: 'sdt-hm-btn sdt-hm-btn-primary' }, 'Hide');
  const expandButton = h('button', { className: 'sdt-hm-icon-btn', 'aria-label': 'Expand heatmap options', title: 'Expand heatmap options' });
  const backButton = h('button', { className: 'sdt-hm-icon-btn', 'aria-label': 'Back', title: 'Back' });
  const miniClicks = h('span', { className: 'sdt-hm-toolbar-metric' }, '0 clicks');

  function readStoredFilters(): HeatmapFilters {
    try {
      const raw = sessionStorage.getItem(HEATMAP_FILTERS_STORAGE_KEY);
      if (raw == null) return { ...HEATMAP_DEFAULT_FILTERS };
      const parsed: unknown = JSON.parse(raw);
      if (parsed == null || typeof parsed !== 'object') return { ...HEATMAP_DEFAULT_FILTERS };
      const obj = parsed as Record<string, unknown>;
      return {
        range: isHeatmapRangeKey(obj.range) ? obj.range : HEATMAP_DEFAULT_FILTERS.range,
        device: isHeatmapDeviceKey(obj.device) ? obj.device : HEATMAP_DEFAULT_FILTERS.device,
        urlPattern: typeof obj.urlPattern === 'string' ? obj.urlPattern : HEATMAP_DEFAULT_FILTERS.urlPattern,
        elementSearch: typeof obj.elementSearch === 'string' ? obj.elementSearch : HEATMAP_DEFAULT_FILTERS.elementSearch,
      };
    } catch {
      return { ...HEATMAP_DEFAULT_FILTERS };
    }
  }
  function persistFilters(next: HeatmapFilters) {
    try {
      sessionStorage.setItem(HEATMAP_FILTERS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore storage errors
    }
  }

  let currentPath = window.location.pathname;
  let serverHeatmap: DevToolServerHeatmap = { path: currentPath, totalClicks: 0, selectors: [], elements: [] };
  let loadingServerHeatmap = false;
  let serverHeatmapError: string | null = null;
  let serverHeatmapRequestId = 0;
  let overlayVisible = true;
  let expanded = false;
  let renderFrame = 0;
  let overlayMode: 'hidden' | 'elements' = 'hidden';
  const groupOverlayElements = new Map<string, HeatmapGroupOverlayElement>();

  // DOM-index cache for fast element-chain inference.
  const domIndex = new Map<string, Element[]>();
  let domIndexDirty = true;
  let domIndexDebounce = 0;
  function rebuildDomIndex() {
    domIndex.clear();
    const all = document.querySelectorAll('*');
    for (const el of all) {
      if (!isElementVisibleForHeatmap(el)) continue;
      const tag = el.tagName.toLowerCase();
      const bucket = domIndex.get(tag) ?? [];
      bucket.push(el);
      domIndex.set(tag, bucket);
    }
    domIndexDirty = false;
  }
  function ensureDomIndex() {
    if (domIndexDirty) rebuildDomIndex();
  }
  function invalidateDomIndex() {
    domIndexDirty = true;
  }
  function scheduleDomIndexInvalidation() {
    if (domIndexDebounce !== 0) {
      window.clearTimeout(domIndexDebounce);
    }
    domIndexDebounce = window.setTimeout(() => {
      domIndexDebounce = 0;
      invalidateDomIndex();
      scheduleRender();
    }, HEATMAP_DOM_INDEX_DEBOUNCE_MS);
  }

  function isElementChainCandidateUnique(matches: Element[]): Element | null {
    const visible = matches.filter(isElementVisibleForHeatmap);
    return visible.length === 1 ? visible[0] : null;
  }

  function queryUniqueBySelector(selector: string): Element | null {
    try {
      const all = Array.from(document.querySelectorAll(selector));
      return isElementChainCandidateUnique(all);
    } catch {
      return null;
    }
  }

  function elementMatchesSegment(element: Element, segment: ElementsChainSegment, useClasses: boolean): boolean {
    if (element.tagName.toLowerCase() !== segment.tag) return false;
    if (useClasses) {
      for (const cls of segment.classes) {
        if (!element.classList.contains(cls)) return false;
      }
    }
    return true;
  }

  function ancestorMatchesChain(leaf: Element, chain: ElementsChainSegment[], useClasses: boolean, useNthOfType: boolean, useNthChild: boolean): boolean {
    let cursor: Element | null = leaf;
    for (let i = 0; i < chain.length; i++) {
      if (cursor == null) return false;
      const segment = chain[i];
      if (!elementMatchesSegment(cursor, segment, useClasses)) return false;
      if (useNthOfType && segment.nthOfType != null) {
        if (computeNthOfType(cursor) !== segment.nthOfType) return false;
      }
      if (useNthChild && segment.nthChild != null) {
        if (computeNthChild(cursor) !== segment.nthChild) return false;
      }
      cursor = cursor.parentElement;
    }
    return true;
  }

  function computeNthOfType(el: Element): number {
    let n = 1;
    let sib = el.previousElementSibling;
    const tag = el.tagName;
    while (sib != null) {
      if (sib.tagName === tag) n += 1;
      sib = sib.previousElementSibling;
    }
    return n;
  }

  function computeNthChild(el: Element): number {
    let n = 1;
    let sib = el.previousElementSibling;
    while (sib != null) {
      n += 1;
      sib = sib.previousElementSibling;
    }
    return n;
  }

  function inferElementFromChain(chain: ElementsChainSegment[]): Element | null {
    if (chain.length === 0) return null;
    const leaf = chain[0];

    // 1. Stable attribute selectors on leaf (no tag).
    const stableAttrOrder: Array<{ attr: string, prefix?: string }> = [
      { attr: 'data-hexclave-id' },
      { attr: 'data-testid' },
      { attr: 'data-test-id' },
      { attr: 'name' },
    ];
    for (const { attr } of stableAttrOrder) {
      const value = readChainAttr(leaf, attr);
      if (value === '') continue;
      const sel = `[${attr}="${cssEscapeAttrValue(value)}"]`;
      const match: Element | null = queryUniqueBySelector(sel);
      if (match) return match;
    }
    const id = readChainAttr(leaf, 'id');
    if (id !== '') {
      const match: Element | null = queryUniqueBySelector(`#${cssEscapeIdent(id)}`);
      if (match) return match;
    }
    if (leaf.href != null && leaf.href !== '' && leaf.tag === 'a') {
      const match: Element | null = queryUniqueBySelector(`a[href="${cssEscapeAttrValue(leaf.href)}"]`);
      if (match) return match;
    }

    // 2. Tag + stable attribute on the leaf.
    const otherStableAttrs = ['aria-label', 'role', 'placeholder', 'title', 'type'];
    for (const attr of otherStableAttrs) {
      const value = readChainAttr(leaf, attr);
      if (value === '') continue;
      const sel = `${leaf.tag}[${attr}="${cssEscapeAttrValue(value)}"]`;
      const match: Element | null = queryUniqueBySelector(sel);
      if (match) return match;
    }

    // 3, 4, 5: walk the DOM index by leaf tag, score the chain.
    ensureDomIndex();
    const candidates = domIndex.get(leaf.tag) ?? [];
    if (candidates.length === 0) return null;

    // Variant 3: tag.classes across the chain, no nth.
    const v3: Element[] = [];
    for (const candidate of candidates) {
      if (ancestorMatchesChain(candidate, chain, true, false, false)) v3.push(candidate);
    }
    const u3 = isElementChainCandidateUnique(v3);
    if (u3 != null) return u3;

    // Variant 4: tag.classes + nth-of-type.
    const v4: Element[] = [];
    for (const candidate of candidates) {
      if (ancestorMatchesChain(candidate, chain, true, true, false)) v4.push(candidate);
    }
    const u4 = isElementChainCandidateUnique(v4);
    if (u4 != null) return u4;

    // Variant 5: tag.classes + nth-child.
    const v5: Element[] = [];
    for (const candidate of candidates) {
      if (ancestorMatchesChain(candidate, chain, true, true, true)) v5.push(candidate);
    }
    const u5 = isElementChainCandidateUnique(v5);
    if (u5 != null) return u5;

    return null;
  }

  setHtml(backButton, '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg>');
  const chevronUpSvg = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>';
  const chevronDownSvg = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
  setHtml(expandButton, chevronUpSvg);

  const toolbar = h('div', { className: 'sdt-hm-toolbar' },
    backButton,
    h('div', { className: 'sdt-hm-toolbar-main' },
      h('div', { className: 'sdt-hm-toolbar-title' }, 'Heatmap'),
      h('div', { className: 'sdt-hm-toolbar-subtitle' }, 'Page locked while inspecting'),
    ),
    miniClicks,
    expandButton,
  );
  const stats = h('div', { className: 'sdt-hm-stats' },
    h('div', { className: 'sdt-hm-stat' }, h('div', { className: 'sdt-hm-stat-label' }, 'Clicks'), statsCount),
    h('div', { className: 'sdt-hm-stat' }, h('div', { className: 'sdt-hm-stat-label' }, 'Elements'), selectorCount),
    h('div', { className: 'sdt-hm-stat' }, h('div', { className: 'sdt-hm-stat-label' }, 'Viewport'), viewportValue),
  );

  const note = h('div', { className: 'sdt-hm-note' },
    'Heatmap mode blocks page clicks and keyboard input outside this toolbar while keeping every toolbar control interactive.'
  );

  let filters: HeatmapFilters = readStoredFilters();
  let filterReloadDebounce = 0;
  // When the user hasn't typed a custom pattern, the URL pattern field mirrors
  // the current route with id-like segments auto-wildcarded (`/teams/*/settings`)
  // so the heatmap aggregates across all entities. A stored non-empty pattern
  // means the user took manual control, so we leave it alone.
  let urlPatternUserEdited = filters.urlPattern.trim() !== '';

  function getEffectiveUrlPattern(): string {
    if (urlPatternUserEdited) return filters.urlPattern.trim();
    return wildcardizePathname(window.location.pathname);
  }
  // Reflect the current route into the field while in auto mode. No-op once the
  // user has typed their own pattern.
  function syncAutoUrlPattern() {
    if (urlPatternUserEdited) return;
    const auto = wildcardizePathname(window.location.pathname);
    if (urlPatternInput.value !== auto) {
      urlPatternInput.value = auto;
    }
  }

  function makeFilterSelect(options: Array<[string, string]>, value: string): HTMLSelectElement {
    const el = h('select', { className: 'sdt-hm-filter-input' }) as HTMLSelectElement;
    for (const [optValue, label] of options) {
      const opt = h('option', { value: optValue }, label) as HTMLOptionElement;
      el.appendChild(opt);
    }
    el.value = value;
    return el;
  }

  const rangeSelect = makeFilterSelect([
    ['24h', 'Last 24h'],
    ['7d', 'Last 7 days'],
    ['30d', 'Last 30 days'],
  ], filters.range);
  const deviceSelect = makeFilterSelect([
    ['all', 'All viewports'],
    ['mobile', 'Mobile'],
    ['tablet', 'Tablet'],
    ['laptop', 'Laptop'],
    ['desktop', 'Desktop'],
    ['widescreen', 'Widescreen'],
    ['tv', 'TV'],
  ], filters.device);
  const urlPatternInput = h('input', {
    className: 'sdt-hm-filter-input',
    type: 'text',
    placeholder: '/products/*',
    spellcheck: 'false',
    autocomplete: 'off',
    autocapitalize: 'off',
  }) as HTMLInputElement;
  urlPatternInput.value = getEffectiveUrlPattern();
  // Shown only while the active pattern doesn't cover the current page (see
  // render); resets the field back to the auto-wildcarded current route.
  const urlPatternReset = h('button', {
    className: 'sdt-hm-filter-reset',
    type: 'button',
    title: 'Reset the URL pattern to the current page',
  }, 'Reset') as HTMLButtonElement;
  const elementSearchInput = h('input', {
    className: 'sdt-hm-filter-input',
    type: 'text',
    placeholder: 'Search element text or tag',
    spellcheck: 'false',
    autocomplete: 'off',
    autocapitalize: 'off',
  }) as HTMLInputElement;
  elementSearchInput.value = filters.elementSearch;

  function wrapFilterField(label: string, input: HTMLElement, action?: HTMLElement): HTMLElement {
    const labelRow = h('span', { className: 'sdt-hm-filter-label-row' },
      h('span', { className: 'sdt-hm-filter-label' }, label),
    );
    if (action != null) {
      labelRow.appendChild(action);
    }
    return h('label', { className: 'sdt-hm-filter-field' },
      labelRow,
      input,
    );
  }

  const filterRow = h('div', { className: 'sdt-hm-filters' },
    h('div', { className: 'sdt-hm-filter-row' },
      wrapFilterField('Range', rangeSelect),
      wrapFilterField('Viewport', deviceSelect),
      wrapFilterField('URL pattern', urlPatternInput, urlPatternReset),
      wrapFilterField('Element search', elementSearchInput),
    ),
  );

  function scheduleFilterReload() {
    if (filterReloadDebounce !== 0) {
      window.clearTimeout(filterReloadDebounce);
    }
    filterReloadDebounce = window.setTimeout(() => {
      filterReloadDebounce = 0;
      runAsynchronously(loadServerHeatmap());
    }, 250);
  }

  function updateFilters(next: Partial<HeatmapFilters>) {
    filters = { ...filters, ...next };
    persistFilters(filters);
    scheduleFilterReload();
  }

  let elementSearchDebounce = 0;
  function updateElementSearch(value: string) {
    filters = { ...filters, elementSearch: value };
    persistFilters(filters);
    if (elementSearchDebounce !== 0) {
      window.clearTimeout(elementSearchDebounce);
    }
    elementSearchDebounce = window.setTimeout(() => {
      elementSearchDebounce = 0;
      scheduleRender();
    }, 120);
  }

  rangeSelect.addEventListener('change', () => {
    if (isHeatmapRangeKey(rangeSelect.value)) updateFilters({ range: rangeSelect.value });
  });
  deviceSelect.addEventListener('change', () => {
    if (isHeatmapDeviceKey(deviceSelect.value)) updateFilters({ device: deviceSelect.value });
  });
  urlPatternInput.addEventListener('input', () => {
    const value = urlPatternInput.value;
    // Clearing the field hands control back to auto mode (reflect the route).
    urlPatternUserEdited = value.trim() !== '';
    updateFilters({ urlPattern: value });
  });
  urlPatternReset.addEventListener('click', () => {
    // Hand control back to auto mode and reflect the current route immediately,
    // so the pattern covers the page the overlay is bound to.
    urlPatternUserEdited = false;
    urlPatternInput.value = wildcardizePathname(window.location.pathname);
    updateFilters({ urlPattern: '' });
  });
  elementSearchInput.addEventListener('input', () => {
    updateElementSearch(elementSearchInput.value);
  });

  // Two regions: a fixed head (filters + a single action row pairing the stat
  // chips with the overlay toggle) and a scrolling body (status, note, list).
  // Keeping borders to a single head/body divider avoids the dense stack of
  // bordered bands that made the expanded panel feel congested.
  const actions = h('div', { className: 'sdt-hm-actions' }, stats, overlayToggle);
  const head = h('div', { className: 'sdt-hm-head' }, filterRow, actions);
  const body = h('div', { className: 'sdt-hm-body' }, status, note, list);
  const details = h('div', { className: 'sdt-hm-details' }, head, body);

  function getGroups(): DevToolClickGroup[] {
    const byKey = new Map<string, DevToolClickGroup>();
    if (serverHeatmap.path !== currentPath) {
      return [];
    }

    const searchQuery = filters.elementSearch.trim().toLowerCase();
    const matchesSearch = (entry: DevToolServerHeatmapElement): boolean => {
      if (searchQuery === '') return true;
      const haystacks = [entry.elementsText, entry.tagName, entry.href ?? '', entry.elementsChain];
      return haystacks.some((value) => value.toLowerCase().includes(searchQuery));
    };

    // Prefer the elements-chain inference path (PostHog-style).
    if (serverHeatmap.elements.length > 0) {
      ensureDomIndex();
      for (const elementEntry of serverHeatmap.elements) {
        if (!matchesSearch(elementEntry)) continue;
        const chain = parseElementsChain(elementEntry.elementsChain);
        let element = chain.length > 0 ? inferElementFromChain(chain) : null;
        if (element == null && elementEntry.href != null && elementEntry.href !== '' && elementEntry.tagName.toLowerCase() === 'a') {
          element = queryUniqueBySelector(`a[href="${cssEscapeAttrValue(elementEntry.href)}"]`);
        }
        if (element == null) continue;
        const key = elementEntry.elementsChain;
        const existing = byKey.get(key);
        if (existing != null) {
          existing.count += elementEntry.clicks;
          continue;
        }
        byKey.set(key, {
          selector: key,
          label: getReadableElementLabel(element),
          count: elementEntry.clicks,
          element,
          rect: element.getBoundingClientRect(),
        });
      }
    }

    // Legacy selectors fallback (older backends or unresolved chains).
    if (byKey.size === 0) {
      for (const selectorHeatmap of serverHeatmap.selectors) {
        if (searchQuery !== '' && !selectorHeatmap.selector.toLowerCase().includes(searchQuery)) continue;
        const element = getElementFromSelector(selectorHeatmap.selector);
        if (element == null) continue;
        byKey.set(selectorHeatmap.selector, {
          selector: selectorHeatmap.selector,
          label: getReadableElementLabel(element),
          count: selectorHeatmap.clicks,
          element,
          rect: element.getBoundingClientRect(),
        });
      }
    }

    return Array.from(byKey.values())
      .sort((a, b) => b.count - a.count || stringCompare(a.selector, b.selector));
  }

  function scheduleRender() {
    cancelAnimationFrame(renderFrame);
    renderFrame = requestAnimationFrame(render);
  }

  function clearHeatmapOverlayElements() {
    groupOverlayElements.clear();
    overlayRoot.replaceChildren();
  }

  function getHeatmapViewportSize(): { width: number, height: number } {
    const visualViewport = window.visualViewport;
    if (visualViewport != null) {
      return { width: visualViewport.width, height: visualViewport.height };
    }
    return { width: window.innerWidth, height: window.innerHeight };
  }

  function shouldShowElements(): boolean {
    return overlayVisible;
  }

  function renderOverlay(groups: DevToolClickGroup[]) {
    const nextMode = shouldShowElements() ? 'elements' : 'hidden';
    if (overlayMode !== nextMode) {
      overlayMode = nextMode;
      clearHeatmapOverlayElements();
    }
    if (!shouldShowElements()) {
      return;
    }

    const visibleGroupKeys = new Set<string>();
    const maxCount = Math.max(1, ...groups.map((group) => group.count));
    for (const group of groups) {
      if (group.rect == null || group.rect.width <= 0 || group.rect.height <= 0) {
        continue;
      }
      visibleGroupKeys.add(group.selector);
      const hue = getHeatmapHue(group.count, maxCount);
      let overlayElement = groupOverlayElements.get(group.selector);
      if (overlayElement == null) {
        overlayElement = {
          marker: h('div', { className: 'sdt-hm-marker' }),
          outline: h('div', { className: 'sdt-hm-outline' }),
        };
        groupOverlayElements.set(group.selector, overlayElement);
        overlayRoot.append(overlayElement.outline, overlayElement.marker);
      }
      const { marker, outline } = overlayElement;
      marker.title = `${group.count} clicks on ${group.selector}`;
      marker.style.left = `${Math.round(group.rect.left + group.rect.width / 2)}px`;
      marker.style.top = `${Math.round(group.rect.top + group.rect.height / 2)}px`;
      marker.style.background = `hsla(${hue}, 96%, 58%, 0.94)`;
      marker.style.boxShadow = `0 0 0 1px hsla(${hue}, 96%, 22%, 0.35), 0 8px 24px hsla(${hue}, 96%, 45%, 0.32)`;
      marker.textContent = formatHeatmapCount(group.count);

      outline.style.left = `${group.rect.left}px`;
      outline.style.top = `${group.rect.top}px`;
      outline.style.width = `${group.rect.width}px`;
      outline.style.height = `${group.rect.height}px`;
      outline.style.borderColor = `hsla(${hue}, 96%, 58%, 0.5)`;
    }
    for (const [key, overlayElement] of groupOverlayElements) {
      if (!visibleGroupKeys.has(key)) {
        overlayElement.marker.remove();
        overlayElement.outline.remove();
        groupOverlayElements.delete(key);
      }
    }
  }

  function renderList(groups: DevToolClickGroup[]) {
    list.replaceChildren();
    if (groups.length === 0) {
      list.appendChild(empty);
      return;
    }
    for (const group of groups.slice(0, 30)) {
      const row = h('button', { className: 'sdt-hm-row' });
      row.appendChild(h('span', { className: 'sdt-hm-row-count' }, formatHeatmapCount(group.count)));
      const meta = h('span', { className: 'sdt-hm-row-meta' },
        h('span', { className: 'sdt-hm-row-label' }, group.label),
        h('span', { className: 'sdt-hm-row-selector' }, group.selector),
      );
      row.appendChild(meta);
      row.addEventListener('click', () => {
        group.element?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
      });
      list.appendChild(row);
    }
  }

  function render() {
    if (currentPath !== window.location.pathname) {
      currentPath = window.location.pathname;
      serverHeatmap = { path: currentPath, totalClicks: 0, selectors: [], elements: [] };
      serverHeatmapError = null;
      syncAutoUrlPattern();
      runAsynchronously(loadServerHeatmap());
    }
    const groups = getGroups();
    // Clicks mapped to an element that actually exists in the current DOM (what
    // the overlay can draw) vs. the true aggregate the filter matched server-side.
    const mappedClicks = groups.reduce((sum, group) => sum + group.count, 0);
    const aggregateClicks = serverHeatmap.path === currentPath ? serverHeatmap.totalClicks : 0;
    const viewport = getHeatmapViewportSize();
    statsCount.textContent = formatHeatmapCount(aggregateClicks);
    selectorCount.textContent = formatHeatmapCount(groups.length);
    viewportValue.textContent = `${Math.round(viewport.width)}x${Math.round(viewport.height)}`;
    overlayToggle.textContent = overlayVisible ? 'Hide overlay' : 'Show overlay';
    // A pattern that doesn't cover the current page means the overlay can't draw
    // here, so offer a one-click reset back to the current route.
    const effectiveUrlPattern = getEffectiveUrlPattern();
    const urlPatternMatchesPath = patternMatchesPath(effectiveUrlPattern, currentPath);
    urlPatternReset.classList.toggle('sdt-hm-filter-reset-visible', !urlPatternMatchesPath);
    const token = getHeatmapTokenFromStorage(app.projectId);
    const tokenOrigin = getHeatmapOriginFromStorage(app.projectId);
    if (token == null) {
      status.textContent = serverHeatmapError ?? `No ${getProjectHeatmapTokenStorageKey(getActiveHeatmapProjectId(app.projectId))} token in sessionStorage.`;
    } else if (tokenOrigin != null && tokenOrigin !== window.location.origin) {
      status.textContent = `Token was minted for ${tokenOrigin}, but this page is ${window.location.origin}. Generate a token for this exact origin.`;
    } else if (loadingServerHeatmap) {
      status.textContent = 'Loading aggregate clickmap...';
    } else if (serverHeatmapError != null) {
      status.textContent = serverHeatmapError;
    } else {
      const scope = effectiveUrlPattern !== '' && effectiveUrlPattern !== currentPath ? effectiveUrlPattern : currentPath;
      let message = `Loaded ${formatHeatmapCount(aggregateClicks)} aggregate clicks for ${scope}.`;
      if (aggregateClicks === 0) {
        message = `No clicks recorded for ${scope} in this range.`;
      } else if (!urlPatternMatchesPath) {
        // The overlay is bound to the page you're viewing; off-pattern pages
        // can't render it. This is the "* / shows 0 dots" case made explicit.
        message += ' This page isn’t covered by the pattern — reset it or open a matching page to see the overlay.';
      } else if (groups.length === 0) {
        message += ' No matching elements found on this page yet.';
      } else if (mappedClicks < aggregateClicks) {
        message += ` ${formatHeatmapCount(mappedClicks)} mapped to elements on this page.`;
      }
      status.textContent = message;
    }
    status.classList.toggle('sdt-hm-token-status-error', serverHeatmapError != null || (token != null && tokenOrigin != null && tokenOrigin !== window.location.origin));
    miniClicks.textContent = `${formatHeatmapCount(aggregateClicks)} clicks`;
    container.classList.toggle('sdt-hm-expanded', expanded);
    expandButton.setAttribute('aria-expanded', String(expanded));
    expandButton.setAttribute('aria-label', expanded ? 'Collapse heatmap options' : 'Expand heatmap options');
    expandButton.title = expanded ? 'Collapse heatmap options' : 'Expand heatmap options';
    setHtml(expandButton, expanded ? chevronDownSvg : chevronUpSvg);
    renderOverlay(groups);
    renderList(groups);
  }

  async function loadServerHeatmap() {
    const requestId = serverHeatmapRequestId + 1;
    serverHeatmapRequestId = requestId;
    const isLatestRequest = () => requestId === serverHeatmapRequestId;
    const token = getHeatmapTokenFromStorage(app.projectId);
    if (token == null) {
      serverHeatmap = { path: currentPath, totalClicks: 0, selectors: [], elements: [] };
      serverHeatmapError = null;
      loadingServerHeatmap = false;
      render();
      return;
    }
    const tokenOrigin = getHeatmapOriginFromStorage(app.projectId);
    if (tokenOrigin != null && tokenOrigin !== window.location.origin) {
      serverHeatmap = { path: currentPath, totalClicks: 0, selectors: [], elements: [] };
      serverHeatmapError = null;
      loadingServerHeatmap = false;
      render();
      return;
    }

    loadingServerHeatmap = true;
    serverHeatmapError = null;
    render();
    try {
      const until = new Date();
      const since = new Date(until.getTime() - HEATMAP_RANGE_MS[filters.range]);
      const requestedPath = window.location.pathname;
      const effectiveUrlPattern = getEffectiveUrlPattern();
      const body: Record<string, unknown> = {
        heatmap_token: token,
        origin: window.location.origin,
        since: since.toISOString(),
        until: until.toISOString(),
      };
      if (effectiveUrlPattern !== '') {
        body.url_pattern = effectiveUrlPattern;
      } else {
        body.route_path = requestedPath;
      }
      if (filters.device !== 'all') {
        body.device = filters.device;
      }
      const response = await app[stackAppInternalsSymbol].sendRequest("/analytics/heatmap", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }, "client");
      if (!response.ok) {
        throw new Error(`Heatmap request failed with HTTP ${response.status}`);
      }
      const responseBody: unknown = await response.json();
      if (!isLatestRequest()) {
        return;
      }
      serverHeatmap = parseServerHeatmapResponse(responseBody, requestedPath);
    } catch (error) {
      if (!isLatestRequest()) {
        return;
      }
      serverHeatmap = { path: currentPath, totalClicks: 0, selectors: [], elements: [] };
      if (error instanceof Error && error.message.includes('Heatmap token does not belong to this project')) {
        clearHeatmapTokenStorage(app.projectId);
        serverHeatmapError = 'The stored heatmap token belongs to another project. Generate a fresh token for this project.';
      } else {
        serverHeatmapError = error instanceof Error ? error.message : 'Failed to load heatmap data';
      }
    } finally {
      if (isLatestRequest()) {
        loadingServerHeatmap = false;
        render();
      }
    }
  }

  function blockHeatmapPageInteraction(event: Event) {
    if (isInsideDevToolEvent(event)) {
      return;
    }
    const token = getHeatmapTokenFromStorage(app.projectId);
    const tokenOrigin = getHeatmapOriginFromStorage(app.projectId);
    if (token == null || (tokenOrigin != null && tokenOrigin !== window.location.origin) || serverHeatmapError != null) {
      return;
    }

    if (maybeNavigateFromHeatmapModifierClick(event)) {
      if (event.type === 'click') {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
      }
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  overlayToggle.addEventListener('click', () => {
    overlayVisible = !overlayVisible;
    render();
  });
  backButton.addEventListener('click', onBack);
  expandButton.addEventListener('click', () => {
    expanded = !expanded;
    render();
  });
  const onTokenUpdated = () => {
    runAsynchronously(loadServerHeatmap());
  };
  const routePollInterval = window.setInterval(scheduleRender, 500);
  const mutationObserver = new MutationObserver(() => {
    scheduleDomIndexInvalidation();
    scheduleRender();
  });
  const visualViewport = window.visualViewport;
  mutationObserver.observe(document.body, { attributes: true, childList: true, subtree: true });

  document.body.appendChild(overlayRoot);
  rebuildDomIndex();
  scheduleRender();
  for (const eventName of HEATMAP_BLOCKED_POINTER_EVENTS) {
    window.addEventListener(eventName, blockHeatmapPageInteraction, true);
  }
  for (const eventName of HEATMAP_BLOCKED_KEY_EVENTS) {
    window.addEventListener(eventName, blockHeatmapPageInteraction, true);
  }
  const onWindowResize = () => {
    scheduleRender();
  };
  document.addEventListener('scroll', scheduleRender, true);
  window.addEventListener('resize', onWindowResize);
  visualViewport?.addEventListener('resize', scheduleRender);
  visualViewport?.addEventListener('scroll', scheduleRender);
  window.addEventListener('hexclave:heatmap-token-updated', onTokenUpdated);
  render();
  runAsynchronously(loadServerHeatmap());

  container.append(details, toolbar);
  return {
    element: container,
    cleanup: () => {
      cancelAnimationFrame(renderFrame);
      if (domIndexDebounce !== 0) window.clearTimeout(domIndexDebounce);
      if (filterReloadDebounce !== 0) window.clearTimeout(filterReloadDebounce);
      if (elementSearchDebounce !== 0) window.clearTimeout(elementSearchDebounce);
      window.clearInterval(routePollInterval);
      mutationObserver.disconnect();
      clearHeatmapOverlayElements();
      domIndex.clear();
      for (const eventName of HEATMAP_BLOCKED_POINTER_EVENTS) {
        window.removeEventListener(eventName, blockHeatmapPageInteraction, true);
      }
      for (const eventName of HEATMAP_BLOCKED_KEY_EVENTS) {
        window.removeEventListener(eventName, blockHeatmapPageInteraction, true);
      }
      document.removeEventListener('scroll', scheduleRender, true);
      window.removeEventListener('resize', onWindowResize);
      visualViewport?.removeEventListener('resize', scheduleRender);
      visualViewport?.removeEventListener('scroll', scheduleRender);
      window.removeEventListener('hexclave:heatmap-token-updated', onTokenUpdated);
      overlayRoot.remove();
    },
  };
}

// ---------------------------------------------------------------------------
// Dashboard tab
// ---------------------------------------------------------------------------

function createDashboardTab(app: StackClientApp<true>): HTMLElement {
  const dashboardUrl = resolveDashboardUrl(app);
  return createIframeTab(dashboardUrl, 'Hexclave Dashboard', 'Loading dashboard\u2026', 'Unable to load dashboard', 'The dashboard may require authentication or block framing', 'Open in New Tab');
}

// ---------------------------------------------------------------------------
// Support tab
// ---------------------------------------------------------------------------

function createSupportTab(app: StackClientApp<true>): HTMLElement {
  const container = h('div', { className: 'sdt-support-tab' });
  const apiBaseUrl = resolveApiBaseUrl(app);

  function createFeedbackForm(): HTMLElement {
    const pane = h('div', { className: 'sdt-support-feedback-pane' });
    const form = h('form', { className: 'sdt-support-form' });

    let feedbackType: 'feedback' | 'bug' = 'feedback';
    let status: 'idle' | 'submitting' | 'success' | 'error' = 'idle';
    let errorMessage = '';

    const nameInput = h('input', { className: 'sdt-support-input', type: 'text', placeholder: 'Your name' }) as HTMLInputElement;
    const emailInput = h('input', { className: 'sdt-support-input', type: 'email', placeholder: 'you@example.com', required: 'true' }) as HTMLInputElement;
    const messageInput = h('textarea', { className: 'sdt-support-textarea', placeholder: "What's on your mind?", required: 'true', rows: '5' }) as HTMLTextAreaElement;

    function render() {
      form.innerHTML = '';

      if (status === 'success') {
        const successDiv = h('div', { className: 'sdt-support-status sdt-support-status-success' });
        const icon = h('div', { className: 'sdt-support-status-icon' });
        setHtml(icon, '<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M6 10l3 3 5-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>');
        successDiv.append(
          icon,
          h('div', { className: 'sdt-support-status-title' }, 'Feedback sent'),
          h('div', { className: 'sdt-support-status-msg' }, "Thank you! We'll get back to you soon."),
        );
        const resetBtn = h('button', { className: 'sdt-support-submit', style: { marginTop: '12px', width: 'auto' } }, 'Send another');
        resetBtn.addEventListener('click', () => {
          status = 'idle';
          render();
        });
        successDiv.appendChild(resetBtn);
        form.appendChild(successDiv);
        return;
      }

      if (status === 'error') {
        const errDiv = h('div', { className: 'sdt-support-status sdt-support-status-error' });
        const icon = h('div', { className: 'sdt-support-status-icon' });
        setHtml(icon, '<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 6v5m0 3h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>');
        errDiv.append(
          icon,
          h('div', { className: 'sdt-support-status-title' }, 'Failed to send'),
          h('div', { className: 'sdt-support-status-msg' }, errorMessage || 'Please try again.'),
        );
        const retryBtn = h('button', { className: 'sdt-support-submit', style: { marginTop: '12px', width: 'auto' } }, 'Try again');
        retryBtn.addEventListener('click', () => {
          status = 'idle';
          errorMessage = '';
          render();
        });
        errDiv.appendChild(retryBtn);
        form.appendChild(errDiv);
        return;
      }

      const nameField = h('div', { className: 'sdt-support-field' });
      const nameLabel = h('label', { className: 'sdt-support-label' }, 'Name ');
      nameLabel.appendChild(h('span', { className: 'sdt-support-optional' }, 'optional'));
      nameField.append(nameLabel, nameInput);
      form.appendChild(nameField);

      const emailField = h('div', { className: 'sdt-support-field' });
      emailField.append(h('label', { className: 'sdt-support-label' }, 'Email'), emailInput);
      form.appendChild(emailField);

      const msgField = h('div', { className: 'sdt-support-field' });
      msgField.append(h('label', { className: 'sdt-support-label' }, feedbackType === 'bug' ? 'Description' : 'Message'), messageInput);
      messageInput.placeholder = feedbackType === 'bug' ? 'Steps to reproduce, expected vs. actual behavior\u2026' : "What's on your mind?";
      form.appendChild(msgField);

      const typeCards = h('div', { className: 'sdt-support-type-cards' });
      const feedbackBtn = h('button', { type: 'button', className: `sdt-support-type-card ${feedbackType === 'feedback' ? 'sdt-support-type-card-active' : ''}` });
      setHtml(feedbackBtn, '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg><span>Feedback</span>');
      feedbackBtn.addEventListener('click', () => {
        feedbackType = 'feedback';
        render();
      });
      const bugBtn = h('button', { type: 'button', className: `sdt-support-type-card ${feedbackType === 'bug' ? 'sdt-support-type-card-active' : ''}` });
      setHtml(bugBtn, '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2l1.88 1.88M14.12 3.88L16 2M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"/><path d="M12 20v-9M6.53 9C4.6 8.8 3 7.1 3 5M6 13H2M6 17H3M21 5c0 2.1-1.6 3.8-3.53 4M18 13h4M21 17h-3"/></svg><span>Bug Report</span>');
      bugBtn.addEventListener('click', () => {
        feedbackType = 'bug';
        render();
      });
      typeCards.append(feedbackBtn, bugBtn);
      form.appendChild(typeCards);

      const submitBtn = h('button', { type: 'submit', className: 'sdt-support-submit' });
      setHtml(submitBtn, 'Submit <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>');
      submitBtn.disabled = status === 'submitting';
      form.appendChild(submitBtn);

      const channels = h('div', { className: 'sdt-support-channels' });
      channels.innerHTML = `
        <a href="https://discord.hexclave.com" target="_blank" rel="noopener noreferrer" class="sdt-support-channel">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>
          <span>Discord</span>
        </a>
        <a href="mailto:team@hexclave.com" class="sdt-support-channel">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
          <span>Email</span>
        </a>
        <a href="https://github.com/hexclave/hexclave" target="_blank" rel="noopener noreferrer" class="sdt-support-channel">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"/></svg>
          <span>GitHub</span>
        </a>`;
      form.appendChild(channels);
      form.insertBefore(channels, form.firstChild);
    }

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!emailInput.value.trim() || !messageInput.value.trim()) return;
      runAsynchronously(async () => {
        status = 'submitting';
        render();
        try {
          const response = await fetch(`${apiBaseUrl}/api/latest/internal/feedback`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({
              name: nameInput.value.trim() || undefined,
              email: emailInput.value.trim(),
              message: messageInput.value.trim(),
              feedback_type: feedbackType,
            }),
          });
          if (!response.ok) {
            throw new Error(`Failed to send: ${response.status} ${response.statusText}`);
          }
          const result = await response.json();
          if (!result.success) {
            throw new Error(result.message || 'Failed to send feedback');
          }
          status = 'success';
          messageInput.value = '';
        } catch (err: any) {
          status = 'error';
          errorMessage = err.message || 'An unexpected error occurred';
        }
        render();
      });
    });

    render();
    pane.appendChild(form);
    return pane;
  }

  container.appendChild(createFeedbackForm());
  return container;
}

// ---------------------------------------------------------------------------
// Components tab
// ---------------------------------------------------------------------------

function createComponentsTab(app: StackClientApp<true>): HTMLElement {
  const container = h('div', { className: 'sdt-pg-layout' });
  const apiBaseUrl = resolveApiBaseUrl(app);
  const urls = app.urls;
  const urlOptions: HandlerUrlOptions = app[stackAppInternalsSymbol].getConstructorOptions().urls ?? {};

  const PAGE_ENTRIES: { key: keyof HandlerUrls; label: string }[] = [
    { key: 'signIn' as any, label: 'Sign-in' },
    { key: 'signUp' as any, label: 'Sign-up' },
    { key: 'forgotPassword' as any, label: 'Forgot password' },
    { key: 'passwordReset' as any, label: 'Password reset' },
    { key: 'emailVerification' as any, label: 'Email verification' },
    { key: 'accountSettings' as any, label: 'Account settings' },
    { key: 'teamInvitation' as any, label: 'Team invitation' },
    { key: 'cliAuthConfirm' as any, label: 'CLI auth confirmation' },
    { key: 'mfa' as any, label: 'MFA' },
    { key: 'onboarding' as any, label: 'Onboarding' },
    { key: 'error' as any, label: 'Error' },
  ];

  type PageClassification = 'handler-component' | 'hosted' | 'custom';

  function classifyPage(key: keyof HandlerUrls): { classification: PageClassification; version: number | null } {
    const target: HandlerUrlTarget = (urlOptions as any)[key] ?? (urlOptions as any).default ?? { type: 'handler-component' };
    if (typeof target === 'string') {
      return { classification: 'custom', version: null };
    }
    if ('type' in target) {
      if (target.type === 'custom') {
        return { classification: 'custom', version: (target as any).version ?? null };
      }
      return { classification: target.type as PageClassification, version: null };
    }
    return { classification: 'handler-component', version: null };
  }

  type PageInfo = {
    key: keyof HandlerUrls;
    label: string;
    url: string;
    classification: PageClassification;
    version: number | null;
    versionStatus: string;
    versionChangelogs: { version: number; changelog: string }[];
  };

  let latestVersions: Map<string, { version: number; changelogs: Record<number, string> }> | null = null;
  let selectedKey: string | null = null;

  runAsynchronously(
    fetch(`${apiBaseUrl}/api/latest/internal/component-versions`)
      .then((r) => r.json())
      .then((data) => {
        latestVersions = new Map(Object.entries(data.versions ?? {}));
        renderSidebar();
      })
      .catch(() => {})
  );

  function buildPages(): PageInfo[] {
    return PAGE_ENTRIES.map((entry) => {
      const { classification, version } = classifyPage(entry.key);
      let versionStatus = 'current';
      let versionChangelogs: { version: number; changelog: string }[] = [];

      if (classification === 'custom' && version != null && latestVersions) {
        const info = latestVersions.get(entry.key as string);
        if (info && version < info.version) {
          versionStatus = 'outdated';
          versionChangelogs = Object.entries(info.changelogs)
            .map(([v, cl]) => ({ version: Number(v), changelog: cl }))
            .filter((e) => e.version > version)
            .sort((a, b) => a.version - b.version);
        }
      }

      return {
        key: entry.key,
        label: entry.label,
        url: (urls as any)[entry.key] || '',
        classification,
        version,
        versionStatus,
        versionChangelogs,
      };
    });
  }

  function getCompactUrl(url: string): string {
    const resolved = new URL(url, window.location.origin);
    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  }

  const sidebar = h('div', { className: 'sdt-pg-sidebar' });
  const mainArea = h('div', { className: 'sdt-pg-main' });

  function renderSidebar() {
    sidebar.innerHTML = '';
    const pages = buildPages();
    const outdatedCount = pages.filter((p) => p.versionStatus === 'outdated').length;

    const head = h('div', { className: 'sdt-pg-sidebar-head' });
    head.appendChild(h('span', { className: 'sdt-pg-sidebar-title' }, 'Pages'));
    head.appendChild(h('span', { className: 'sdt-pg-sidebar-count' }, String(pages.length)));
    if (outdatedCount > 0) {
      head.appendChild(h('span', { className: 'sdt-pg-sidebar-warn' }, `${outdatedCount} outdated`));
    }
    sidebar.appendChild(head);

    const list = h('div', { className: 'sdt-pg-list' });
    for (const page of pages) {
      const isOutdated = page.versionStatus === 'outdated';
      const item = h('div', {
        className: `sdt-pg-item ${isOutdated ? 'sdt-pg-item-warn' : ''}`,
        'data-selected': String(selectedKey === page.key),
      });
      const dotClass = isOutdated
        ? 'sdt-pg-item-dot-warn'
        : page.classification === 'custom'
          ? 'sdt-pg-item-dot-custom'
          : 'sdt-pg-item-dot-handler';
      item.appendChild(h('span', { className: `sdt-pg-item-dot ${dotClass}` }));
      item.appendChild(h('span', { className: 'sdt-pg-item-label' }, page.label));
      if (isOutdated) {
        item.appendChild(h('span', { className: 'sdt-pg-badge sdt-pg-badge-outdated' }, 'Outdated'));
      }
      item.addEventListener('click', () => {
        selectedKey = page.key as string;
        renderSidebar();
        renderDetail(page);
      });
      list.appendChild(item);
    }
    sidebar.appendChild(list);
  }

  function renderDetail(page: PageInfo) {
    mainArea.innerHTML = '';
    const detail = h('div', { className: 'sdt-pg-detail' });

    const header = h('div', { className: 'sdt-pg-header' });
    const headerTop = h('div', { className: 'sdt-pg-header-top' });
    headerTop.appendChild(h('h3', { className: 'sdt-pg-title' }, `${page.label} Page`));
    headerTop.appendChild(h('a', { href: page.url, target: '_blank', rel: 'noopener noreferrer', className: 'sdt-pg-title-url' }, getCompactUrl(page.url)));
    if (page.versionStatus === 'outdated') {
      headerTop.appendChild(h('span', { className: 'sdt-pg-badge sdt-pg-badge-outdated' }, 'Outdated'));
    }
    header.appendChild(headerTop);

    const redirectMethod = `stackApp.redirectTo${(page.key as string).charAt(0).toUpperCase()}${(page.key as string).slice(1)}()`;
    const codeRow = h('div', { className: 'sdt-pg-code-inline' });
    codeRow.appendChild(h('code', { className: 'sdt-pg-code' }, redirectMethod));
    const openBtn = h('button', { className: 'sdt-pg-copy-btn sdt-pg-open-btn' });
    setHtml(openBtn, 'Open <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17L17 7"/><path d="M7 7h10v10"/></svg>');
    openBtn.addEventListener('click', () => {
      const resolved = new URL(page.url, window.location.origin);
      window.open(resolved.toString(), '_blank', 'noopener,noreferrer');
    });
    codeRow.appendChild(openBtn);
    header.appendChild(codeRow);
    detail.appendChild(header);

    const prompt = getPagePrompt(page.key as string, page.version ?? undefined);
    if (prompt) {
      const isOutdated = page.versionStatus === 'outdated';
      const showPrompt = page.classification === 'handler-component' || page.classification === 'hosted' || isOutdated;
      if (showPrompt) {
        let promptText: string;
        if (isOutdated && prompt.upgradePrompt) {
          promptText = prompt.upgradePrompt;
        } else if (prompt.fullPrompt) {
          promptText = prompt.fullPrompt;
        } else {
          promptText = '';
        }

        if (promptText) {
          const section = h('div', { className: 'sdt-pg-section' });
          section.appendChild(h('div', { className: 'sdt-pg-section-label' }, isOutdated ? 'Use this prompt to upgrade your component:' : 'Want to customize this page? Paste this prompt into your coding agent.'));
          section.appendChild(h('pre', { className: 'sdt-pg-pre' }, promptText));
          const footer = h('div', { className: 'sdt-pg-section-footer' });
          const copyBtn = h('button', { className: 'sdt-pg-copy-btn' }, 'Copy prompt');
          copyBtn.addEventListener('click', () => {
            runAsynchronously(navigator.clipboard.writeText(promptText).then(() => {
              copyBtn.textContent = '\u2713 Copied';
              setTimeout(() => {
                copyBtn.textContent = 'Copy prompt';
              }, 1500);
            }));
          });
          footer.appendChild(copyBtn);
          section.appendChild(footer);
          detail.appendChild(section);
        }
      }
    }

    mainArea.appendChild(detail);
  }

  function renderEmptyMain() {
    mainArea.innerHTML = '';
    const empty = h('div', { className: 'sdt-pg-empty' });
    const icon = h('div', { className: 'sdt-pg-empty-icon' });
    setHtml(icon, '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>');
    empty.appendChild(icon);
    empty.appendChild(h('div', { className: 'sdt-pg-empty-text' }, 'Select a page to inspect'));
    empty.appendChild(h('div', { className: 'sdt-pg-empty-sub' }, 'View configuration, preview, and upgrade prompts'));
    mainArea.appendChild(empty);
  }

  renderSidebar();
  renderEmptyMain();

  container.append(sidebar, mainArea);
  return container;
}

// ---------------------------------------------------------------------------
// Panel (main shell with tab bar and content area)
// ---------------------------------------------------------------------------

function createPanel(
  app: StackClientApp<true>,
  state: ReturnType<typeof createStateStore>,
  logStore: LogStore,
  onClose: () => void,
): { element: HTMLElement, cleanup: () => void } {
  const panel = h('div', { className: 'sdt-panel' });
  let panelAnimationTimeout: ReturnType<typeof setTimeout> | null = null;

  function animateNextPanelGeometryChange() {
    panel.classList.add('sdt-panel-geometry-animated');
    if (panelAnimationTimeout !== null) {
      clearTimeout(panelAnimationTimeout);
    }
    panelAnimationTimeout = setTimeout(() => {
      panel.classList.remove('sdt-panel-geometry-animated');
      panelAnimationTimeout = null;
    }, 220);
  }

  function applyPanelMode(tabId: TabId, opts?: { animate?: boolean }) {
    if (opts?.animate === true) {
      animateNextPanelGeometryChange();
    }

    panel.classList.toggle('sdt-panel-heatmap', tabId === 'heatmaps');
    if (tabId === 'dashboard') {
      panel.classList.add('sdt-panel-fullscreen');
      panel.style.width = '';
      panel.style.height = '';
      return;
    }

    panel.classList.remove('sdt-panel-fullscreen');
    if (tabId === 'heatmaps') {
      panel.style.width = '';
      panel.style.height = '';
      return;
    }
    panel.style.width = state.get().panelWidth + 'px';
    panel.style.height = state.get().panelHeight + 'px';
  }

  const tabs = getTabsForApp(app);
  const storedActiveTab = state.get().activeTab;
  const activeTab = tabs.some((tab) => tab.id === storedActiveTab) ? storedActiveTab : DEFAULT_STATE.activeTab;
  let lastNonHeatmapTab: TabId = activeTab === 'heatmaps' ? 'overview' : activeTab;

  applyPanelMode(activeTab);

  const inner = h('div', { className: 'sdt-panel-inner' });

  const closeBtn = h('button', { className: 'sdt-close-btn', 'aria-label': 'Close' });
  setHtml(closeBtn, '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="3" x2="11" y2="11"/><line x1="11" y1="3" x2="3" y2="11"/></svg>');
  closeBtn.addEventListener('click', onClose);

  const docsLink = h('a', { href: DOCS_URL, target: '_blank', rel: 'noopener noreferrer', className: 'sdt-docs-link' });
  docsLink.appendChild(document.createTextNode('Docs'));
  const docsIcon = h('span', { className: 'sdt-docs-link-icon', 'aria-hidden': 'true' });
  setHtml(docsIcon, '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17L17 7"/><path d="M7 7h10v10"/></svg>');
  docsLink.appendChild(docsIcon);

  const trailingControls = h('div', { className: 'sdt-tabbar-actions' }, docsLink, closeBtn);

  const tabBar = createTabBar(tabs, activeTab, (id) => {
    if (id !== 'heatmaps') {
      lastNonHeatmapTab = id as TabId;
    }
    state.update({ activeTab: id as TabId });
    applyPanelMode(id as TabId, { animate: true });
    showTab(id as TabId);
  }, { trailing: trailingControls });
  inner.appendChild(tabBar.el);

  const content = h('div', { className: 'sdt-content' });
  const layers = h('div', { className: 'sdt-tab-layers' });
  content.appendChild(layers);
  inner.appendChild(content);

  const mountedPanes = new Map<TabId, HTMLElement>();
  const cleanups: Array<() => void> = [];

  function mountTab(pane: HTMLElement, result: TabResult | HTMLElement) {
    if ('element' in result) {
      pane.appendChild(result.element);
      if (result.cleanup) {
        cleanups.push(result.cleanup);
      }
    } else {
      pane.appendChild(result);
    }
  }

  let heatmapsCleanup: (() => void) | null = null;
  // The heatmaps tab installs global click/key blockers, an overlay root, a
  // MutationObserver, and background polling. Unlike other panes it must not be
  // cached-and-hidden: tear it down (running its cleanup) whenever we leave it,
  // so the page isn't left interaction-blocked with work still running.
  function teardownHeatmapsPane() {
    const pane = mountedPanes.get('heatmaps');
    if (pane == null) return;
    if (heatmapsCleanup != null) {
      heatmapsCleanup();
      heatmapsCleanup = null;
    }
    pane.remove();
    mountedPanes.delete('heatmaps');
  }

  function getOrCreatePane(tabId: TabId): HTMLElement {
    if (mountedPanes.has(tabId)) {
      return mountedPanes.get(tabId)!;
    }
    const pane = h('div', { className: 'sdt-tab-pane' });
    if (tabId === 'dashboard') {
      pane.classList.add('sdt-tab-pane-iframe');
    }
    switch (tabId) {
      case 'overview': {
        mountTab(pane, createOverviewTab(app));
        break;
      }
      case 'heatmaps': {
        const result = createHeatmapsTab(app, () => {
          state.update({ activeTab: lastNonHeatmapTab });
          applyPanelMode(lastNonHeatmapTab, { animate: true });
          showTab(lastNonHeatmapTab);
        });
        pane.appendChild(result.element);
        // Tracked separately from `cleanups` so it can run on tab-switch, not just unmount.
        heatmapsCleanup = result.cleanup ?? null;
        break;
      }
      case 'customize': {
        mountTab(pane, createComponentsTab(app));
        break;
      }
      case 'ai': {
        mountTab(pane, createAITab(app));
        break;
      }
      case 'console': {
        mountTab(pane, createConsoleTab(logStore));
        break;
      }
      case 'dashboard': {
        mountTab(pane, createDashboardTab(app));
        break;
      }
      case 'support': {
        mountTab(pane, createSupportTab(app));
        break;
      }
    }
    mountedPanes.set(tabId, pane);
    layers.appendChild(pane);
    return pane;
  }

  function showTab(tabId: TabId) {
    if (tabId !== 'heatmaps') {
      teardownHeatmapsPane();
    }
    const pane = getOrCreatePane(tabId);
    tabBar.setActive(tabId);
    for (const [, p] of mountedPanes) {
      p.classList.remove('sdt-tab-pane-active');
    }
    pane.classList.add('sdt-tab-pane-active');
  }

  showTab(activeTab);

  function addResizeHandle(edge: 'top' | 'left' | 'top-left') {
    const handle = h('div', { className: `sdt-resize-handle sdt-resize-${edge}` });
    let startX = 0;
    let startY = 0;
    let startW = 0;
    let startH = 0;

    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (panelAnimationTimeout !== null) {
        clearTimeout(panelAnimationTimeout);
        panelAnimationTimeout = null;
      }
      panel.classList.remove('sdt-panel-geometry-animated');
      handle.setPointerCapture(e.pointerId);
      startX = e.clientX;
      startY = e.clientY;
      startW = panel.offsetWidth;
      startH = panel.offsetHeight;
    });

    handle.addEventListener('pointermove', (e) => {
      if (!handle.hasPointerCapture(e.pointerId)) return;
      const dx = startX - e.clientX;
      const dy = startY - e.clientY;
      if (edge === 'left' || edge === 'top-left') {
        const newW = Math.max(400, Math.min(startW + dx, window.innerWidth - 32));
        panel.style.width = newW + 'px';
      }
      if (edge === 'top' || edge === 'top-left') {
        const newH = Math.max(300, Math.min(startH + dy, window.innerHeight - 80));
        panel.style.height = newH + 'px';
      }
    });

    handle.addEventListener('pointerup', (e) => {
      handle.releasePointerCapture(e.pointerId);
      state.update({ panelWidth: panel.offsetWidth, panelHeight: panel.offsetHeight });
    });

    panel.appendChild(handle);
  }

  addResizeHandle('top');
  addResizeHandle('left');
  addResizeHandle('top-left');

  panel.appendChild(inner);
  return {
    element: panel,
    cleanup: () => {
      if (panelAnimationTimeout !== null) {
        clearTimeout(panelAnimationTimeout);
      }
      teardownHeatmapsPane();
      for (const fn of cleanups) fn();
    },
  };
}

// ===========================================================================================
// Main entry point
// ===========================================================================================

export function createDevTool(app: StackClientApp<true>): () => void {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    return () => {};
  }
  const body = Reflect.get(document, 'body');
  if (!hasAppendChild(body)) return () => {};

  getGlobalDevToolInstance()?.cleanup();
  let existingRoot = document.getElementById(ROOT_ID);
  while (existingRoot !== null) {
    existingRoot.remove();
    existingRoot = document.getElementById(ROOT_ID);
  }

  const root = document.createElement('div');
  root.id = ROOT_ID;
  body.appendChild(root);

  const wrapper = h('div', { className: 'stack-devtool' });
  root.appendChild(wrapper);

  const style = document.createElement('style');
  style.textContent = devToolCSS;
  wrapper.appendChild(style);

  const state = createStateStore();
  const logStore = getGlobalLogStore();

  let panel: { element: HTMLElement, cleanup: () => void } | null = null;

  function closePanelAndPersistClosed() {
    closePanel();
  }

  function openPanel() {
    if (panel) return;
    panel = createPanel(app, state, logStore, closePanelAndPersistClosed);
    wrapper.appendChild(panel.element);
  }

  function openHeatmapPanel() {
    state.update({ activeTab: 'heatmaps', isOpen: true });
    if (panel) {
      const currentPanel = panel;
      panel = null;
      currentPanel.cleanup();
      currentPanel.element.remove();
    }
    openPanel();
  }

  function closePanel() {
    if (!panel) return;
    state.update({ isOpen: false });
    const closing = panel;
    panel = null;
    closing.cleanup();
    closing.element.classList.add('sdt-panel-exiting');
    setTimeout(() => {
      if (wrapper.contains(closing.element)) {
        wrapper.removeChild(closing.element);
      }
    }, 150);
  }

  function togglePanel() {
    if (state.get().isOpen) {
      closePanel();
    } else {
      state.update({ isOpen: true });
      openPanel();
    }
  }

  const trigger = createTrigger(togglePanel);
  wrapper.appendChild(trigger.element);

  // Resume the heatmap panel after a Cmd+click hard navigation. The handler
  // that performed the redirect drops a sentinel into sessionStorage; if it's
  // present here, restore the heatmap tab as the active one and reopen the
  // panel so the user picks up where they left off.
  let shouldResumeHeatmap = false;
  try {
    if (sessionStorage.getItem('hexclave-heatmap-overlay-resume') === '1') {
      shouldResumeHeatmap = true;
      sessionStorage.removeItem('hexclave-heatmap-overlay-resume');
    }
  } catch {
    // ignore
  }
  if (shouldResumeHeatmap) {
    state.update({ activeTab: 'heatmaps', isOpen: true });
  }

  if (state.get().isOpen) {
    openPanel();
  }

  window.addEventListener('hexclave:heatmap-token-updated', openHeatmapPanel);

  const removeRequestListener = app[stackAppInternalsSymbol].addRequestListener((entry: RequestLogEntry) => {
    const timestamp = Date.now();
    logStore.addApiLog({
      id: nextId(),
      timestamp,
      method: entry.method,
      url: entry.path,
      status: entry.status,
      duration: entry.duration,
      error: entry.error,
    });
    if (entry.error) {
      logStore.addEventLog({ id: nextId(), timestamp, type: 'error', message: `Network error on ${entry.method} ${entry.path}: ${entry.error}` });
    } else if (entry.status && entry.status >= 400) {
      logStore.addEventLog({ id: nextId(), timestamp, type: 'error', message: `API error ${entry.status} on ${entry.method} ${entry.path}` });
    }
  });

  let didCleanup = false;
  const instance: DevToolGlobalInstance = {
    cleanup: () => {
      if (didCleanup) return;
      didCleanup = true;
      if (getGlobalDevToolInstance() === instance) {
        setGlobalDevToolInstance(null);
      }
      trigger.cleanup();
      window.removeEventListener('hexclave:heatmap-token-updated', openHeatmapPanel);
      removeRequestListener();
      panel?.cleanup();
      if (root.parentNode) {
        root.parentNode.removeChild(root);
      }
    },
  };
  setGlobalDevToolInstance(instance);

  return () => {
    instance.cleanup();
  };
}

// END_PLATFORM
