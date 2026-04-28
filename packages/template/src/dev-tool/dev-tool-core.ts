// IF_PLATFORM js-like

import type { RequestLogEntry } from "@stackframe/stack-shared/dist/interface/client-interface";
import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";
import { isLocalhost } from "@stackframe/stack-shared/dist/utils/urls";
import { envVars } from "../lib/env";
import type { StackClientApp } from "../lib/stack-app";
import { getBaseUrl } from "../lib/stack-app/apps/implementations/common";
import type { HandlerUrlOptions, HandlerUrls, HandlerUrlTarget } from "../lib/stack-app/common";
import { stackAppInternalsSymbol } from "../lib/stack-app/common";
import { getPagePrompt } from "../lib/stack-app/url-targets";
import { devToolCSS } from "./dev-tool-styles";
import type { TriggerPlacement } from "./dev-tool-trigger-position";
import { clampTriggerPosition, getSnappedTriggerPlacement, resolveTriggerPosition } from "./dev-tool-trigger-position";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TabId = 'overview' | 'components' | 'ai' | 'docs' | 'dashboard' | 'console' | 'support';

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

type ConsoleSubTab = 'logs' | 'config';
type SupportSubTab = 'feedback' | 'feature-requests';

type DevToolState = {
  isOpen: boolean;
  activeTab: TabId;
  consoleSubTab: ConsoleSubTab;
  panelWidth: number;
  panelHeight: number;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_KEY = '__stack-dev-tool-state';
const TRIGGER_POS_KEY = 'stack-devtool-trigger-position';
const MAX_LOG_ENTRIES = 500;
const DRAG_THRESHOLD = 5;

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'overview', label: 'Overview', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>' },
  { id: 'components', label: 'Components', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>' },
  { id: 'ai', label: 'AI', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>' },
  { id: 'console', label: 'Console', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>' },
  { id: 'docs', label: 'Docs', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>' },
  { id: 'dashboard', label: 'Dashboard', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>' },
  { id: 'support', label: 'Support', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>' },
];

const DEFAULT_STATE: DevToolState = {
  isOpen: false,
  activeTab: 'overview',
  consoleSubTab: 'logs',
  panelWidth: 800,
  panelHeight: 520,
};

const STACK_LOGO_SVG = '<svg width="14" height="17" viewBox="0 0 131 156" fill="currentColor"><path d="M124.447 28.6459L70.1382 1.75616C67.3472 0.374284 64.0715 0.372197 61.279 1.75051L0.740967 31.6281V87.6369L65.7101 119.91L117.56 93.675V112.414L65.7101 138.44L0.740967 106.584V119.655C0.740967 122.359 2.28151 124.827 4.71097 126.015L62.282 154.161C65.0966 155.538 68.3938 155.515 71.1888 154.099L130.47 124.074V79.7105C130.47 74.8003 125.34 71.5769 120.915 73.7077L79.4531 93.675V75.9771L130.47 50.1589V38.3485C130.47 34.2325 128.137 30.4724 124.447 28.6459Z"/></svg>';

// ---------------------------------------------------------------------------
// State management
// ---------------------------------------------------------------------------

function loadState(): DevToolState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return { ...DEFAULT_STATE, ...JSON.parse(stored) };
    }
  } catch {}
  return { ...DEFAULT_STATE };
}

function saveState(state: DevToolState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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
    return 'https://app.stack-auth.com';
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
  return `dev-${id}@test.stack-auth.com`;
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
// Trigger button (draggable pill)
// ---------------------------------------------------------------------------

function createTrigger(onClick: () => void): HTMLElement {
  type Position = { left: number; top: number };
  type Placement = TriggerPlacement;
  const triggerSize = { width: 76, height: 36 };

  const defaultPos = (): Position => ({
    left: window.innerWidth - 76 - 16,
    top: window.innerHeight - 36 - 16,
  });

  function isPosition(value: unknown): value is Position {
    if (typeof value !== 'object' || value === null) return false;
    return typeof Reflect.get(value, 'left') === 'number' && typeof Reflect.get(value, 'top') === 'number';
  }

  function isPlacement(value: unknown): value is Placement {
    if (typeof value !== 'object' || value === null) return false;
    const side = Reflect.get(value, 'side');
    return ['left', 'right', 'top', 'bottom'].includes(String(side)) && typeof Reflect.get(value, 'offset') === 'number';
  }

  function loadPlacement(): Placement | null {
    try {
      const raw = localStorage.getItem(TRIGGER_POS_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (isPlacement(parsed)) return parsed;
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

  function applyPos(nextPos: Position) {
    pos = nextPos;
    btn.style.left = pos.left + 'px';
    btn.style.top = pos.top + 'px';
  }

  const btn = h('button', { className: 'sdt-trigger', 'aria-label': 'Toggle Stack Auth Dev Tools', title: 'Stack Auth Dev Tools' });
  const logoSpan = h('span', { className: 'sdt-trigger-logo' });
  setHtml(logoSpan, STACK_LOGO_SVG);
  btn.appendChild(logoSpan);
  btn.appendChild(h('span', { className: 'sdt-trigger-text' }, 'DEV'));

  let placement = loadPlacement() ?? getSnappedTriggerPlacement(defaultPos(), triggerSize, { width: window.innerWidth, height: window.innerHeight });
  let pos = resolveTriggerPosition(placement, triggerSize, { width: window.innerWidth, height: window.innerHeight });
  applyPos(pos);

  let dragState: { startX: number; startY: number; startLeft: number; startTop: number; didDrag: boolean } | null = null;

  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
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
      applyPos(resolveTriggerPosition(placement, triggerSize, { width: window.innerWidth, height: window.innerHeight }));
      savePlacement(placement);
    } else {
      onClick();
    }
  });

  window.addEventListener('resize', () => {
    const resizedPos = resolveTriggerPosition(placement, triggerSize, { width: window.innerWidth, height: window.innerHeight });
    if (resizedPos.left !== pos.left || resizedPos.top !== pos.top) {
      applyPos(resizedPos);
      placement = getSnappedTriggerPlacement(pos, triggerSize, { width: window.innerWidth, height: window.innerHeight });
      savePlacement(placement);
    }
  });

  return btn;
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

function createIframeTab(src: string, title: string, loadingMsg = 'Loading\u2026', errorMsg = 'Unable to load content', errorDetail?: string): HTMLElement {
  const container = h('div', { className: 'sdt-iframe-container' });
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
      container.innerHTML = '';
      container.appendChild(createIframeTab(src, title, loadingMsg, errorMsg, errorDetail));
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

function createOverviewTab(app: StackClientApp<true>): TabResult {
  const container = h('div', { className: 'sdt-ov' });
  const apiBaseUrl = resolveApiBaseUrl(app);

  // -- User hero card --
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

  async function refreshUser() {
    try {
      currentUser = await app.getUser();
    } catch {
      currentUser = null;
    }
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
    rebuildActions();
    buildChecklist();
  }

  heroCard.append(actions, toast);
  runAsynchronously(refreshUser());
  const userPoll = setInterval(() => {
    runAsynchronously(refreshUser());
  }, 3000);

  // -- Project info card --
  const projectCard = h('div', { className: 'sdt-ov-card sdt-ov-card-project' });
  projectCard.appendChild(h('div', { className: 'sdt-ov-label' }, 'Project'));
  const projectRows = h('div', { className: 'sdt-ov-project-rows' });

  const sdkVersion = app.version;
  const projectId = app.projectId;

  function addProjectRow(key: string, val: string | HTMLElement) {
    const row = h('div', { className: 'sdt-ov-project-row' });
    row.appendChild(h('span', { className: 'sdt-ov-project-key' }, key));
    const valEl = h('span', { className: 'sdt-ov-project-val' });
    if (typeof val === 'string') {
      valEl.textContent = val;
    } else {
      valEl.appendChild(val);
    }
    row.appendChild(valEl);
    projectRows.appendChild(row);
  }

  const sdkValSpan = h('span', null, sdkVersion || '?');
  addProjectRow('SDK', sdkValSpan);

  // Check latest version
  const parsed = sdkVersion.match(/(@[\w-]+\/[\w-]+)@(\d+\.\d+\.\d+)/);
  if (parsed) {
    runAsynchronously(
      fetch(`https://registry.npmjs.org/${parsed[1]}/latest`)
        .then((r) => r.json())
        .then((data) => {
          if (data.version) {
            const pa = parsed[2].split('.').map(Number);
            const pb = data.version.split('.').map(Number);
            let outdated = false;
            for (let i = 0; i < 3; i++) {
              if (pa[i] !== pb[i]) {
                outdated = pa[i] < pb[i];
                break;
              }
            }
            if (outdated) {
              const badge = h('span', { className: 'sdt-ov-sdk-badge', title: `Latest: ${data.version}` }, 'Outdated');
              sdkValSpan.parentElement!.appendChild(badge);
            }
          }
        })
    );
  }

  const idValSpan = h('span', { className: 'sdt-ov-project-val-mono' }, projectId || 'N/A');
  addProjectRow('Project ID', idValSpan);

  const envVal = h('span', { className: 'sdt-ov-env-val' });
  const dot = h('span', { className: 'sdt-ov-pulse-dot' });
  envVal.append(dot, h('span', null, 'Development'));
  addProjectRow('Environment', envVal);

  projectCard.appendChild(projectRows);

  // -- Auth config card --
  const authCard = h('div', { className: 'sdt-ov-card sdt-ov-card-auth' });
  authCard.appendChild(h('div', { className: 'sdt-ov-label' }, 'Config'));
  const authGrid = h('div', { className: 'sdt-ov-auth-grid' });
  for (let i = 0; i < 3; i++) {
    authGrid.appendChild(h('div', { className: 'sdt-ov-method sdt-ov-skeleton-pill' }));
  }
  authCard.appendChild(authGrid);

  runAsynchronously(
    app.getProject().then((project: any) => {
      authGrid.innerHTML = '';
      const config = project.config;
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
    }).catch(() => {
      authGrid.innerHTML = '<div style="font-size:11px;color:var(--sdt-text-tertiary)">Could not load config</div>';
    })
  );

  // -- Checklist card --
  const checksCard = h('div', { className: 'sdt-ov-card sdt-ov-card-checks' });
  function buildChecklist() {
    checksCard.innerHTML = '';
    const checks = [
      { ok: !!projectId && projectId !== 'default', label: 'Project' },
      { ok: true, label: 'Provider' },
      { ok: !!currentUser, label: 'Auth' },
    ];
    const passCount = checks.filter((c) => c.ok).length;
    const allGood = passCount === checks.length;
    if (allGood) {
      checksCard.classList.add('sdt-ov-card-checks-ok');
    } else {
      checksCard.classList.remove('sdt-ov-card-checks-ok');
    }

    const header = h('div', { className: 'sdt-ov-checks-header' });
    header.appendChild(h('div', { className: 'sdt-ov-label', style: { marginBottom: '0' } }, 'Setup'));
    header.appendChild(h('span', { className: `sdt-ov-checks-badge ${allGood ? 'sdt-ov-checks-badge-ok' : 'sdt-ov-checks-badge-warn'}` }, allGood ? 'All good' : `${passCount}/${checks.length}`));
    checksCard.appendChild(header);

    const bar = h('div', { className: 'sdt-ov-checks-bar' });
    const fill = h('div', { className: 'sdt-ov-checks-bar-fill' });
    fill.style.width = `${(passCount / checks.length) * 100}%`;
    bar.appendChild(fill);
    checksCard.appendChild(bar);

    const checksRow = h('div', { className: 'sdt-ov-checks' });
    for (const c of checks) {
      const check = h('div', { className: `sdt-ov-check ${c.ok ? 'sdt-ov-check-ok' : 'sdt-ov-check-warn'}` });
      check.appendChild(h('span', { className: 'sdt-ov-check-icon' }, c.ok ? '\u2713' : '!'));
      check.appendChild(h('span', { className: 'sdt-ov-check-label' }, c.label));
      checksRow.appendChild(check);
    }
    checksCard.appendChild(checksRow);
  }
  buildChecklist();

  // -- Changelog card --
  const changelogCard = h('div', { className: 'sdt-ov-card sdt-ov-card-changelog' });
  changelogCard.appendChild(h('div', { className: 'sdt-ov-label' }, "What's New"));

  const changelogPath = '/api/latest/internal/changelog';
  const changelogContent = h('div', { className: 'sdt-ov-changelog-content' });
  changelogContent.innerHTML = '<div style="padding:12px 0;color:var(--sdt-text-tertiary);font-size:12px">Loading changelog...</div>';
  changelogCard.appendChild(changelogContent);

  runAsynchronously((async () => {
    let entries: any[] = [];
    try {
      const res = await fetch(apiBaseUrl + changelogPath);
      if (res.ok) {
        const data = await res.json();
        entries = data.entries ?? [];
      }
    } catch {}
    if (entries.length === 0) {
      try {
        const res = await fetch('https://api.stack-auth.com' + changelogPath);
        if (res.ok) {
          const data = await res.json();
          entries = data.entries ?? [];
        }
      } catch {}
    }

    changelogContent.innerHTML = '';
    if (entries.length === 0) {
      changelogContent.innerHTML = '<div style="padding:12px 0;color:var(--sdt-text-tertiary);font-size:12px">Could not load changelog.</div>';
      return;
    }

    const changelogDiv = h('div', { className: 'sdt-ov-changelog' });
    let expandedVersion: string | null = entries[0]?.version ?? null;

    function renderEntries() {
      changelogDiv.innerHTML = '';
      for (const entry of entries.slice(0, 5)) {
        const isExpanded = expandedVersion === entry.version;
        const release = h('div', { className: 'sdt-ov-release' });
        const head = h('div', { className: 'sdt-ov-release-head', style: { cursor: 'pointer' } });
        head.textContent = entry.version;
        if (entry.releasedAt) {
          head.appendChild(h('span', { className: 'sdt-ov-release-date' }, entry.releasedAt));
        }
        const arrow = h('span', { style: { marginLeft: 'auto', fontSize: '10px', color: 'var(--sdt-text-tertiary)' } }, isExpanded ? '\u25B2' : '\u25BC');
        head.appendChild(arrow);
        head.addEventListener('click', () => {
          expandedVersion = isExpanded ? null : entry.version;
          renderEntries();
        });
        release.appendChild(head);

        if (isExpanded && entry.markdown) {
          const body = h('div', { className: 'sdt-ov-release-body', style: { padding: '4px 0 8px' } });
          const lines = entry.markdown.split('\n');
          for (const line of lines) {
            const trimmedLine = line.trim();
            if (trimmedLine === '') continue;

            const image = parseMarkdownImage(trimmedLine);
            if (image) {
              const figure = h('figure', { className: 'sdt-ov-release-image-figure' });
              const imageLink = h('a', {
                className: 'sdt-ov-release-image-link',
                href: image.src,
                target: '_blank',
                rel: 'noopener noreferrer',
              });
              imageLink.appendChild(h('img', {
                className: 'sdt-ov-release-image',
                src: image.src,
                alt: image.alt,
                loading: 'lazy',
                decoding: 'async',
              }));
              figure.appendChild(imageLink);
              if (image.alt !== '') {
                figure.appendChild(h('figcaption', { className: 'sdt-ov-release-image-caption' }, image.alt));
              }
              body.appendChild(figure);
              continue;
            }

            const headingMatch = line.match(/^###\s+(.+)/);
            if (headingMatch) {
              const heading = h('div', { style: { fontWeight: '600', color: 'var(--sdt-text)', marginTop: '8px', marginBottom: '4px', fontSize: '12px' } });
              appendInlineMarkdown(heading, headingMatch[1]);
              body.appendChild(heading);
              continue;
            }
            if (line.startsWith('- ')) {
              const li = h('div', { style: { fontSize: '12px', color: 'var(--sdt-text-secondary)', lineHeight: '1.6', paddingLeft: '12px' } });
              li.appendChild(document.createTextNode('\u2022 '));
              appendInlineMarkdown(li, line.slice(2));
              body.appendChild(li);
              continue;
            }
            const paragraph = h('div', { style: { fontSize: '12px', color: 'var(--sdt-text-secondary)', lineHeight: '1.6' } });
            appendInlineMarkdown(paragraph, line);
            body.appendChild(paragraph);
          }
          release.appendChild(body);
        }
        changelogDiv.appendChild(release);
      }
    }
    renderEntries();
    changelogContent.appendChild(changelogDiv);
  })());

  const allReleasesLink = h('a', { className: 'sdt-ov-all-releases', href: 'https://github.com/stack-auth/stack/releases', target: '_blank', rel: 'noopener noreferrer' });
  setHtml(allReleasesLink, 'All releases <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/></svg>');
  changelogCard.appendChild(allReleasesLink);

  container.append(heroCard, projectCard, authCard, checksCard, changelogCard);

  return { element: container, cleanup: () => clearInterval(userPoll) };
}

// ---------------------------------------------------------------------------
// Console tab
// ---------------------------------------------------------------------------

function createConsoleTab(app: StackClientApp<true>, logStore: LogStore, state: ReturnType<typeof createStateStore>): TabResult {
  const container = h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%' } });

  const EVENT_TYPE_STYLES: Record<string, string> = {
    'error': 'sdt-badge-error',
    'info': 'sdt-badge-info',
  };

  const trailingBtns = h('div', { style: { display: 'flex', gap: '4px' } });
  const exportBtn = h('button', { className: 'sdt-close-btn', title: 'Export logs & config', style: { fontSize: '11px', width: 'auto', padding: '0 8px' } });
  setHtml(exportBtn, '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>Export');
  const clearBtn = h('button', { className: 'sdt-close-btn', title: 'Clear logs', style: { fontSize: '11px', width: 'auto', padding: '0 8px' } }, 'Clear');
  clearBtn.addEventListener('click', () => logStore.clear());
  trailingBtns.append(exportBtn, clearBtn);

  const subTabBar = createTabBar(
    [{ id: 'logs', label: 'Logs' }, { id: 'config', label: 'Config' }],
    state.get().consoleSubTab,
    (id) => {
      state.update({ consoleSubTab: id as ConsoleSubTab });
      renderSubTab();
    },
    { variant: 'pills', trailing: trailingBtns },
  );
  container.appendChild(h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' } }, subTabBar.el));

  const contentArea = h('div', { className: 'sdt-tab-content-fade', style: { flex: '1', overflow: 'auto' } });
  container.appendChild(contentArea);

  function renderLogs() {
    contentArea.innerHTML = '';
    const merged = [
      ...logStore.apiLogs.map((e) => ({ kind: 'api' as const, entry: e })),
      ...logStore.eventLogs.map((e) => ({ kind: 'event' as const, entry: e })),
    ].sort((a, b) => b.entry.timestamp - a.entry.timestamp);

    if (merged.length === 0) {
      contentArea.innerHTML = '<div class="sdt-empty-state"><div class="sdt-empty-state-icon">\uD83D\uDCCB</div><div>No logs recorded yet</div><div style="font-size:12px;color:var(--sdt-text-tertiary)">API calls and auth events will appear here</div></div>';
      return;
    }

    const list = h('div', { className: 'sdt-log-list' });
    for (const item of merged) {
      if (item.kind === 'api') {
        const log = item.entry as ApiLogEntry;
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
        list.appendChild(row);
      } else {
        const log = item.entry as EventLogEntry;
        const row = h('div', { className: 'sdt-log-item' });
        row.appendChild(h('span', { className: 'sdt-log-time' }, formatTimestamp(log.timestamp)));
        row.appendChild(h('span', { className: `sdt-badge ${EVENT_TYPE_STYLES[log.type] || 'sdt-badge-info'}` }, log.type));
        row.appendChild(h('span', { className: 'sdt-log-message' }, log.message));
        list.appendChild(row);
      }
    }
    contentArea.appendChild(list);
  }

  function renderConfig() {
    contentArea.innerHTML = '<div style="padding:12px 0;color:var(--sdt-text-tertiary);font-size:12px">Loading config...</div>';
    runAsynchronously(
      app.getProject().then((project: any) => {
        contentArea.innerHTML = '';
        const table = h('table', { className: 'sdt-config-table' });
        const tbody = h('tbody', null);
        const items: [string, string][] = [
          ['Project ID', project.id],
          ['Display Name', project.displayName],
          ['Sign-Up Enabled', String(project.config.signUpEnabled)],
          ['Credential Auth', String(project.config.credentialEnabled)],
          ['Magic Link', String(project.config.magicLinkEnabled)],
          ['Passkey', String(project.config.passkeyEnabled)],
          ['Client Team Creation', String(project.config.clientTeamCreationEnabled)],
          ['Client User Deletion', String(project.config.clientUserDeletionEnabled)],
          ['User API Keys', String(project.config.allowUserApiKeys)],
          ['Team API Keys', String(project.config.allowTeamApiKeys)],
          ['OAuth Providers', project.config.oauthProviders.length > 0 ? project.config.oauthProviders.map((p: any) => p.id).join(', ') : 'None'],
        ];
        for (const [label, value] of items) {
          const tr = h('tr', null);
          tr.appendChild(h('td', null, label));
          const td = h('td', null);
          if (value === 'true') {
            setHtml(td, '<span style="color:var(--sdt-success)">Enabled</span>');
          } else if (value === 'false') {
            setHtml(td, '<span style="color:var(--sdt-text-tertiary)">Disabled</span>');
          } else {
            td.textContent = value;
          }
          tr.appendChild(td);
          tbody.appendChild(tr);
        }
        table.appendChild(tbody);
        contentArea.appendChild(table);
      }).catch(() => {
        contentArea.innerHTML = '<div style="padding:12px 0;color:var(--sdt-text-tertiary);font-size:12px">Could not load config.</div>';
      })
    );
  }

  function renderSubTab() {
    subTabBar.setActive(state.get().consoleSubTab);
    clearBtn.style.display = state.get().consoleSubTab === 'logs' ? '' : 'none';
    if (state.get().consoleSubTab === 'logs') {
      renderLogs();
    } else {
      renderConfig();
    }
  }

  renderSubTab();

  exportBtn.addEventListener('click', () => {
    const lines: string[] = [];
    lines.push('=== Stack Auth Dev Tool Report ===');
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push('');
    for (const log of logStore.apiLogs.slice(0, 50)) {
      const status = log.status !== undefined ? ` [${log.status}]` : '';
      const duration = log.duration !== undefined ? ` ${log.duration}ms` : '';
      lines.push(`${new Date(log.timestamp).toISOString()} ${log.method} ${log.url}${status}${duration}`);
    }
    runAsynchronously(
      navigator.clipboard.writeText(lines.join('\n')).then(() => {
        exportBtn.textContent = '\u2713 Copied';
        setTimeout(() => {
          setHtml(exportBtn, '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>Export');
        }, 1500);
      })
    );
  });

  const unsub = logStore.subscribe(() => {
    if (state.get().consoleSubTab === 'logs') {
      renderLogs();
    }
  });

  return { element: container, cleanup: unsub };
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
    const headers: Record<string, string> = {
      'X-Stack-Access-Type': 'client',
      'X-Stack-Project-Id': app.projectId,
    };
    if ('publishableClientKey' in opts && opts.publishableClientKey) {
      headers['X-Stack-Publishable-Client-Key'] = opts.publishableClientKey as string;
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
      empty.appendChild(h('div', { className: 'sdt-ai-empty-desc' }, 'Get help with Stack Auth integration, troubleshooting, and best practices.'));

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
    placeholder: 'Ask anything about Stack Auth...',
    autocomplete: 'off',
    autocorrect: 'off',
    spellcheck: 'false',
  }) as HTMLInputElement;
  const sendBtn = h('button', { className: 'sdt-ai-send-btn', title: 'Send' });
  setHtml(sendBtn, '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>');

  function renderInput() {
    input.disabled = false;
    input.placeholder = messages.length === 0 ? 'Ask anything about Stack Auth...' : 'Ask a follow-up...';
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
// Docs tab
// ---------------------------------------------------------------------------

function createDocsTab(): HTMLElement {
  return createIframeTab('https://docs.stack-auth.com', 'Stack Auth Documentation', 'Loading documentation\u2026', 'Unable to load documentation');
}

// ---------------------------------------------------------------------------
// Dashboard tab
// ---------------------------------------------------------------------------

function createDashboardTab(app: StackClientApp<true>): HTMLElement {
  const dashboardUrl = resolveDashboardUrl(app);
  const isLocalEmulator = envVars.NEXT_PUBLIC_STACK_IS_LOCAL_EMULATOR === 'true';

  if (!isLocalEmulator) {
    const ctr = h('div', { className: 'sdt-iframe-container', style: { display: 'flex', alignItems: 'center', justifyContent: 'center' } });
    const inner = h('div', { style: { textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'center' } });
    inner.appendChild(h('a', { href: dashboardUrl, target: '_blank', rel: 'noopener noreferrer', className: 'sdt-iframe-error-btn', style: { textDecoration: 'none' } }, 'Open Dashboard in New Tab'));
    ctr.appendChild(inner);
    return ctr;
  }

  return createIframeTab(dashboardUrl, 'Stack Auth Dashboard', 'Loading dashboard\u2026', 'Unable to load dashboard', 'The dashboard may require authentication or block framing');
}

// ---------------------------------------------------------------------------
// Support tab
// ---------------------------------------------------------------------------

function createSupportTab(app: StackClientApp<true>): HTMLElement {
  const container = h('div', { className: 'sdt-support-tab' });
  const apiBaseUrl = resolveApiBaseUrl(app);

  let subTab: SupportSubTab = 'feedback';
  const contentArea = h('div', { className: 'sdt-support-content' });

  const subTabBar = createTabBar(
    [{ id: 'feedback', label: 'Feedback' }, { id: 'feature-requests', label: 'Feature Requests' }],
    subTab,
    (id) => {
      subTab = id as SupportSubTab;
      subTabBar.setActive(subTab);
      renderSubTab();
    },
    { variant: 'pills' },
  );
  container.appendChild(subTabBar.el);
  container.appendChild(contentArea);

  let feedbackPane: HTMLElement | null = null;
  let featurePane: HTMLElement | null = null;

  function renderSubTab() {
    contentArea.innerHTML = '';
    if (subTab === 'feedback') {
      if (!feedbackPane) {
        feedbackPane = createFeedbackForm();
      }
      contentArea.appendChild(feedbackPane);
    } else {
      if (!featurePane) {
        featurePane = h('div', { className: 'sdt-support-iframe-pane' });
        featurePane.appendChild(createIframeTab('https://feedback.stack-auth.com', 'Stack Auth Feature Requests', 'Loading feature requests\u2026', 'Unable to load feature requests'));
      }
      contentArea.appendChild(featurePane);
    }
  }

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
      setHtml(submitBtn, '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5m-7 7l7-7 7 7"/></svg> Submit');
      submitBtn.disabled = status === 'submitting';
      form.appendChild(submitBtn);

      const channels = h('div', { className: 'sdt-support-channels' });
      channels.innerHTML = `
        <a href="https://discord.stack-auth.com" target="_blank" rel="noopener noreferrer" class="sdt-support-channel">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>
          <span>Discord</span>
        </a>
        <a href="mailto:team@stack-auth.com" class="sdt-support-channel">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
          <span>Email</span>
        </a>
        <a href="https://github.com/stack-auth/stack-auth" target="_blank" rel="noopener noreferrer" class="sdt-support-channel">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"/></svg>
          <span>GitHub</span>
        </a>`;
      form.appendChild(channels);
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

  renderSubTab();
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
    { key: 'mfa' as any, label: 'MFA' },
    { key: 'onboarding' as any, label: 'Onboarding' },
    { key: 'error' as any, label: 'Error' },
  ];

  type PageClassification = 'handler-component' | 'hosted' | 'custom';

  const classificationLabel: Record<PageClassification, string> = {
    'handler-component': 'Handler',
    'hosted': 'Hosted',
    'custom': 'Custom',
  };

  const classificationBadgeClass: Record<PageClassification, string> = {
    'handler-component': 'sdt-pg-badge-handler',
    'hosted': 'sdt-pg-badge-hosted',
    'custom': 'sdt-pg-badge-custom',
  };

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
      } else {
        item.appendChild(h('span', { className: `sdt-pg-badge ${classificationBadgeClass[page.classification]}` }, classificationLabel[page.classification]));
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
    if (page.versionStatus === 'outdated') {
      headerTop.appendChild(h('span', { className: 'sdt-pg-badge sdt-pg-badge-outdated' }, 'Outdated'));
    }
    headerTop.appendChild(h('span', { className: `sdt-pg-badge ${classificationBadgeClass[page.classification]}` }, classificationLabel[page.classification]));
    header.appendChild(headerTop);

    const redirectMethod = `stackApp.redirectTo${(page.key as string).charAt(0).toUpperCase()}${(page.key as string).slice(1)}()`;
    const codeRow = h('div', { className: 'sdt-pg-code-inline' });
    codeRow.appendChild(h('code', { className: 'sdt-pg-code' }, redirectMethod));
    const viewBtn = h('button', { className: 'sdt-pg-copy-btn' }, 'View');
    viewBtn.addEventListener('click', () => {
      const resolved = new URL(page.url, window.location.origin);
      if (resolved.origin === window.location.origin) {
        window.location.href = resolved.toString();
      } else {
        window.open(resolved.toString(), '_blank', 'noopener,noreferrer');
      }
    });
    codeRow.appendChild(viewBtn);
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
          section.appendChild(h('div', { className: 'sdt-pg-section-label' }, isOutdated ? 'Use this prompt to upgrade your component:' : 'Customization prompt:'));
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

    const urlRow = h('div', { className: 'sdt-pg-url-row' });
    urlRow.appendChild(h('span', { className: 'sdt-pg-url-label' }, 'URL'));
    urlRow.appendChild(h('a', { href: page.url, target: '_blank', rel: 'noopener noreferrer', className: 'sdt-pg-url' }, page.url));
    detail.appendChild(urlRow);

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
  panel.style.width = state.get().panelWidth + 'px';
  panel.style.height = state.get().panelHeight + 'px';

  const inner = h('div', { className: 'sdt-panel-inner' });

  const closeBtn = h('button', { className: 'sdt-close-btn', 'aria-label': 'Close' });
  setHtml(closeBtn, '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="3" x2="11" y2="11"/><line x1="11" y1="3" x2="3" y2="11"/></svg>');
  closeBtn.addEventListener('click', onClose);

  const tabBar = createTabBar(TABS, state.get().activeTab, (id) => {
    state.update({ activeTab: id as TabId });
    showTab(id as TabId);
  }, { trailing: closeBtn });
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

  function getOrCreatePane(tabId: TabId): HTMLElement {
    if (mountedPanes.has(tabId)) {
      return mountedPanes.get(tabId)!;
    }
    const pane = h('div', { className: 'sdt-tab-pane' });
    switch (tabId) {
      case 'overview': {
        mountTab(pane, createOverviewTab(app));
        break;
      }
      case 'components': {
        mountTab(pane, createComponentsTab(app));
        break;
      }
      case 'ai': {
        mountTab(pane, createAITab(app));
        break;
      }
      case 'console': {
        mountTab(pane, createConsoleTab(app, logStore, state));
        break;
      }
      case 'docs': {
        mountTab(pane, createDocsTab());
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
    const pane = getOrCreatePane(tabId);
    tabBar.setActive(tabId);
    for (const [, p] of mountedPanes) {
      p.classList.remove('sdt-tab-pane-active');
    }
    pane.classList.add('sdt-tab-pane-active');
  }

  showTab(state.get().activeTab);

  function addResizeHandle(edge: 'top' | 'left' | 'top-left') {
    const handle = h('div', { className: `sdt-resize-handle sdt-resize-${edge}` });
    let startX = 0;
    let startY = 0;
    let startW = 0;
    let startH = 0;

    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
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

  const root = document.createElement('div');
  root.id = '__stack-dev-tool-root';
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
    state.update({ isOpen: false });
    closePanel();
  }

  function openPanel() {
    if (panel) return;
    panel = createPanel(app, state, logStore, closePanelAndPersistClosed);
    wrapper.appendChild(panel.element);
  }

  function closePanel() {
    if (!panel) return;
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
      state.update({ isOpen: false });
      closePanel();
    } else {
      state.update({ isOpen: true });
      openPanel();
    }
  }

  const trigger = createTrigger(togglePanel);
  wrapper.appendChild(trigger);

  if (state.get().isOpen) {
    openPanel();
  }

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

  return () => {
    removeRequestListener();
    panel?.cleanup();
    if (root.parentNode) {
      root.parentNode.removeChild(root);
    }
  };
}

// END_PLATFORM
