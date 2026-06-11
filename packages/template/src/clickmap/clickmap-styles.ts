// CSS for the standalone clickmap overlay.
//
// The clickmap is fully independent from the dev tool: it ships its own
// stylesheet and panel chrome so the dev tool (and its stylesheet) can be
// removed without affecting the clickmap. Class names keep the shared `sdt-`
// prefix on purpose — the analytics ingest/query layers exclude self-clicks by
// that prefix (see @hexclave/shared/dist/utils/dev-tool).
// Uses the .hexclave-clickmap scope to avoid conflicts with host app styles.
// Design tokens + base reset come from the shared in-page-ui module.

import { getInPageUiBaseCSS } from "../in-page-ui/base-styles";

export const clickmapCSS = getInPageUiBaseCSS('.hexclave-clickmap') + `
  /* Bottom-centered floating panel (the clickmap's only chrome) */
  .hexclave-clickmap .sdt-hm-panel {
    position: fixed;
    left: 50%;
    bottom: 18px;
    z-index: 2147483647;
    width: min(680px, calc(100vw - 24px));
    max-width: calc(100vw - 24px);
    max-height: calc(100vh - 36px);
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    overflow: visible;
  }

  .hexclave-clickmap .sdt-hm-panel-inner {
    display: flex;
    flex-direction: column;
    width: 100%;
    animation: sdt-hm-panel-enter 0.2s ease-out;
  }

  @keyframes sdt-hm-panel-enter {
    from {
      opacity: 0;
      transform: scale(0.95) translateY(8px);
    }
    to {
      opacity: 1;
      transform: scale(1) translateY(0);
    }
  }

  /* --- Clickmaps --- */

  .hexclave-clickmap .sdt-hm {
    height: auto;
    display: flex;
    flex-direction: column;
    gap: 8px;
    overflow: visible;
    background: transparent;
  }

  .hexclave-clickmap .sdt-hm-toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 44px;
    padding: 6px 8px;
    border: 1px solid var(--sdt-border);
    border-radius: 999px;
    background: var(--sdt-overlay-bg);
    box-shadow: 0 18px 48px rgba(0, 0, 0, 0.24);
    backdrop-filter: blur(18px);
  }

  .hexclave-clickmap .sdt-hm-toolbar-title {
    flex-shrink: 0;
    padding-left: 2px;
    font-size: 13px;
    font-weight: 650;
    color: var(--sdt-text);
    line-height: 1.1;
  }

  .hexclave-clickmap .sdt-hm-toolbar-filters {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .hexclave-clickmap .sdt-hm-toolbar-filters .sdt-hm-filter-input {
    height: 28px;
    border-radius: 999px;
    font-size: 11.5px;
  }

  .hexclave-clickmap .sdt-hm-toolbar-filters > .sdt-hm-filter-input {
    flex-shrink: 0;
    width: auto;
    max-width: 120px;
    padding-right: 4px;
  }

  .hexclave-clickmap .sdt-hm-toolbar-url {
    position: relative;
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .hexclave-clickmap .sdt-hm-toolbar-url .sdt-hm-filter-input {
    flex: 1;
  }

  .hexclave-clickmap .sdt-hm-mode {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 2px;
    border-radius: 999px;
    background: var(--sdt-bg-elevated);
    border: 1px solid var(--sdt-border-subtle);
  }

  .hexclave-clickmap .sdt-hm-mode-btn {
    min-width: 24px;
    height: 20px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: var(--sdt-text-tertiary);
    padding: 0 7px;
    font: inherit;
    font-family: var(--sdt-font-mono, ui-monospace, monospace);
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
  }

  .hexclave-clickmap .sdt-hm-mode-btn:not(.sdt-hm-mode-btn-active):hover {
    color: var(--sdt-text);
  }

  .hexclave-clickmap .sdt-hm-mode-btn-active {
    background: var(--sdt-accent);
    color: white;
  }

  .hexclave-clickmap .sdt-hm-filter-input-error,
  .hexclave-clickmap .sdt-hm-filter-input-error:focus {
    border-color: var(--sdt-error);
  }

  .hexclave-clickmap .sdt-hm-filter-info {
    flex-shrink: 0;
    width: 20px;
    height: 20px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: var(--sdt-text-tertiary);
    cursor: pointer;
    padding: 0;
  }

  .hexclave-clickmap .sdt-hm-filter-info:hover,
  .hexclave-clickmap .sdt-hm-filter-info[aria-expanded="true"] {
    background: var(--sdt-bg-hover);
    color: var(--sdt-text);
  }

  .hexclave-clickmap .sdt-hm-url-help {
    display: none;
    position: absolute;
    bottom: calc(100% + 10px);
    right: 0;
    z-index: 2;
    width: 320px;
    max-width: min(320px, calc(100vw - 32px));
    box-sizing: border-box;
    padding: 14px;
    border: 1px solid var(--sdt-border);
    border-radius: var(--sdt-radius-lg);
    background: var(--sdt-bg);
    box-shadow: 0 18px 48px rgba(0, 0, 0, 0.28);
    backdrop-filter: blur(18px);
    cursor: default;
  }

  .hexclave-clickmap .sdt-hm-url-help-open {
    display: block;
  }

  .hexclave-clickmap .sdt-hm-url-help-title {
    font-size: 12px;
    font-weight: 650;
    color: var(--sdt-text);
    margin-bottom: 6px;
  }

  .hexclave-clickmap .sdt-hm-url-help-body {
    font-size: 11.5px;
    line-height: 1.5;
    color: var(--sdt-text-secondary);
  }

  .hexclave-clickmap .sdt-hm-url-help-rows {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid var(--sdt-border-subtle);
  }

  .hexclave-clickmap .sdt-hm-url-help-row {
    display: flex;
    align-items: baseline;
    gap: 10px;
  }

  .hexclave-clickmap .sdt-hm-url-help-code {
    flex-shrink: 0;
    border-radius: var(--sdt-radius);
    background: var(--sdt-bg-elevated);
    border: 1px solid var(--sdt-border-subtle);
    padding: 1px 6px;
    font-family: var(--sdt-font-mono, ui-monospace, monospace);
    font-size: 11px;
    color: var(--sdt-text);
    white-space: nowrap;
  }

  .hexclave-clickmap .sdt-hm-url-help-desc {
    font-size: 11px;
    line-height: 1.4;
    color: var(--sdt-text-secondary);
  }

  .hexclave-clickmap .sdt-hm-toolbar-metrics {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 4px;
  }

  .hexclave-clickmap .sdt-hm-toolbar-metric {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--sdt-text-secondary);
  }

  .hexclave-clickmap .sdt-hm-toolbar-metric-value {
    font-size: 12px;
    font-weight: 700;
    color: var(--sdt-text);
    font-variant-numeric: tabular-nums;
  }

  .hexclave-clickmap .sdt-hm-toolbar-metric-icon {
    display: inline-flex;
    align-items: center;
    color: var(--sdt-text-tertiary);
  }

  .hexclave-clickmap .sdt-hm-icon-btn {
    width: 32px;
    height: 32px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: var(--sdt-text-secondary);
    cursor: pointer;
  }

  .hexclave-clickmap .sdt-hm-icon-btn:hover {
    background: var(--sdt-bg-hover);
    color: var(--sdt-text);
  }

  .hexclave-clickmap .sdt-hm-details {
    display: none;
    max-height: min(460px, calc(100vh - 98px));
    overflow: hidden;
    border: 1px solid var(--sdt-border);
    border-radius: var(--sdt-radius-lg);
    background: var(--sdt-bg);
    box-shadow: 0 18px 48px rgba(0, 0, 0, 0.22);
  }

  .hexclave-clickmap .sdt-hm-expanded .sdt-hm-details {
    display: flex;
    flex-direction: column;
  }

  .hexclave-clickmap .sdt-hm-head {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 16px;
    border-bottom: 1px solid var(--sdt-border-subtle);
  }

  .hexclave-clickmap .sdt-hm-filters {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .hexclave-clickmap .sdt-hm-filter-row {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }

  .hexclave-clickmap .sdt-hm-seg {
    position: relative;
    display: flex;
    align-items: stretch;
    gap: 2px;
    height: 30px;
    padding: 3px;
    border-radius: var(--sdt-radius);
    border: 1px solid var(--sdt-border-subtle);
    background: var(--sdt-bg-elevated);
    box-sizing: border-box;
  }

  .hexclave-clickmap .sdt-hm-seg-thumb {
    position: absolute;
    top: 3px;
    left: 0;
    bottom: 3px;
    width: 0;
    border-radius: calc(var(--sdt-radius) - 2px);
    background: var(--sdt-bg);
    border: 1px solid var(--sdt-border);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
    transform: translateX(0);
    transition: transform 220ms cubic-bezier(0.22, 1, 0.36, 1), width 220ms cubic-bezier(0.22, 1, 0.36, 1);
    pointer-events: none;
  }

  .hexclave-clickmap .sdt-hm-seg-btn {
    position: relative;
    z-index: 1;
    flex: 1 1 0;
    min-width: 0;
    border: 0;
    background: transparent;
    color: var(--sdt-text-tertiary);
    font: inherit;
    font-family: var(--sdt-font);
    font-size: 11px;
    font-weight: 600;
    line-height: 1;
    padding: 0 4px;
    border-radius: calc(var(--sdt-radius) - 2px);
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    transition: color 160ms ease;
  }

  .hexclave-clickmap .sdt-hm-seg-btn:hover {
    color: var(--sdt-text-secondary);
  }

  .hexclave-clickmap .sdt-hm-seg-btn[aria-checked="true"] {
    color: var(--sdt-text);
  }

  .hexclave-clickmap .sdt-hm-seg-btn:focus-visible {
    outline: 2px solid var(--sdt-accent);
    outline-offset: -2px;
  }

  @media (prefers-reduced-motion: reduce) {
    .hexclave-clickmap .sdt-hm-seg-thumb {
      transition: none;
    }
  }

  .hexclave-clickmap .sdt-hm-filter-field {
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
  }

  .hexclave-clickmap .sdt-hm-filter-label-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    min-height: 13px;
  }

  .hexclave-clickmap .sdt-hm-filter-label {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--sdt-text-tertiary);
  }

  .hexclave-clickmap .sdt-hm-filter-reset {
    display: none;
    flex-shrink: 0;
    width: 20px;
    height: 20px;
    align-items: center;
    justify-content: center;
    border: 0;
    border-radius: 999px;
    background: transparent;
    padding: 0;
    color: var(--sdt-accent);
    cursor: pointer;
  }

  .hexclave-clickmap .sdt-hm-filter-reset:hover {
    background: var(--sdt-bg-hover);
    color: var(--sdt-accent-hover);
  }

  .hexclave-clickmap .sdt-hm-filter-reset-visible {
    display: inline-flex;
  }

  .hexclave-clickmap .sdt-hm-filter-input {
    height: 30px;
    border-radius: var(--sdt-radius);
    border: 1px solid var(--sdt-border-subtle);
    background: var(--sdt-bg-elevated);
    color: var(--sdt-text);
    padding: 0 9px;
    font: inherit;
    font-size: 12px;
    font-family: var(--sdt-font);
    min-width: 0;
    width: 100%;
    box-sizing: border-box;
  }

  .hexclave-clickmap .sdt-hm-filter-input:focus {
    outline: none;
    border-color: var(--sdt-accent);
  }

  .hexclave-clickmap .sdt-hm-actions {
    display: flex;
    align-items: stretch;
    gap: 10px;
  }

  .hexclave-clickmap .sdt-hm-actions .sdt-hm-btn {
    height: auto;
    flex-shrink: 0;
    white-space: nowrap;
    padding: 0 16px;
  }

  .hexclave-clickmap .sdt-hm-btn {
    height: 30px;
    border-radius: var(--sdt-radius);
    border: 1px solid var(--sdt-border-subtle);
    background: var(--sdt-bg-elevated);
    color: var(--sdt-text-secondary);
    padding: 0 10px;
    font: inherit;
    font-size: 12px;
    cursor: pointer;
    transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
  }

  .hexclave-clickmap .sdt-hm-btn:hover {
    background: var(--sdt-bg-hover);
    color: var(--sdt-text);
    transition: none;
  }

  .hexclave-clickmap .sdt-hm-btn-primary {
    background: var(--sdt-accent);
    border-color: var(--sdt-accent);
    color: white;
  }

  .hexclave-clickmap .sdt-hm-btn-primary:hover {
    background: var(--sdt-accent);
    border-color: var(--sdt-accent);
    color: white;
    transition: none;
  }

  .hexclave-clickmap .sdt-hm-stats {
    flex: 1;
    min-width: 0;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
  }

  .hexclave-clickmap .sdt-hm-stat {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    border-radius: var(--sdt-radius);
    background: var(--sdt-bg-elevated);
    padding: 7px 10px;
  }

  .hexclave-clickmap .sdt-hm-stat-label {
    font-size: 9.5px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--sdt-text-tertiary);
  }

  .hexclave-clickmap .sdt-hm-stat-value {
    font-size: 15px;
    font-weight: 650;
    color: var(--sdt-text);
    font-variant-numeric: tabular-nums;
  }

  .hexclave-clickmap .sdt-hm-body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px 16px 14px;
  }

  .hexclave-clickmap .sdt-hm-token-status {
    color: var(--sdt-text-secondary);
    padding: 0 2px;
    font-size: 11.5px;
    line-height: 1.45;
  }

  .hexclave-clickmap .sdt-hm-token-status-error {
    color: var(--sdt-error);
  }

  .hexclave-clickmap .sdt-hm-viewport-warning {
    display: none;
    gap: 8px;
    padding: 10px;
    border-radius: var(--sdt-radius);
    border: 1px solid rgba(234, 179, 8, 0.24);
    background: var(--sdt-warning-muted);
    color: var(--sdt-text);
  }

  .hexclave-clickmap .sdt-hm-viewport-warning-visible {
    display: flex;
    flex-direction: column;
  }

  .hexclave-clickmap .sdt-hm-viewport-warning-title {
    font-size: 12px;
    font-weight: 650;
    color: var(--sdt-text);
    line-height: 1.2;
  }

  .hexclave-clickmap .sdt-hm-viewport-warning-body {
    font-size: 11.5px;
    line-height: 1.45;
    color: var(--sdt-text-secondary);
  }

  .hexclave-clickmap .sdt-hm-viewport-warning-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .hexclave-clickmap .sdt-hm-viewport-warning-action {
    min-width: 0;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border-radius: var(--sdt-radius);
    border: 1px solid var(--sdt-border-subtle);
    background: var(--sdt-bg-elevated);
    padding: 4px 5px 4px 8px;
  }

  .hexclave-clickmap .sdt-hm-viewport-warning-label {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--sdt-text-tertiary);
  }

  .hexclave-clickmap .sdt-hm-viewport-warning-code {
    font-family: var(--sdt-font-mono);
    font-size: 11.5px;
    font-weight: 650;
    color: var(--sdt-text);
    font-variant-numeric: tabular-nums;
  }

  .hexclave-clickmap .sdt-hm-copy-btn {
    height: 22px;
    border: 1px solid var(--sdt-border-subtle);
    border-radius: 999px;
    background: var(--sdt-bg);
    color: var(--sdt-text-secondary);
    padding: 0 8px;
    font: inherit;
    font-size: 10.5px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
  }

  .hexclave-clickmap .sdt-hm-copy-btn:hover {
    background: var(--sdt-bg-hover);
    border-color: var(--sdt-border);
    color: var(--sdt-text);
    transition: none;
  }

  .hexclave-clickmap .sdt-hm-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .hexclave-clickmap .sdt-hm-empty {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 140px;
    border-radius: var(--sdt-radius);
    border: 1px dashed var(--sdt-border);
    color: var(--sdt-text-tertiary);
    font-size: 12px;
    text-align: center;
    padding: 0 16px;
  }

  .hexclave-clickmap .sdt-hm-row {
    width: 100%;
    display: grid;
    grid-template-columns: 42px minmax(0, 1fr);
    align-items: center;
    gap: 10px;
    border: 0;
    border-radius: var(--sdt-radius);
    background: transparent;
    color: var(--sdt-text);
    padding: 8px;
    text-align: left;
    cursor: pointer;
    font-family: var(--sdt-font);
    user-select: none;
  }

  .hexclave-clickmap .sdt-hm-row:hover {
    background: var(--sdt-bg-hover);
    transition: none;
  }

  .hexclave-clickmap .sdt-hm-row:focus-visible {
    outline: 2px solid var(--sdt-accent);
    outline-offset: 2px;
  }

  .hexclave-clickmap .sdt-hm-row-muted {
    opacity: 0.52;
  }

  .hexclave-clickmap .sdt-hm-row-highlighted {
    background: rgba(250, 204, 21, 0.12);
  }

  .hexclave-clickmap .sdt-hm-row-count {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 34px;
    height: 24px;
    border-radius: 999px;
    background: var(--sdt-accent-muted);
    color: var(--sdt-accent-hover);
    border: 0;
    appearance: none;
    padding: 0;
    font-size: 12px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    font-family: var(--sdt-font);
    cursor: pointer;
  }

  .hexclave-clickmap .sdt-hm-row-count:hover {
    background: var(--sdt-bg-hover);
    color: var(--sdt-text);
    transition: none;
  }

  .hexclave-clickmap .sdt-hm-row-count[aria-pressed="true"] {
    background: var(--sdt-bg-elevated);
    color: var(--sdt-text-tertiary);
    text-decoration: line-through;
  }

  .hexclave-clickmap .sdt-hm-row-count:focus-visible {
    outline: 2px solid var(--sdt-accent);
    outline-offset: 2px;
  }

  .hexclave-clickmap .sdt-hm-row-meta {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .hexclave-clickmap .sdt-hm-row-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
    font-weight: 600;
  }

  .hexclave-clickmap .sdt-hm-row-selector {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--sdt-font-mono);
    font-size: 10.5px;
    color: var(--sdt-text-tertiary);
  }

  .sdt-hm-overlay-root {
    position: fixed;
    inset: 0;
    z-index: 2147483646;
    pointer-events: none;
  }

  .sdt-hm-overlay-root .sdt-hm-marker {
    position: fixed;
    transform: translate(-50%, -50%);
    min-width: 28px;
    height: 24px;
    border-radius: 999px;
    padding: 0 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 0;
    color: rgba(10, 10, 11, 0.92);
    font: 700 12px/1 var(--sdt-font, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
    font-variant-numeric: tabular-nums;
    cursor: pointer;
    pointer-events: auto;
    transition: opacity 0.15s ease, transform 0.15s ease, filter 0.15s ease;
  }

  .sdt-hm-overlay-root .sdt-hm-marker:hover {
    transform: translate(-50%, -50%) scale(1.06);
    transition: none;
  }

  .sdt-hm-overlay-root .sdt-hm-marker-muted {
    opacity: 0.18;
    filter: saturate(0.25);
    text-decoration: line-through;
  }

  .sdt-hm-overlay-root .sdt-hm-marker-highlighted {
    transform: translate(-50%, -50%) scale(1.08);
  }

  .sdt-hm-overlay-root .sdt-hm-outline {
    position: fixed;
    border: 1px solid;
    border-radius: 4px;
    background: rgba(99, 102, 241, 0.04);
    transition: opacity 0.15s ease, background 0.15s ease, border-color 0.15s ease;
  }

  .sdt-hm-overlay-root .sdt-hm-outline-muted {
    opacity: 0;
  }

  .sdt-hm-overlay-root .sdt-hm-outline-highlighted {
    border-color: rgba(250, 204, 21, 0.92) !important;
  }

  .sdt-hm-overlay-root .sdt-hm-highlight {
    position: fixed;
    display: none;
    border-radius: 5px;
    background: rgba(250, 204, 21, 0.28);
    box-shadow: 0 0 0 1px rgba(250, 204, 21, 0.7), 0 0 0 9999px rgba(0, 0, 0, 0.04);
  }

  .sdt-hm-overlay-root .sdt-hm-highlight-visible {
    display: block;
  }
`;
