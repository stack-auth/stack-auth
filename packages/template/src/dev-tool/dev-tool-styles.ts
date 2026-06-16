// Theme-aware CSS for the dev tool indicator
// Respects Stack theme (data-stack-theme attribute) and system prefers-color-scheme
// Uses .hexclave-devtool scope to avoid conflicts with host app styles
// Design tokens + base reset come from the shared in-page-ui module.

import { getInPageUiBaseCSS } from "../in-page-ui/base-styles";

export const devToolCSS = getInPageUiBaseCSS('.hexclave-devtool') + `
  /* Trigger pill */
  .hexclave-devtool .sdt-trigger {
    position: fixed;
    z-index: 2147483647;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    padding: 0;
    background: var(--sdt-bg-elevated);
    border: 1px solid var(--sdt-border);
    border-radius: 10px;
    cursor: grab;
    box-shadow: var(--sdt-trigger-shadow);
    transition: background 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
    user-select: none;
    touch-action: none;
  }

  .hexclave-devtool .sdt-trigger-position-animated {
    transition: left 0.14s cubic-bezier(0.2, 0.8, 0.2, 1), top 0.14s cubic-bezier(0.2, 0.8, 0.2, 1), background 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
  }

  .hexclave-devtool .sdt-trigger:hover {
    background: var(--sdt-bg-hover);
    border-color: var(--sdt-accent);
    box-shadow: var(--sdt-trigger-shadow), 0 0 0 1px var(--sdt-accent);
  }

  .hexclave-devtool .sdt-trigger:active {
    cursor: grabbing;
  }

  .hexclave-devtool .sdt-trigger-logo {
    width: 22px;
    height: 22px;
    border-radius: 6px;
    background: var(--sdt-accent);
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    line-height: 0;
  }

  /* Panel overlay */
  .hexclave-devtool .sdt-panel {
    position: fixed;
    bottom: 60px;
    right: 16px;
    z-index: 2147483647;
    width: 800px;
    max-width: calc(100vw - 32px);
    height: 520px;
    max-height: calc(100vh - 80px);
    background: var(--sdt-bg);
    border: 1px solid var(--sdt-border);
    border-radius: var(--sdt-radius-lg);
    box-shadow: var(--sdt-shadow);
    display: flex;
    flex-direction: column;
    overflow: visible;
  }

  .hexclave-devtool .sdt-panel-geometry-animated {
    transition: width 0.18s cubic-bezier(0.2, 0.8, 0.2, 1),
                height 0.18s cubic-bezier(0.2, 0.8, 0.2, 1),
                right 0.18s cubic-bezier(0.2, 0.8, 0.2, 1),
                bottom 0.18s cubic-bezier(0.2, 0.8, 0.2, 1),
                border-radius 0.18s cubic-bezier(0.2, 0.8, 0.2, 1),
                border-color 0.18s cubic-bezier(0.2, 0.8, 0.2, 1);
  }

  .hexclave-devtool .sdt-panel-fullscreen {
    right: 0;
    bottom: 0;
    width: 100vw;
    max-width: none;
    height: 100vh;
    max-height: none;
    border: none;
    border-radius: 0;
  }

  .hexclave-devtool .sdt-panel-inner {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    overflow: hidden;
    border-radius: var(--sdt-radius-lg);
    animation: sdt-panel-enter 0.2s ease-out;
  }

  .hexclave-devtool .sdt-panel-fullscreen .sdt-panel-inner {
    border-radius: 0;
  }

  .hexclave-devtool .sdt-panel-fullscreen .sdt-resize-handle {
    display: none;
  }

  @keyframes sdt-panel-enter {
    from {
      opacity: 0;
      transform: scale(0.95) translateY(8px);
    }
    to {
      opacity: 1;
      transform: scale(1) translateY(0);
    }
  }

  .hexclave-devtool .sdt-panel-exiting {
    animation: sdt-panel-exit 0.15s ease-in forwards;
  }

  @keyframes sdt-panel-exit {
    from {
      opacity: 1;
      transform: scale(1) translateY(0);
    }
    to {
      opacity: 0;
      transform: scale(0.95) translateY(8px);
    }
  }

  /* Tab bar */
  .hexclave-devtool .sdt-tabbar {
    position: relative;
    display: flex;
    align-items: center;
    height: 44px;
    padding: 0 8px;
    background: var(--sdt-bg-subtle);
    border-bottom: 1px solid var(--sdt-border);
    flex-shrink: 0;
    gap: 2px;
    overflow-x: auto;
    overflow-y: hidden;
  }

  .hexclave-devtool .sdt-panel-fullscreen .sdt-tabbar {
    position: absolute;
    top: 8px;
    left: 8px;
    right: 8px;
    z-index: 2;
    background: var(--sdt-overlay-bg);
    border: 1px solid var(--sdt-border);
    border-radius: var(--sdt-radius);
    box-shadow: var(--sdt-trigger-shadow);
  }

  .hexclave-devtool .sdt-tab-indicator {
    position: absolute;
    top: 6px;
    left: 0;
    height: 32px;
    background: var(--sdt-bg-active);
    border-radius: var(--sdt-radius);
    transition: transform 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94),
                width 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94);
    pointer-events: none;
    z-index: 0;
  }

  .hexclave-devtool .sdt-tab {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: center;
    gap: 6px;
    height: 32px;
    padding: 0 12px;
    background: transparent;
    border: none;
    border-radius: var(--sdt-radius);
    cursor: pointer;
    font-family: var(--sdt-font);
    font-size: 12px;
    font-weight: 500;
    color: var(--sdt-text-secondary);
    transition: color 0.15s ease;
    white-space: nowrap;
    outline: none;
  }

  .hexclave-devtool .sdt-tab:hover {
    color: var(--sdt-text);
  }

  .hexclave-devtool .sdt-tab[data-active="true"] {
    color: var(--sdt-text);
  }

  .hexclave-devtool .sdt-tab-icon {
    width: 14px;
    height: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .hexclave-devtool .sdt-tabbar-spacer {
    flex: 1;
  }

  .hexclave-devtool .sdt-tabbar-actions {
    position: sticky;
    right: 0;
    z-index: 2;
    display: flex;
    align-items: center;
    align-self: stretch;
    gap: 4px;
    padding-left: 6px;
    background: inherit;
    flex-shrink: 0;
  }

  .hexclave-devtool .sdt-docs-link {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 28px;
    padding: 0 8px;
    color: var(--sdt-text-secondary);
    border-radius: var(--sdt-radius-sm);
    font-family: var(--sdt-font);
    font-size: 12px;
    font-weight: 500;
    line-height: 1;
    text-decoration: none;
    white-space: nowrap;
    transition: color 0.15s ease, background 0.15s ease;
  }

  .hexclave-devtool .sdt-docs-link:hover {
    color: var(--sdt-text);
    background: var(--sdt-bg-hover);
  }

  .hexclave-devtool .sdt-docs-link-icon {
    display: flex;
    width: 13px;
    height: 13px;
    line-height: 0;
  }

  .hexclave-devtool .sdt-close-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    background: transparent;
    border: none;
    border-radius: var(--sdt-radius-sm);
    cursor: pointer;
    color: var(--sdt-text-tertiary);
    transition: all 0.15s ease;
    flex-shrink: 0;
  }

  .hexclave-devtool .sdt-close-btn:hover {
    color: var(--sdt-text);
    background: var(--sdt-bg-hover);
  }

  /* Tab content area */
  .hexclave-devtool .sdt-content {
    flex: 1;
    position: relative;
    overflow: hidden;
    min-height: 0;
  }

  .hexclave-devtool .sdt-panel-fullscreen .sdt-content {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }

  .hexclave-devtool .sdt-tab-layers {
    position: absolute;
    inset: 0;
  }

  .hexclave-devtool .sdt-tab-pane {
    position: absolute;
    inset: 0;
    display: none;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 16px;
    background: var(--sdt-bg);
    opacity: 0;
    pointer-events: none;
    z-index: 0;
  }

  .hexclave-devtool .sdt-tab-pane-iframe {
    padding: 0;
    overflow: hidden;
  }

  .hexclave-devtool .sdt-tab-pane-active {
    display: block;
    opacity: 1;
    pointer-events: auto;
    z-index: 1;
  }

  /* ===== Overview tab — single column ===== */

  .hexclave-devtool .sdt-ov {
    display: flex;
    flex-direction: column;
    gap: 10px;
    max-width: 660px;
    margin: 0 auto;
  }

  /* Card base */
  .hexclave-devtool .sdt-ov-card {
    background: var(--sdt-bg-elevated);
    border: 1px solid var(--sdt-border-subtle);
    border-radius: 12px;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 0;
    transition: box-shadow 0.2s ease, border-color 0.2s ease;
    overflow: hidden;
    min-width: 0;
  }

  .hexclave-devtool .sdt-ov-card-hero {
    background: linear-gradient(135deg, rgba(99,102,241,0.04) 0%, transparent 50%), var(--sdt-bg-elevated);
  }

  .hexclave-devtool .sdt-ov-label {
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 1.2px;
    color: var(--sdt-text-tertiary);
    margin-bottom: 10px;
  }

  .hexclave-devtool .sdt-ov-user-row {
    display: flex;
    align-items: center;
    gap: 14px;
    margin-bottom: 14px;
  }

  .hexclave-devtool .sdt-ov-avatar {
    width: 52px;
    height: 52px;
    border-radius: 50%;
    background: var(--sdt-bg-hover);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 20px;
    font-weight: 700;
    color: var(--sdt-text-tertiary);
    flex-shrink: 0;
    border: 2px solid var(--sdt-border-subtle);
    overflow: hidden;
  }

  .hexclave-devtool .sdt-ov-avatar-active {
    background: var(--sdt-accent-muted);
    color: var(--sdt-accent);
    border-color: rgba(99,102,241,0.3);
  }

  .hexclave-devtool .sdt-ov-avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: 50%;
  }

  .hexclave-devtool .sdt-ov-user-meta {
    min-width: 0;
    flex: 1;
  }

  .hexclave-devtool .sdt-ov-user-name {
    font-size: 16px;
    font-weight: 700;
    color: var(--sdt-text);
    line-height: 1.2;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .hexclave-devtool .sdt-ov-user-email {
    font-size: 12px;
    font-family: var(--sdt-font-mono);
    color: var(--sdt-text-secondary);
    margin-top: 2px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .hexclave-devtool .sdt-ov-auth-indicator {
    display: flex;
    align-items: center;
    gap: 5px;
    margin-top: 5px;
    font-size: 11px;
    font-weight: 600;
    color: var(--sdt-success);
  }

  .hexclave-devtool .sdt-ov-auth-indicator::before {
    content: '';
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--sdt-success);
    box-shadow: 0 0 6px rgba(34,197,94,0.5);
  }

  /* Actions */
  .hexclave-devtool .sdt-ov-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 4px;
  }

  .hexclave-devtool .sdt-ov-btn {
    height: 30px;
    padding: 0 12px;
    border-radius: 6px;
    border: none;
    font-size: 12px;
    font-weight: 600;
    font-family: var(--sdt-font);
    cursor: pointer;
    transition: all 0.15s ease;
    white-space: nowrap;
  }
  .hexclave-devtool .sdt-ov-btn:disabled { opacity: 0.4; cursor: not-allowed; }

  .hexclave-devtool .sdt-ov-btn-primary {
    background: var(--sdt-accent);
    color: #fff;
  }
  .hexclave-devtool .sdt-ov-btn-primary:hover { background: var(--sdt-accent-hover); }

  .hexclave-devtool .sdt-ov-btn-secondary {
    background: var(--sdt-bg-hover);
    color: var(--sdt-text);
  }
  .hexclave-devtool .sdt-ov-btn-secondary:hover { background: var(--sdt-bg-active); }

  .hexclave-devtool .sdt-ov-btn-danger {
    background: var(--sdt-error-muted);
    color: var(--sdt-error);
    border: 1px solid rgba(239, 68, 68, 0.15);
  }
  .hexclave-devtool .sdt-ov-btn-danger:hover { background: rgba(239, 68, 68, 0.2); }

  .hexclave-devtool .sdt-ov-btn-wide { flex: 1; }

  .hexclave-devtool .sdt-ov-email-input {
    display: flex;
    flex: 1 1 180px;
    border: 1px solid var(--sdt-border-subtle);
    border-radius: 6px;
    overflow: hidden;
    background: var(--sdt-bg);
    transition: border-color 0.15s ease;
  }
  .hexclave-devtool .sdt-ov-email-input:focus-within {
    border-color: var(--sdt-accent);
    box-shadow: 0 0 0 2px var(--sdt-accent-muted);
  }
  .hexclave-devtool .sdt-ov-email-input input {
    flex: 1;
    height: 28px;
    padding: 0 8px;
    background: transparent;
    border: none;
    color: var(--sdt-text);
    font-size: 11px;
    font-family: var(--sdt-font);
    outline: none;
    min-width: 0;
  }
  .hexclave-devtool .sdt-ov-email-input input::placeholder { color: var(--sdt-text-tertiary); }
  .hexclave-devtool .sdt-ov-email-input button {
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-left: 1px solid var(--sdt-border-subtle);
    background: transparent;
    color: var(--sdt-accent);
    cursor: pointer;
    flex-shrink: 0;
    font-family: var(--sdt-font);
  }
  .hexclave-devtool .sdt-ov-email-input button:hover { background: var(--sdt-accent-muted); }
  .hexclave-devtool .sdt-ov-email-input button:disabled { opacity: 0.3; cursor: not-allowed; }

  .hexclave-devtool .sdt-ov-toast {
    font-size: 11px;
    padding: 5px 10px;
    border-radius: 6px;
    margin-top: 8px;
    line-height: 1.4;
  }
  .hexclave-devtool .sdt-ov-toast-success { background: var(--sdt-success-muted); color: var(--sdt-success); }
  .hexclave-devtool .sdt-ov-toast-error { background: var(--sdt-error-muted); color: var(--sdt-error); }

  /* --- Auth methods card --- */
  .hexclave-devtool .sdt-ov-card-auth {
    padding: 14px 16px;
  }

  .hexclave-devtool .sdt-ov-auth-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .hexclave-devtool .sdt-ov-method {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 4px 8px;
    border-radius: 6px;
    font-size: 11px;
    font-weight: 600;
    border: 1px solid var(--sdt-border-subtle);
    background: var(--sdt-bg);
    transition: all 0.15s ease;
  }

  .hexclave-devtool .sdt-ov-method-on {
    color: var(--sdt-text);
    background: var(--sdt-success-muted);
    border-color: rgba(34, 197, 94, 0.12);
  }

  .hexclave-devtool .sdt-ov-method-off {
    color: var(--sdt-text-tertiary);
    opacity: 0.5;
    border-style: dashed;
  }

  .hexclave-devtool .sdt-ov-method-oauth {
    text-transform: capitalize;
  }

  .hexclave-devtool .sdt-ov-method-warn {
    color: var(--sdt-warning);
    border-color: rgba(234, 179, 8, 0.2);
  }

  .hexclave-devtool .sdt-ov-skeleton-pill {
    width: 64px;
    height: 26px;
    border-radius: 6px;
    background: var(--sdt-bg-hover);
    border: 1px solid var(--sdt-border-subtle);
    animation: sdt-ov-shimmer 1.5s ease-in-out infinite;
  }

  @keyframes sdt-ov-shimmer {
    0%, 100% { opacity: 0.4; }
    50% { opacity: 0.7; }
  }

  /* --- Setup checklist card (only shown when something is incomplete) --- */
  .hexclave-devtool .sdt-ov-card-checks {
    padding: 14px 16px;
    border-color: rgba(234, 179, 8, 0.25);
  }

  .hexclave-devtool .sdt-ov-checks-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 8px;
  }

  .hexclave-devtool .sdt-ov-checks-badge {
    font-size: 10px;
    font-weight: 700;
    padding: 1px 6px;
    border-radius: 4px;
  }

  .hexclave-devtool .sdt-ov-checks-badge-ok {
    background: var(--sdt-success-muted);
    color: var(--sdt-success);
  }

  .hexclave-devtool .sdt-ov-checks-badge-warn {
    background: var(--sdt-warning-muted);
    color: var(--sdt-warning);
  }

  .hexclave-devtool .sdt-ov-checks-bar {
    height: 3px;
    border-radius: 2px;
    background: var(--sdt-border-subtle);
    margin-bottom: 10px;
    overflow: hidden;
  }

  .hexclave-devtool .sdt-ov-checks-bar-fill {
    height: 100%;
    border-radius: 2px;
    background: var(--sdt-warning);
    transition: width 0.4s ease;
  }

  .hexclave-devtool .sdt-ov-setup-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 0;
    font-size: 12px;
    border-bottom: 1px solid var(--sdt-border-subtle);
  }

  .hexclave-devtool .sdt-ov-setup-row:last-child { border-bottom: none; }

  .hexclave-devtool .sdt-ov-setup-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .hexclave-devtool .sdt-ov-setup-dot-ok { background: var(--sdt-success); }
  .hexclave-devtool .sdt-ov-setup-dot-warn { background: var(--sdt-warning); }

  .hexclave-devtool .sdt-ov-setup-label {
    color: var(--sdt-text);
    font-size: 12px;
  }

  .hexclave-devtool .sdt-ov-setup-hint {
    margin-left: auto;
    font-size: 11px;
    color: var(--sdt-text-tertiary);
  }

  /* Status badges (shared across tabs) */
  .hexclave-devtool .sdt-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 11px;
    font-weight: 500;
  }
  .hexclave-devtool .sdt-badge-success { background: var(--sdt-success-muted); color: var(--sdt-success); }
  .hexclave-devtool .sdt-badge-warning { background: var(--sdt-warning-muted); color: var(--sdt-warning); }
  .hexclave-devtool .sdt-badge-error { background: var(--sdt-error-muted); color: var(--sdt-error); }
  .hexclave-devtool .sdt-badge-info { background: var(--sdt-info-muted); color: var(--sdt-info); }

  /* ===== Components / Pages tab ===== */

  .hexclave-devtool .sdt-pg-layout {
    display: flex;
    height: calc(100% + 32px);
    margin: -16px;
  }

  /* --- Sidebar --- */
  .hexclave-devtool .sdt-pg-sidebar {
    width: 250px;
    flex-shrink: 0;
    border-right: 1px solid var(--sdt-border);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .hexclave-devtool .sdt-pg-sidebar-head {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 12px 14px 8px;
    flex-shrink: 0;
  }

  .hexclave-devtool .sdt-pg-sidebar-title {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: var(--sdt-text-tertiary);
  }

  .hexclave-devtool .sdt-pg-sidebar-count {
    font-size: 10px;
    font-weight: 700;
    color: var(--sdt-text-tertiary);
    background: var(--sdt-bg-active);
    padding: 0 5px;
    border-radius: 6px;
    line-height: 18px;
  }

  .hexclave-devtool .sdt-pg-sidebar-warn {
    margin-left: auto;
    font-size: 10px;
    font-weight: 700;
    color: var(--sdt-warning);
    background: var(--sdt-warning-muted);
    padding: 0 6px;
    border-radius: 6px;
    line-height: 18px;
  }

  .hexclave-devtool .sdt-pg-list {
    flex: 1;
    overflow-y: auto;
    padding: 0 6px 6px;
  }

  /* --- List item --- */
  .hexclave-devtool .sdt-pg-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 10px;
    border-radius: 6px;
    cursor: pointer;
    transition: background 0.12s ease;
    font-size: 13px;
    color: var(--sdt-text);
    position: relative;
  }

  .hexclave-devtool .sdt-pg-item:hover {
    background: var(--sdt-bg-hover);
  }

  .hexclave-devtool .sdt-pg-item[data-selected="true"] {
    background: var(--sdt-accent-muted);
  }

  .hexclave-devtool .sdt-pg-item[data-selected="true"] .sdt-pg-item-label {
    color: var(--sdt-accent-hover);
    font-weight: 600;
  }

  .hexclave-devtool .sdt-pg-item-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .hexclave-devtool .sdt-pg-item-dot-handler { background: var(--sdt-info); }
  .hexclave-devtool .sdt-pg-item-dot-custom { background: var(--sdt-success); }
  .hexclave-devtool .sdt-pg-item-dot-warn {
    background: var(--sdt-warning);
    box-shadow: 0 0 6px rgba(234, 179, 8, 0.4);
  }

  .hexclave-devtool .sdt-pg-item-label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* --- Badges --- */
  .hexclave-devtool .sdt-pg-badge {
    display: inline-flex;
    align-items: center;
    height: 20px;
    padding: 0 7px;
    border-radius: 10px;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.2px;
    flex-shrink: 0;
    line-height: 1;
  }

  .hexclave-devtool .sdt-pg-badge-outdated { background: var(--sdt-warning-muted); color: var(--sdt-warning); }

  /* --- Empty state --- */
  .hexclave-devtool .sdt-pg-empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    text-align: center;
  }

  .hexclave-devtool .sdt-pg-empty-icon {
    color: var(--sdt-text-tertiary);
    opacity: 0.35;
    margin-bottom: 4px;
  }

  .hexclave-devtool .sdt-pg-empty-text {
    font-size: 14px;
    font-weight: 600;
    color: var(--sdt-text-secondary);
  }

  .hexclave-devtool .sdt-pg-empty-sub {
    font-size: 12px;
    color: var(--sdt-text-tertiary);
  }

  /* --- Main panel --- */
  .hexclave-devtool .sdt-pg-main {
    flex: 1;
    overflow-y: auto;
    padding: 16px 18px;
    display: flex;
    flex-direction: column;
  }

  /* --- Detail view --- */
  .hexclave-devtool .sdt-pg-detail {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  /* Header */
  .hexclave-devtool .sdt-pg-header {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .hexclave-devtool .sdt-pg-header-top {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .hexclave-devtool .sdt-pg-title {
    font-size: 15px;
    font-weight: 700;
    margin: 0;
    color: var(--sdt-text);
  }

  .hexclave-devtool .sdt-pg-title-url {
    min-width: 0;
    max-width: 280px;
    color: var(--sdt-text-tertiary);
    font-family: var(--sdt-font-mono);
    font-size: 11px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-decoration: none;
  }

  .hexclave-devtool .sdt-pg-title-url:hover {
    color: var(--sdt-accent);
  }

  .hexclave-devtool .sdt-pg-subtitle {
    font-size: 12px;
    color: var(--sdt-text-secondary);
    line-height: 1.4;
  }

  .hexclave-devtool .sdt-pg-code-inline {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 4px;
  }

  .hexclave-devtool .sdt-pg-code {
    flex: 1;
    min-width: 0;
    font-family: var(--sdt-font-mono);
    font-size: 12px;
    color: var(--sdt-accent);
    background: var(--sdt-bg-elevated);
    border-radius: 6px;
    padding: 6px 10px;
    border: 1px solid var(--sdt-border-subtle);
  }

  /* --- Copy button --- */
  .hexclave-devtool .sdt-pg-copy-btn {
    height: 26px;
    padding: 0 10px;
    border-radius: 6px;
    border: 1px solid var(--sdt-border);
    background: var(--sdt-bg-active);
    color: var(--sdt-text-secondary);
    cursor: pointer;
    font-size: 11px;
    font-weight: 600;
    font-family: var(--sdt-font);
    transition: all 0.12s ease;
    flex-shrink: 0;
    white-space: nowrap;
  }

  .hexclave-devtool .sdt-pg-open-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    height: 32px;
    padding: 0 12px;
    font-size: 12px;
  }

  .hexclave-devtool .sdt-pg-open-btn svg {
    flex-shrink: 0;
  }

  .hexclave-devtool .sdt-pg-copy-btn:hover {
    background: var(--sdt-bg-hover);
    color: var(--sdt-text);
    border-color: var(--sdt-accent);
  }

  .hexclave-devtool .sdt-pg-copy-btn-ok {
    border-color: rgba(34, 197, 94, 0.3);
    color: var(--sdt-success);
    background: var(--sdt-success-muted);
  }

  /* --- Update banner --- */
  .hexclave-devtool .sdt-pg-update-banner {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 10px 14px;
    background: rgba(234, 179, 8, 0.08);
    border: 1px solid rgba(234, 179, 8, 0.3);
    border-radius: 10px;
  }

  .hexclave-devtool .sdt-pg-update-banner-icon {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: rgba(234, 179, 8, 0.2);
    color: var(--sdt-warning);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 800;
    flex-shrink: 0;
    margin-top: 1px;
  }

  .hexclave-devtool .sdt-pg-update-banner-body {
    flex: 1;
    min-width: 0;
  }

  .hexclave-devtool .sdt-pg-update-banner-title {
    font-size: 13px;
    font-weight: 700;
    color: var(--sdt-warning);
    margin-bottom: 2px;
  }

  .hexclave-devtool .sdt-pg-update-banner-text {
    font-size: 12px;
    color: var(--sdt-text-secondary);
    line-height: 1.5;
  }

  .hexclave-devtool .sdt-pg-update-banner-text strong {
    color: var(--sdt-text);
    font-weight: 600;
  }

  /* --- Sections (changelog, prompt) --- */
  .hexclave-devtool .sdt-pg-section {
    border: 1px solid var(--sdt-border-subtle);
    border-radius: 10px;
    padding: 12px 14px;
    background: var(--sdt-bg-elevated);
  }

  .hexclave-devtool .sdt-pg-section-warn {
    border-color: rgba(234, 179, 8, 0.25);
    background: rgba(234, 179, 8, 0.03);
  }

  .hexclave-devtool .sdt-pg-section-label {
    font-size: 12px;
    font-weight: 500;
    color: var(--sdt-text-secondary);
    margin-bottom: 8px;
  }

  .hexclave-devtool .sdt-pg-section-warn .sdt-pg-section-label {
    color: var(--sdt-warning);
  }

  .hexclave-devtool .sdt-pg-section-footer {
    display: flex;
    margin-top: 8px;
  }

  /* Changelog list */
  .hexclave-devtool .sdt-pg-changelog-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .hexclave-devtool .sdt-pg-changelog-item {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    font-size: 12px;
    color: var(--sdt-text);
    line-height: 1.5;
  }

  .hexclave-devtool .sdt-pg-changelog-bullet {
    flex-shrink: 0;
    font-size: 12px;
    line-height: 1.5;
  }

  /* Pre block */
  .hexclave-devtool .sdt-pg-pre {
    font-family: var(--sdt-font-mono);
    font-size: 11px;
    line-height: 1.6;
    color: var(--sdt-text);
    background: var(--sdt-bg);
    border-radius: 6px;
    padding: 10px 12px;
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 200px;
    overflow-y: auto;
    border: 1px solid var(--sdt-border-subtle);
  }

  .hexclave-devtool .sdt-preview-loading,
  .hexclave-devtool .sdt-preview-unavailable {
    font-size: 12px;
    color: var(--sdt-text-secondary);
    line-height: 1.5;
  }

  .hexclave-devtool .sdt-preview-error {
    font-size: 12px;
    color: var(--sdt-error);
    line-height: 1.5;
  }

  .hexclave-devtool .sdt-preview-code {
    font-family: var(--sdt-font-mono);
    font-size: 11px;
    color: var(--sdt-text);
  }

  .hexclave-devtool .sdt-props-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }

  .hexclave-devtool .sdt-props-table th {
    text-align: left;
    font-weight: 600;
    color: var(--sdt-text-tertiary);
    padding: 6px 8px;
    border-bottom: 1px solid var(--sdt-border);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .hexclave-devtool .sdt-props-table td {
    padding: 6px 8px;
    border-bottom: 1px solid var(--sdt-border-subtle);
    color: var(--sdt-text);
  }

  .hexclave-devtool .sdt-props-table td:first-child {
    font-family: var(--sdt-font-mono);
    color: var(--sdt-accent-hover);
  }

  .hexclave-devtool .sdt-props-table td:last-child {
    font-family: var(--sdt-font-mono);
    color: var(--sdt-text-secondary);
  }

  /* Iframe tabs */
  .hexclave-devtool .sdt-iframe-container {
    position: relative;
    flex: 1;
    min-height: 0;
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
  }

  .hexclave-devtool .sdt-iframe-toolbar {
    position: absolute;
    top: 8px;
    right: 8px;
    z-index: 1;
    flex-shrink: 0;
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 8px;
    padding: 0;
  }

  .hexclave-devtool .sdt-panel-fullscreen .sdt-iframe-toolbar {
    top: 60px;
    right: 12px;
  }

  .hexclave-devtool .sdt-iframe-open-link {
    display: inline-flex;
    align-items: center;
    min-height: 28px;
    padding: 0 10px;
    background: var(--sdt-overlay-bg);
    border: 1px solid var(--sdt-border);
    border-radius: var(--sdt-radius-sm);
    color: var(--sdt-accent-hover);
    font-family: var(--sdt-font);
    font-size: 12px;
    font-weight: 500;
    line-height: 1;
    text-decoration: none;
  }

  .hexclave-devtool .sdt-iframe-open-link:hover {
    color: var(--sdt-text);
  }

  .hexclave-devtool .sdt-iframe-container iframe {
    flex: 1;
    min-height: 0;
    width: 100%;
    height: 100%;
    border: none;
    background: white;
    border-radius: 0;
  }

  .hexclave-devtool .sdt-iframe-loading {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--sdt-text-secondary);
    font-size: 13px;
  }

  .hexclave-devtool .sdt-iframe-error {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    color: var(--sdt-text-secondary);
    font-size: 13px;
  }

  .hexclave-devtool .sdt-iframe-error-btn {
    padding: 6px 16px;
    background: var(--sdt-accent);
    color: white;
    border: none;
    border-radius: var(--sdt-radius);
    cursor: pointer;
    font-family: var(--sdt-font);
    font-size: 12px;
    font-weight: 500;
    transition: background 0.15s ease;
  }

  .hexclave-devtool .sdt-iframe-error-btn:hover {
    background: var(--sdt-accent-hover);
  }

  /* Shared content fade animation */
  .hexclave-devtool .sdt-tab-content-fade {
    animation: sdt-tab-fade-in 0.15s ease-out;
  }

  /* Console tab */
  .hexclave-devtool .sdt-console-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }

  .hexclave-devtool .sdt-console-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
    flex-shrink: 0;
  }

  .hexclave-devtool .sdt-console-title {
    color: var(--sdt-text);
    font-size: 13px;
    font-weight: 600;
  }

  .hexclave-devtool .sdt-console-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .hexclave-devtool .sdt-console-action-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    height: 28px;
    padding: 0 9px;
    background: var(--sdt-bg-elevated);
    border: 1px solid var(--sdt-border);
    border-radius: var(--sdt-radius-sm);
    color: var(--sdt-text-secondary);
    cursor: pointer;
    font-family: var(--sdt-font);
    font-size: 12px;
    font-weight: 500;
    line-height: 1;
    transition: color 0.15s ease, background 0.15s ease, border-color 0.15s ease;
    white-space: nowrap;
  }

  .hexclave-devtool .sdt-console-action-btn:hover {
    color: var(--sdt-text);
    background: var(--sdt-bg-hover);
    border-color: var(--sdt-border);
  }

  .hexclave-devtool .sdt-console-action-btn svg {
    flex-shrink: 0;
  }

  .hexclave-devtool .sdt-console-log-scroll {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }

  .hexclave-devtool .sdt-console-tabs {
    position: relative;
    display: flex;
    flex: 1;
    gap: 2px;
    background: var(--sdt-bg-subtle);
    border-radius: var(--sdt-radius);
    padding: 2px;
  }

  .hexclave-devtool .sdt-console-tab-indicator {
    position: absolute;
    top: 2px;
    left: 0;
    background: var(--sdt-bg-active);
    border-radius: var(--sdt-radius-sm);
    transition: transform 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94),
                width 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94);
    pointer-events: none;
    z-index: 0;
  }

  .hexclave-devtool .sdt-console-tab {
    position: relative;
    z-index: 1;
    flex: 1;
    padding: 6px 12px;
    background: transparent;
    border: none;
    border-radius: var(--sdt-radius-sm);
    cursor: pointer;
    font-family: var(--sdt-font);
    font-size: 12px;
    font-weight: 500;
    color: var(--sdt-text-secondary);
    transition: color 0.15s ease;
    text-align: center;
  }

  .hexclave-devtool .sdt-console-tab:hover {
    color: var(--sdt-text);
  }

  .hexclave-devtool .sdt-console-tab[data-active="true"] {
    color: var(--sdt-text);
  }

  .hexclave-devtool .sdt-log-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .hexclave-devtool .sdt-log-load-hint {
    padding: 8px 10px;
    color: var(--sdt-text-tertiary);
    font-family: var(--sdt-font);
    font-size: 12px;
    text-align: center;
  }

  .hexclave-devtool .sdt-log-item {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 8px 10px;
    background: var(--sdt-bg-elevated);
    border: 1px solid var(--sdt-border-subtle);
    border-radius: var(--sdt-radius-sm);
    font-size: 12px;
    font-family: var(--sdt-font-mono);
  }

  .hexclave-devtool .sdt-log-time {
    color: var(--sdt-text-tertiary);
    flex-shrink: 0;
    font-size: 11px;
  }

  .hexclave-devtool .sdt-log-type {
    padding: 1px 6px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    flex-shrink: 0;
  }

  .hexclave-devtool .sdt-log-message {
    flex: 1;
    color: var(--sdt-text);
    word-break: break-all;
  }

  .hexclave-devtool .sdt-log-method {
    padding: 1px 6px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 600;
    flex-shrink: 0;
  }

  .hexclave-devtool .sdt-log-method-get {
    background: var(--sdt-info-muted);
    color: var(--sdt-info);
  }

  .hexclave-devtool .sdt-log-method-post {
    background: var(--sdt-success-muted);
    color: var(--sdt-success);
  }

  .hexclave-devtool .sdt-log-method-put, .hexclave-devtool .sdt-log-method-patch {
    background: var(--sdt-warning-muted);
    color: var(--sdt-warning);
  }

  .hexclave-devtool .sdt-log-method-delete {
    background: var(--sdt-error-muted);
    color: var(--sdt-error);
  }

  .hexclave-devtool .sdt-log-status {
    font-size: 11px;
    flex-shrink: 0;
  }

  .hexclave-devtool .sdt-log-status-ok {
    color: var(--sdt-success);
  }

  .hexclave-devtool .sdt-log-status-err {
    color: var(--sdt-error);
  }

  .hexclave-devtool .sdt-log-url {
    flex: 1;
    color: var(--sdt-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .hexclave-devtool .sdt-empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    flex: 1;
    padding: 40px 20px;
    color: var(--sdt-text-tertiary);
    font-size: 13px;
    text-align: center;
    gap: 4px;
  }

  .hexclave-devtool .sdt-empty-state-icon {
    font-size: 24px;
    margin-bottom: 8px;
    opacity: 0.5;
  }

  /* Config info table */
  .hexclave-devtool .sdt-config-table {
    width: 100%;
    border-collapse: collapse;
  }

  .hexclave-devtool .sdt-config-table td {
    padding: 8px 10px;
    border-bottom: 1px solid var(--sdt-border-subtle);
    font-size: 12px;
  }

  .hexclave-devtool .sdt-config-table td:first-child {
    color: var(--sdt-text-secondary);
    width: 160px;
    font-weight: 500;
  }

  .hexclave-devtool .sdt-config-table td:last-child {
    color: var(--sdt-text);
    font-family: var(--sdt-font-mono);
    word-break: break-all;
  }

  .hexclave-devtool .sdt-config-table td .sdt-config-link {
    font-family: inherit;
    color: var(--sdt-accent);
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .hexclave-devtool .sdt-config-table td .sdt-config-link:hover {
    color: var(--sdt-text);
  }

  .hexclave-devtool .sdt-config-muted {
    color: var(--sdt-text-tertiary);
    font-style: italic;
  }

  /* Resize handle */
  .hexclave-devtool .sdt-resize-handle {
    position: absolute;
    top: 0;
    left: -4px;
    width: 8px;
    height: 100%;
    cursor: ew-resize;
    z-index: 10;
  }

  .hexclave-devtool .sdt-resize-handle::after {
    content: '';
    position: absolute;
    top: 50%;
    left: 3px;
    width: 2px;
    height: 32px;
    transform: translateY(-50%);
    background: transparent;
    border-radius: 1px;
    transition: background 0.15s ease;
  }

  .hexclave-devtool .sdt-resize-handle:hover::after,
  .hexclave-devtool .sdt-resize-handle:active::after {
    background: var(--sdt-accent);
  }

  .hexclave-devtool .sdt-resize-handle-top {
    position: absolute;
    top: -4px;
    left: 0;
    width: 100%;
    height: 8px;
    cursor: ns-resize;
    z-index: 10;
  }

  .hexclave-devtool .sdt-resize-handle-top::after {
    content: '';
    position: absolute;
    left: 50%;
    top: 3px;
    height: 2px;
    width: 32px;
    transform: translateX(-50%);
    background: transparent;
    border-radius: 1px;
    transition: background 0.15s ease;
  }

  .hexclave-devtool .sdt-resize-handle-top:hover::after,
  .hexclave-devtool .sdt-resize-handle-top:active::after {
    background: var(--sdt-accent);
  }

  .hexclave-devtool .sdt-resize-handle-corner {
    position: absolute;
    top: -6px;
    left: -6px;
    width: 14px;
    height: 14px;
    cursor: nwse-resize;
    z-index: 11;
  }

  .hexclave-devtool .sdt-resize-handle-corner::after {
    content: '';
    position: absolute;
    bottom: 4px;
    right: 4px;
    width: 5px;
    height: 5px;
    background: transparent;
    border-radius: 50%;
    transition: background 0.15s ease;
  }

  .hexclave-devtool .sdt-resize-handle-corner:hover::after,
  .hexclave-devtool .sdt-resize-handle-corner:active::after {
    background: var(--sdt-accent);
  }

  .hexclave-devtool .sdt-no-components {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--sdt-text-tertiary);
    font-size: 13px;
    text-align: center;
    padding: 20px;
  }

  /* Support tab */
  .hexclave-devtool .sdt-support-tab {
    display: flex;
    flex-direction: column;
    height: calc(100% + 32px);
    margin: -16px;
  }

  .hexclave-devtool .sdt-support-feedback-pane {
    padding: 20px;
    height: 100%;
    overflow-y: auto;
  }

  /* Form layout */
  .hexclave-devtool .sdt-support-form {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  /* Type cards */
  .hexclave-devtool .sdt-support-type-cards {
    display: flex;
    gap: 8px;
  }

  .hexclave-devtool .sdt-support-type-card {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 8px 10px;
    background: var(--sdt-bg);
    border: 1px solid var(--sdt-border-subtle);
    border-radius: var(--sdt-radius);
    cursor: pointer;
    font-family: var(--sdt-font);
    font-size: 11px;
    font-weight: 500;
    color: var(--sdt-text-secondary);
    transition: all 0.15s ease;
  }

  .hexclave-devtool .sdt-support-type-card svg {
    flex-shrink: 0;
    opacity: 0.6;
    transition: opacity 0.15s ease;
  }

  .hexclave-devtool .sdt-support-type-card:hover {
    background: var(--sdt-bg-hover);
    border-color: var(--sdt-border);
    color: var(--sdt-text);
  }

  .hexclave-devtool .sdt-support-type-card:hover svg {
    opacity: 1;
  }

  .hexclave-devtool .sdt-support-type-card-active {
    border-color: var(--sdt-accent);
    background: var(--sdt-accent-muted);
    color: var(--sdt-text);
  }

  .hexclave-devtool .sdt-support-type-card-active svg {
    opacity: 1;
    color: var(--sdt-accent);
  }

  /* Field group */
  .hexclave-devtool .sdt-support-field {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .hexclave-devtool .sdt-support-label {
    font-size: 11px;
    font-weight: 600;
    color: var(--sdt-text-secondary);
    letter-spacing: 0.3px;
    text-transform: uppercase;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .hexclave-devtool .sdt-support-optional {
    font-size: 10px;
    font-weight: 400;
    color: var(--sdt-text-tertiary);
    text-transform: none;
    letter-spacing: 0;
  }

  /* Inputs */
  .hexclave-devtool .sdt-support-input,
  .hexclave-devtool .sdt-support-textarea {
    width: 100%;
    padding: 9px 12px;
    background: var(--sdt-bg);
    border: 1px solid var(--sdt-border-subtle);
    border-radius: var(--sdt-radius-sm);
    color: var(--sdt-text);
    font-family: var(--sdt-font);
    font-size: 13px;
    outline: none;
    transition: border-color 0.15s ease, box-shadow 0.15s ease;
  }

  .hexclave-devtool .sdt-support-input::placeholder,
  .hexclave-devtool .sdt-support-textarea::placeholder {
    color: var(--sdt-text-tertiary);
  }

  .hexclave-devtool .sdt-support-input:focus,
  .hexclave-devtool .sdt-support-textarea:focus {
    border-color: var(--sdt-accent);
    box-shadow: 0 0 0 3px var(--sdt-accent-muted);
  }

  .hexclave-devtool .sdt-support-textarea {
    resize: vertical;
    min-height: 100px;
    line-height: 1.6;
  }

  /* Submit button */
  .hexclave-devtool .sdt-support-submit {
    width: 100%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 9px 20px;
    background: var(--sdt-accent);
    color: white;
    border: none;
    border-radius: var(--sdt-radius);
    cursor: pointer;
    font-family: var(--sdt-font);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.2px;
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    box-shadow: 0 1px 3px rgba(99, 102, 241, 0.3);
  }

  .hexclave-devtool .sdt-support-submit:hover:not(:disabled) {
    background: var(--sdt-accent-hover);
    box-shadow: 0 2px 8px rgba(99, 102, 241, 0.4);
    transform: translateY(-1px);
  }

  .hexclave-devtool .sdt-support-submit:active:not(:disabled) {
    transform: translateY(0);
    box-shadow: 0 1px 2px rgba(99, 102, 241, 0.2);
  }

  .hexclave-devtool .sdt-support-submit:disabled {
    opacity: 0.4;
    cursor: not-allowed;
    box-shadow: none;
  }

  .hexclave-devtool .sdt-support-submit svg {
    flex-shrink: 0;
  }

  @keyframes sdt-spin {
    to { transform: rotate(360deg); }
  }

  .hexclave-devtool .sdt-support-spinner {
    animation: sdt-spin 1s linear infinite;
  }

  /* Status screens (success / error) */
  .hexclave-devtool .sdt-support-status {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 32px 20px;
    border-radius: var(--sdt-radius-lg);
    text-align: center;
    gap: 6px;
  }

  .hexclave-devtool .sdt-support-status-success {
    background: linear-gradient(180deg, var(--sdt-success-muted), transparent 80%);
    border: 1px solid rgba(34, 197, 94, 0.15);
  }

  .hexclave-devtool .sdt-support-status-error {
    background: linear-gradient(180deg, var(--sdt-error-muted), transparent 80%);
    border: 1px solid rgba(239, 68, 68, 0.15);
  }

  .hexclave-devtool .sdt-support-status-icon {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 6px;
  }

  .hexclave-devtool .sdt-support-status-success .sdt-support-status-icon {
    background: rgba(34, 197, 94, 0.15);
    color: var(--sdt-success);
    box-shadow: 0 0 20px rgba(34, 197, 94, 0.1);
  }

  .hexclave-devtool .sdt-support-status-error .sdt-support-status-icon {
    background: rgba(239, 68, 68, 0.15);
    color: var(--sdt-error);
    box-shadow: 0 0 20px rgba(239, 68, 68, 0.1);
  }

  .hexclave-devtool .sdt-support-status-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--sdt-text);
  }

  .hexclave-devtool .sdt-support-status-msg {
    font-size: 12px;
    color: var(--sdt-text-secondary);
    line-height: 1.5;
    max-width: 260px;
  }

  /* Support channels */
  .hexclave-devtool .sdt-support-channels {
    display: flex;
    gap: 8px;
  }

  .hexclave-devtool .sdt-support-channel {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 8px 10px;
    background: var(--sdt-bg);
    border: 1px solid var(--sdt-border-subtle);
    border-radius: var(--sdt-radius);
    color: var(--sdt-text-secondary);
    text-decoration: none;
    font-size: 11px;
    font-weight: 500;
    transition: all 0.15s ease;
  }

  .hexclave-devtool .sdt-support-channel:hover {
    background: var(--sdt-bg-hover);
    border-color: var(--sdt-border);
    color: var(--sdt-text);
  }

  .hexclave-devtool .sdt-support-channel svg {
    flex-shrink: 0;
    opacity: 0.6;
    transition: opacity 0.15s ease;
  }

  .hexclave-devtool .sdt-support-channel:hover svg {
    opacity: 1;
  }

  /* Light theme + data-stack-theme overrides come from the shared in-page-ui
     base styles (in-page-ui/base-styles.ts). */

  /* Export dialog — positioned inside the dev tool panel */
  .hexclave-devtool .sdt-share-overlay {
    position: absolute;
    inset: 0;
    z-index: 20;
    background: rgba(0, 0, 0, 0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    animation: sdt-tab-fade-in 0.15s ease-out;
    border-radius: var(--sdt-radius-lg);
  }

  .hexclave-devtool .sdt-share-dialog {
    width: 380px;
    max-width: calc(100% - 32px);
    background: var(--sdt-bg);
    border: 1px solid var(--sdt-border);
    border-radius: var(--sdt-radius-lg);
    box-shadow: var(--sdt-shadow);
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .hexclave-devtool .sdt-share-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .hexclave-devtool .sdt-share-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--sdt-text);
  }

  .hexclave-devtool .sdt-share-status {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 20px;
    color: var(--sdt-text-secondary);
    font-size: 13px;
  }

  .hexclave-devtool .sdt-share-url-row {
    display: flex;
    gap: 6px;
    align-items: center;
  }

  .hexclave-devtool .sdt-share-url-row .sdt-support-input {
    flex: 1;
    font-family: var(--sdt-font-mono);
    font-size: 12px;
  }

  .hexclave-devtool .sdt-share-copy-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    flex-shrink: 0;
    background: var(--sdt-bg-elevated);
    border: 1px solid var(--sdt-border-subtle);
    border-radius: var(--sdt-radius-sm);
    color: var(--sdt-text-secondary);
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .hexclave-devtool .sdt-share-copy-btn:hover {
    background: var(--sdt-bg-hover);
    color: var(--sdt-text);
  }

  .hexclave-devtool .sdt-share-actions {
    display: flex;
    gap: 8px;
  }

  .hexclave-devtool .sdt-share-action-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 10px 12px;
    background: var(--sdt-bg-elevated);
    border: 1px solid var(--sdt-border-subtle);
    border-radius: var(--sdt-radius);
    color: var(--sdt-text-secondary);
    text-decoration: none;
    font-family: var(--sdt-font);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .hexclave-devtool .sdt-share-action-btn:hover {
    background: var(--sdt-bg-hover);
    border-color: var(--sdt-border);
    color: var(--sdt-text);
  }

  .hexclave-devtool .sdt-share-action-btn svg {
    flex-shrink: 0;
    opacity: 0.7;
  }

  .hexclave-devtool .sdt-share-action-btn:hover svg {
    opacity: 1;
  }

  .hexclave-devtool .sdt-share-action-btn-accent {
    background: var(--sdt-accent);
    border-color: var(--sdt-accent);
    color: white;
  }

  .hexclave-devtool .sdt-share-action-btn-accent:hover {
    background: var(--sdt-accent-hover);
    border-color: var(--sdt-accent-hover);
    color: white;
  }

  .hexclave-devtool .sdt-share-action-btn-accent svg {
    opacity: 1;
  }

  /* --- AI Chat tab --- */

  .hexclave-devtool .sdt-ai-container {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  .hexclave-devtool .sdt-ai-messages {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 16px;
    scroll-behavior: smooth;
  }

  .hexclave-devtool .sdt-ai-message-list {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  /* --- Empty state --- */

  .hexclave-devtool .sdt-ai-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    gap: 12px;
    padding: 24px;
    text-align: center;
  }

  .hexclave-devtool .sdt-ai-empty-icon {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background: var(--sdt-accent-muted);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--sdt-accent);
    margin-bottom: 4px;
  }

  .hexclave-devtool .sdt-ai-empty-title {
    font-size: 16px;
    font-weight: 600;
    color: var(--sdt-text);
  }

  .hexclave-devtool .sdt-ai-empty-desc {
    font-size: 12px;
    color: var(--sdt-text-secondary);
    max-width: 320px;
    line-height: 1.5;
  }

  .hexclave-devtool .sdt-ai-suggestions {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 8px;
    width: 100%;
    max-width: 340px;
  }

  .hexclave-devtool .sdt-ai-suggestion {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    border-radius: var(--sdt-radius);
    background: var(--sdt-bg-elevated);
    border: 1px solid var(--sdt-border-subtle);
    color: var(--sdt-text-secondary);
    font-size: 12px;
    cursor: pointer;
    text-align: left;
    transition: all 0.15s ease;
    font-family: var(--sdt-font);
    line-height: 1.4;
  }

  .hexclave-devtool .sdt-ai-suggestion:hover {
    background: var(--sdt-bg-hover);
    border-color: var(--sdt-border);
    color: var(--sdt-text);
  }

  .hexclave-devtool .sdt-ai-suggestion-icon {
    font-size: 14px;
    flex-shrink: 0;
  }

  /* --- Messages --- */

  .hexclave-devtool .sdt-ai-msg {
    display: flex;
    gap: 10px;
    align-items: flex-start;
  }

  .hexclave-devtool .sdt-ai-msg-user {
    justify-content: flex-end;
  }

  .hexclave-devtool .sdt-ai-msg-assistant {
    justify-content: flex-start;
  }

  .hexclave-devtool .sdt-ai-avatar {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    margin-top: 2px;
  }

  .hexclave-devtool .sdt-ai-avatar-user {
    background: var(--sdt-info-muted);
    color: var(--sdt-info);
    order: 2;
  }

  .hexclave-devtool .sdt-ai-avatar-assistant {
    background: var(--sdt-accent-muted);
    color: var(--sdt-accent);
  }

  .hexclave-devtool .sdt-ai-bubble {
    min-width: 0;
    max-width: 85%;
    border-radius: var(--sdt-radius-lg);
    padding: 10px 14px;
  }

  .hexclave-devtool .sdt-ai-bubble-user {
    background: var(--sdt-info-muted);
    border: 1px solid rgba(59, 130, 246, 0.1);
  }

  .hexclave-devtool .sdt-ai-bubble-user p {
    font-size: 13px;
    line-height: 1.55;
    color: var(--sdt-text);
    margin: 0;
    word-break: break-word;
  }

  .hexclave-devtool .sdt-ai-bubble-assistant {
    background: var(--sdt-bg-elevated);
    border: 1px solid var(--sdt-border-subtle);
  }

  /* --- Thinking dots --- */

  .hexclave-devtool .sdt-ai-thinking {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 0;
  }

  .hexclave-devtool .sdt-ai-thinking-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--sdt-accent);
    opacity: 0.5;
    animation: sdt-ai-pulse 1.2s ease-in-out infinite;
  }

  .hexclave-devtool .sdt-ai-thinking-dot:nth-child(2) { animation-delay: 0.15s; }
  .hexclave-devtool .sdt-ai-thinking-dot:nth-child(3) { animation-delay: 0.3s; }

  @keyframes sdt-ai-pulse {
    0%, 80%, 100% { opacity: 0.3; transform: scale(0.85); }
    40% { opacity: 1; transform: scale(1.1); }
  }

  .hexclave-devtool .sdt-ai-streaming-indicator {
    display: flex;
    align-items: center;
    gap: 3px;
    margin-top: 6px;
  }

  /* --- Markdown content inside assistant bubble --- */

  .hexclave-devtool .sdt-ai-paragraph {
    font-size: 13px;
    line-height: 1.6;
    color: var(--sdt-text);
    margin: 0 0 10px;
    word-break: break-word;
  }

  .hexclave-devtool .sdt-ai-paragraph:last-child { margin-bottom: 0; }

  .hexclave-devtool .sdt-ai-bold {
    font-weight: 600;
    color: var(--sdt-text);
  }

  .hexclave-devtool .sdt-ai-inline-code {
    display: inline;
    padding: 1.5px 5px;
    border-radius: 4px;
    font-family: var(--sdt-font-mono);
    font-size: 11.5px;
    background: var(--sdt-bg-hover);
    color: var(--sdt-text);
    border: 1px solid var(--sdt-border-subtle);
  }

  .hexclave-devtool .sdt-ai-link {
    color: var(--sdt-info);
    text-decoration: none;
    transition: color 0.1s;
  }

  .hexclave-devtool .sdt-ai-link:hover {
    color: var(--sdt-accent-hover);
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .hexclave-devtool .sdt-ai-heading {
    font-weight: 600;
    color: var(--sdt-text);
    margin: 12px 0 6px;
    line-height: 1.35;
  }

  .hexclave-devtool .sdt-ai-heading:first-child { margin-top: 0; }

  .hexclave-devtool .sdt-ai-bubble-assistant h1.sdt-ai-heading { font-size: 15px; }
  .hexclave-devtool .sdt-ai-bubble-assistant h2.sdt-ai-heading { font-size: 13.5px; }
  .hexclave-devtool .sdt-ai-bubble-assistant h3.sdt-ai-heading { font-size: 13px; }

  .hexclave-devtool .sdt-ai-list {
    font-size: 13px;
    line-height: 1.6;
    color: var(--sdt-text);
    margin: 0 0 10px;
    padding-left: 20px;
  }

  .hexclave-devtool .sdt-ai-list:last-child { margin-bottom: 0; }

  .hexclave-devtool .sdt-ai-list li {
    margin-bottom: 3px;
    padding-left: 2px;
  }

  .hexclave-devtool .sdt-ai-list li::marker {
    color: var(--sdt-text-tertiary);
  }

  .hexclave-devtool .sdt-ai-list-ordered {
    list-style-type: decimal;
  }

  .hexclave-devtool .sdt-ai-tools {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 6px 0;
  }

  .hexclave-devtool .sdt-ai-part-text {
    margin: 6px 0;
  }

  .hexclave-devtool .sdt-ai-tool-card {
    border: 1px solid var(--sdt-border-subtle);
    border-radius: var(--sdt-radius);
    background: var(--sdt-bg-subtle);
    overflow: hidden;
  }

  .hexclave-devtool .sdt-ai-tool-header {
    width: 100%;
    border: none;
    background: transparent;
    color: inherit;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    cursor: pointer;
    text-align: left;
    font-family: var(--sdt-font);
  }

  .hexclave-devtool .sdt-ai-tool-header:hover {
    background: var(--sdt-bg-hover);
  }

  .hexclave-devtool .sdt-ai-tool-name {
    font-size: 12px;
    font-weight: 600;
    color: var(--sdt-text);
    flex: 1;
  }

  .hexclave-devtool .sdt-ai-tool-status {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    font-weight: 600;
  }

  .hexclave-devtool .sdt-ai-tool-status-running { color: var(--sdt-warning); }
  .hexclave-devtool .sdt-ai-tool-status-success { color: var(--sdt-success); }
  .hexclave-devtool .sdt-ai-tool-status-error { color: var(--sdt-error); }

  .hexclave-devtool .sdt-ai-tool-chevron {
    color: var(--sdt-text-tertiary);
    font-size: 10px;
    transition: transform 0.15s ease;
  }

  .hexclave-devtool .sdt-ai-tool-chevron-open {
    transform: rotate(180deg);
  }

  .hexclave-devtool .sdt-ai-tool-body {
    border-top: 1px solid var(--sdt-border-subtle);
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .hexclave-devtool .sdt-ai-tool-label {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    color: var(--sdt-text-tertiary);
    font-weight: 600;
  }

  .hexclave-devtool .sdt-ai-tool-pre {
    margin: 0;
    padding: 8px;
    border: 1px solid var(--sdt-border-subtle);
    border-radius: var(--sdt-radius-sm);
    background: var(--sdt-bg);
    font-family: var(--sdt-font-mono);
    font-size: 11px;
    line-height: 1.5;
    color: var(--sdt-text-secondary);
    overflow-x: auto;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .hexclave-devtool .sdt-ai-tool-running {
    font-size: 11px;
    color: var(--sdt-text-secondary);
  }

  .hexclave-devtool .sdt-ai-blockquote {
    border-left: 3px solid var(--sdt-accent);
    padding-left: 12px;
    margin: 8px 0;
    font-size: 13px;
    color: var(--sdt-text-secondary);
    font-style: italic;
  }

  .hexclave-devtool .sdt-ai-hr {
    border: none;
    border-top: 1px solid var(--sdt-border-subtle);
    margin: 12px 0;
  }

  /* --- Code blocks --- */

  .hexclave-devtool .sdt-ai-code-block {
    border-radius: var(--sdt-radius);
    overflow: hidden;
    margin: 8px 0;
    border: 1px solid var(--sdt-border-subtle);
    background: var(--sdt-bg-subtle);
  }

  .hexclave-devtool .sdt-ai-code-block:last-child { margin-bottom: 0; }

  .hexclave-devtool .sdt-ai-code-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 5px 10px;
    border-bottom: 1px solid var(--sdt-border-subtle);
    background: var(--sdt-bg);
  }

  .hexclave-devtool .sdt-ai-code-lang {
    font-size: 9px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--sdt-text-tertiary);
    font-family: var(--sdt-font);
  }

  .hexclave-devtool .sdt-ai-copy-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: var(--sdt-radius-sm);
    border: none;
    background: transparent;
    color: var(--sdt-text-tertiary);
    cursor: pointer;
    font-size: 12px;
    font-family: var(--sdt-font);
    transition: all 0.15s ease;
  }

  .hexclave-devtool .sdt-ai-copy-btn:hover {
    background: var(--sdt-bg-hover);
    color: var(--sdt-text);
  }

  .hexclave-devtool .sdt-ai-copy-btn-copied {
    color: var(--sdt-success) !important;
  }

  .hexclave-devtool .sdt-ai-code-pre {
    margin: 0;
    padding: 10px 12px;
    overflow-x: auto;
    font-family: var(--sdt-font-mono);
    font-size: 11.5px;
    line-height: 1.6;
    color: var(--sdt-text);
  }

  .hexclave-devtool .sdt-ai-code-pre code {
    font-family: inherit;
    background: none;
    border: none;
    padding: 0;
  }

  /* --- Error --- */

  .hexclave-devtool .sdt-ai-error {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 10px 14px;
    margin: 8px 16px;
    border-radius: var(--sdt-radius);
    background: var(--sdt-error-muted);
    border: 1px solid rgba(239, 68, 68, 0.2);
    font-size: 12px;
    color: var(--sdt-error);
    line-height: 1.4;
  }

  /* --- Input area --- */

  .hexclave-devtool .sdt-ai-input-area {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    border-top: 1px solid var(--sdt-border-subtle);
    background: var(--sdt-bg);
  }

  .hexclave-devtool .sdt-ai-new-chat {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: var(--sdt-radius);
    border: 1px solid var(--sdt-border-subtle);
    background: var(--sdt-bg-elevated);
    color: var(--sdt-text-secondary);
    cursor: pointer;
    flex-shrink: 0;
    transition: all 0.15s ease;
    font-family: var(--sdt-font);
  }

  .hexclave-devtool .sdt-ai-new-chat:hover {
    background: var(--sdt-bg-hover);
    border-color: var(--sdt-border);
    color: var(--sdt-text);
  }

  .hexclave-devtool .sdt-ai-input-wrapper {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 6px;
    border-radius: var(--sdt-radius);
    background: var(--sdt-bg-elevated);
    border: 1px solid var(--sdt-border-subtle);
    padding: 0 4px 0 12px;
    transition: border-color 0.15s ease;
  }

  .hexclave-devtool .sdt-ai-input-wrapper:focus-within {
    border-color: var(--sdt-accent);
    box-shadow: 0 0 0 2px var(--sdt-accent-muted);
  }

  .hexclave-devtool .sdt-ai-input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    color: var(--sdt-text);
    font-size: 13px;
    font-family: var(--sdt-font);
    padding: 8px 0;
    min-width: 0;
  }

  .hexclave-devtool .sdt-ai-input::placeholder {
    color: var(--sdt-text-tertiary);
  }

  .hexclave-devtool .sdt-ai-input:disabled {
    opacity: 0.5;
  }

  .hexclave-devtool .sdt-ai-send-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border-radius: 6px;
    border: none;
    background: transparent;
    color: var(--sdt-text-tertiary);
    cursor: not-allowed;
    flex-shrink: 0;
    transition: all 0.15s ease;
    font-family: var(--sdt-font);
  }

  .hexclave-devtool .sdt-ai-send-btn-active {
    background: var(--sdt-accent);
    color: white;
    cursor: pointer;
  }

  .hexclave-devtool .sdt-ai-send-btn-active:hover {
    background: var(--sdt-accent-hover);
  }

  .hexclave-devtool .sdt-ai-stop-btn,
  .hexclave-devtool .sdt-ai-stop-btn:hover {
    background: var(--sdt-error);
    color: white;
  }

  /* Accessible focus indicator for keyboard navigation */
  .hexclave-devtool .sdt-tab:focus-visible {
    outline: 2px solid var(--sdt-accent);
    outline-offset: -2px;
    border-radius: var(--sdt-radius);
  }

  /* Reduced motion: disable animations for users who prefer it */
  @media (prefers-reduced-motion: reduce) {
    .hexclave-devtool .sdt-panel-inner,
    .hexclave-devtool .sdt-panel-exiting,
    .hexclave-devtool .sdt-tab-content,
    .hexclave-devtool .sdt-ov-pulse-dot,
    .hexclave-devtool .sdt-ov-skeleton-pill,
    .hexclave-devtool .sdt-support-spinner,
    .hexclave-devtool .sdt-ai-thinking-dot {
      animation: none !important;
    }

    .hexclave-devtool .sdt-tab-indicator,
    .hexclave-devtool .sdt-tab {
      transition: none !important;
    }
  }

`;
