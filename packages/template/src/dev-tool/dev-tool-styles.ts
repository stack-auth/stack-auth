// Hardcoded dark theme CSS for the dev tool indicator
// Independent of host app's StackTheme — always renders in dark mode
// Uses .stack-devtool scope to avoid conflicts with host app styles

export const devToolCSS = `
  .stack-devtool {
    --sdt-bg: #0a0a0b;
    --sdt-bg-elevated: #141416;
    --sdt-bg-hover: #1c1c1f;
    --sdt-bg-active: #232326;
    --sdt-bg-subtle: #111113;
    --sdt-border: #2a2a2e;
    --sdt-border-subtle: #1e1e22;
    --sdt-text: #ececef;
    --sdt-text-secondary: #8b8b93;
    --sdt-text-tertiary: #5c5c66;
    --sdt-accent: #6366f1;
    --sdt-accent-hover: #818cf8;
    --sdt-accent-muted: rgba(99, 102, 241, 0.15);
    --sdt-success: #22c55e;
    --sdt-success-muted: rgba(34, 197, 94, 0.15);
    --sdt-warning: #eab308;
    --sdt-warning-muted: rgba(234, 179, 8, 0.15);
    --sdt-error: #ef4444;
    --sdt-error-muted: rgba(239, 68, 68, 0.15);
    --sdt-info: #3b82f6;
    --sdt-info-muted: rgba(59, 130, 246, 0.15);
    --sdt-radius: 8px;
    --sdt-radius-sm: 4px;
    --sdt-radius-lg: 12px;
    --sdt-font: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    --sdt-font-mono: 'SF Mono', SFMono-Regular, ui-monospace, 'DejaVu Sans Mono', Menlo, Consolas, monospace;
    --sdt-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.05);
    --sdt-trigger-shadow: 0 4px 12px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.08);

    all: initial;
    font-family: var(--sdt-font);
    color: var(--sdt-text);
    font-size: 13px;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    box-sizing: border-box;
  }

  .stack-devtool *, .stack-devtool *::before, .stack-devtool *::after {
    box-sizing: border-box;
  }

  /* Trigger pill */
  .stack-devtool .sdt-trigger {
    position: fixed;
    bottom: 16px;
    right: 16px;
    z-index: 99999;
    display: flex;
    align-items: center;
    gap: 6px;
    height: 36px;
    padding: 0 12px 0 8px;
    background: var(--sdt-bg-elevated);
    border: 1px solid var(--sdt-border);
    border-radius: 20px;
    cursor: pointer;
    box-shadow: var(--sdt-trigger-shadow);
    transition: all 0.2s ease;
    user-select: none;
    font-family: var(--sdt-font);
    font-size: 12px;
    font-weight: 600;
    color: var(--sdt-text);
    letter-spacing: 0.5px;
  }

  .stack-devtool .sdt-trigger:hover {
    background: var(--sdt-bg-hover);
    border-color: var(--sdt-accent);
    box-shadow: var(--sdt-trigger-shadow), 0 0 0 1px var(--sdt-accent);
    transform: translateY(-1px);
  }

  .stack-devtool .sdt-trigger:active {
    transform: translateY(0);
  }

  .stack-devtool .sdt-trigger-logo {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: var(--sdt-accent);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-weight: 700;
    color: white;
  }

  .stack-devtool .sdt-trigger-text {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    color: var(--sdt-text-secondary);
  }

  /* Panel overlay */
  .stack-devtool .sdt-panel {
    position: fixed;
    bottom: 60px;
    right: 16px;
    z-index: 99998;
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

  .stack-devtool .sdt-panel-inner {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    overflow: hidden;
    border-radius: var(--sdt-radius-lg);
    animation: sdt-panel-enter 0.2s ease-out;
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

  .stack-devtool .sdt-panel-exiting {
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
  .stack-devtool .sdt-tabbar {
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
  }

  .stack-devtool .sdt-tab-indicator {
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

  .stack-devtool .sdt-tab {
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

  .stack-devtool .sdt-tab:hover {
    color: var(--sdt-text);
  }

  .stack-devtool .sdt-tab[data-active="true"] {
    color: var(--sdt-text);
  }

  .stack-devtool .sdt-tab-icon {
    width: 14px;
    height: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .stack-devtool .sdt-tabbar-spacer {
    flex: 1;
  }

  .stack-devtool .sdt-close-btn {
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

  .stack-devtool .sdt-close-btn:hover {
    color: var(--sdt-text);
    background: var(--sdt-bg-hover);
  }

  /* Tab content area */
  .stack-devtool .sdt-content {
    flex: 1;
    position: relative;
    overflow: hidden;
    min-height: 0;
  }

  .stack-devtool .sdt-tab-layers {
    position: absolute;
    inset: 0;
  }

  .stack-devtool .sdt-tab-pane {
    position: absolute;
    inset: 0;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 16px;
    visibility: hidden;
    pointer-events: none;
  }

  .stack-devtool .sdt-tab-pane-active {
    visibility: visible;
    pointer-events: auto;
    animation: sdt-tab-fade-in 0.15s ease-out;
  }

  @keyframes sdt-tab-fade-in {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .stack-devtool .sdt-tab-pane::-webkit-scrollbar {
    width: 6px;
  }

  .stack-devtool .sdt-tab-pane::-webkit-scrollbar-track {
    background: transparent;
  }

  .stack-devtool .sdt-tab-pane::-webkit-scrollbar-thumb {
    background: var(--sdt-border);
    border-radius: 3px;
  }

  /* Overview tab */
  .stack-devtool .sdt-section {
    margin-bottom: 20px;
  }

  .stack-devtool .sdt-section-title {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.8px;
    text-transform: uppercase;
    color: var(--sdt-text-tertiary);
    margin-bottom: 8px;
  }

  .stack-devtool .sdt-info-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }

  .stack-devtool .sdt-info-card {
    padding: 12px;
    background: var(--sdt-bg-elevated);
    border: 1px solid var(--sdt-border-subtle);
    border-radius: var(--sdt-radius);
  }

  .stack-devtool .sdt-info-label {
    font-size: 11px;
    font-weight: 500;
    color: var(--sdt-text-tertiary);
    margin-bottom: 4px;
  }

  .stack-devtool .sdt-info-value {
    font-size: 13px;
    font-weight: 500;
    color: var(--sdt-text);
    word-break: break-all;
  }

  .stack-devtool .sdt-info-value-mono {
    font-family: var(--sdt-font-mono);
    font-size: 12px;
  }

  /* Status badges */
  .stack-devtool .sdt-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 11px;
    font-weight: 500;
  }

  .stack-devtool .sdt-badge-success {
    background: var(--sdt-success-muted);
    color: var(--sdt-success);
  }

  .stack-devtool .sdt-badge-warning {
    background: var(--sdt-warning-muted);
    color: var(--sdt-warning);
  }

  .stack-devtool .sdt-badge-error {
    background: var(--sdt-error-muted);
    color: var(--sdt-error);
  }

  .stack-devtool .sdt-badge-info {
    background: var(--sdt-info-muted);
    color: var(--sdt-info);
  }

  /* Checklist */
  .stack-devtool .sdt-checklist {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .stack-devtool .sdt-checklist-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: var(--sdt-bg-elevated);
    border: 1px solid var(--sdt-border-subtle);
    border-radius: var(--sdt-radius);
    font-size: 13px;
  }

  .stack-devtool .sdt-check-icon {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    flex-shrink: 0;
  }

  .stack-devtool .sdt-check-pass {
    background: var(--sdt-success-muted);
    color: var(--sdt-success);
  }

  .stack-devtool .sdt-check-fail {
    background: var(--sdt-error-muted);
    color: var(--sdt-error);
  }

  .stack-devtool .sdt-check-warn {
    background: var(--sdt-warning-muted);
    color: var(--sdt-warning);
  }

  /* User status card */
  .stack-devtool .sdt-user-card {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px;
    background: var(--sdt-bg-elevated);
    border: 1px solid var(--sdt-border-subtle);
    border-radius: var(--sdt-radius);
  }

  .stack-devtool .sdt-user-avatar {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: var(--sdt-accent-muted);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    font-weight: 600;
    color: var(--sdt-accent);
    flex-shrink: 0;
    overflow: hidden;
  }

  .stack-devtool .sdt-user-avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .stack-devtool .sdt-user-info {
    flex: 1;
    min-width: 0;
  }

  .stack-devtool .sdt-user-name {
    font-size: 13px;
    font-weight: 600;
    color: var(--sdt-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .stack-devtool .sdt-user-email {
    font-size: 12px;
    color: var(--sdt-text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Components tab */
  .stack-devtool .sdt-split-pane {
    display: flex;
    height: calc(100% + 32px);
    margin: -16px;
  }

  .stack-devtool .sdt-split-left {
    width: 240px;
    flex-shrink: 0;
    border-right: 1px solid var(--sdt-border);
    overflow-y: auto;
  }

  .stack-devtool .sdt-split-right {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
  }

  .stack-devtool .sdt-component-list {
    padding: 8px;
  }

  .stack-devtool .sdt-component-group-label {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.6px;
    text-transform: uppercase;
    color: var(--sdt-text-tertiary);
    padding: 8px 10px 4px;
    margin-top: 4px;
  }

  .stack-devtool .sdt-component-group-label:first-child {
    margin-top: 0;
  }

  .stack-devtool .sdt-component-status {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .stack-devtool .sdt-component-status--on {
    background: var(--sdt-success);
    box-shadow: 0 0 0 2px var(--sdt-success-muted);
  }

  .stack-devtool .sdt-component-status--off {
    background: var(--sdt-bg-active);
    border: 1px solid var(--sdt-border-subtle);
  }

  .stack-devtool .sdt-component-item-nested {
    padding-left: 28px;
    font-size: 12px;
    color: var(--sdt-text-secondary);
  }

  .stack-devtool .sdt-component-expand {
    margin-left: auto;
    font-size: 10px;
    color: var(--sdt-text-tertiary);
    user-select: none;
  }

  .stack-devtool .sdt-unmounted-hint {
    font-size: 12px;
    color: var(--sdt-text-secondary);
    line-height: 1.5;
    margin: 0;
  }

  .stack-devtool .sdt-component-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border-radius: var(--sdt-radius-sm);
    cursor: pointer;
    transition: background 0.1s ease;
    font-size: 13px;
    color: var(--sdt-text);
  }

  .stack-devtool .sdt-component-item:hover {
    background: var(--sdt-bg-hover);
  }

  .stack-devtool .sdt-component-item[data-selected="true"] {
    background: var(--sdt-accent-muted);
    color: var(--sdt-accent-hover);
  }

  .stack-devtool .sdt-component-icon {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--sdt-accent);
    flex-shrink: 0;
  }

  .stack-devtool .sdt-component-count {
    margin-left: auto;
    font-size: 11px;
    color: var(--sdt-text-tertiary);
    background: var(--sdt-bg-active);
    padding: 0 6px;
    border-radius: 8px;
  }

  .stack-devtool .sdt-component-detail h3 {
    font-size: 16px;
    font-weight: 600;
    margin: 0 0 4px 0;
    color: var(--sdt-text);
  }

  .stack-devtool .sdt-component-detail-sub {
    font-size: 12px;
    color: var(--sdt-text-secondary);
    margin-bottom: 16px;
  }

  .stack-devtool .sdt-component-preview-label {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--sdt-text-tertiary);
  }

  .stack-devtool .sdt-component-preview-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 8px;
  }

  .stack-devtool .sdt-secondary-btn {
    height: 26px;
    padding: 0 10px;
    border-radius: var(--sdt-radius-sm);
    border: 1px solid var(--sdt-border);
    background: var(--sdt-bg-active);
    color: var(--sdt-text);
    cursor: pointer;
    font-size: 11px;
    font-weight: 600;
    line-height: 1;
    transition: background 0.12s ease, border-color 0.12s ease, color 0.12s ease;
  }

  .stack-devtool .sdt-secondary-btn:hover {
    background: var(--sdt-bg-hover);
    border-color: var(--sdt-border-strong, var(--sdt-border));
  }

  .stack-devtool .sdt-component-preview-frame {
    border: 1px solid var(--sdt-border);
    border-radius: var(--sdt-radius);
    background: var(--sdt-bg-subtle);
    padding: 16px;
    margin-bottom: 16px;
    max-height: 280px;
    overflow: auto;
  }

  .stack-devtool .sdt-preview-loading,
  .stack-devtool .sdt-preview-unavailable {
    font-size: 12px;
    color: var(--sdt-text-secondary);
    line-height: 1.5;
  }

  .stack-devtool .sdt-preview-error {
    font-size: 12px;
    color: var(--sdt-error);
    line-height: 1.5;
  }

  .stack-devtool .sdt-preview-code {
    font-family: var(--sdt-font-mono);
    font-size: 11px;
    color: var(--sdt-text);
  }

  .stack-devtool .sdt-props-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }

  .stack-devtool .sdt-props-table th {
    text-align: left;
    font-weight: 600;
    color: var(--sdt-text-tertiary);
    padding: 6px 8px;
    border-bottom: 1px solid var(--sdt-border);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .stack-devtool .sdt-props-table td {
    padding: 6px 8px;
    border-bottom: 1px solid var(--sdt-border-subtle);
    color: var(--sdt-text);
  }

  .stack-devtool .sdt-props-table td:first-child {
    font-family: var(--sdt-font-mono);
    color: var(--sdt-accent-hover);
  }

  .stack-devtool .sdt-props-table td:last-child {
    font-family: var(--sdt-font-mono);
    color: var(--sdt-text-secondary);
  }

  /* Iframe tabs (Docs, Dashboard) */
  .stack-devtool .sdt-iframe-container {
    height: calc(100% + 32px);
    margin: -16px;
    display: flex;
    flex-direction: column;
  }

  .stack-devtool .sdt-iframe-container iframe {
    flex: 1;
    width: 100%;
    border: none;
    background: white;
    border-radius: 0 0 var(--sdt-radius-lg) var(--sdt-radius-lg);
  }

  .stack-devtool .sdt-iframe-loading {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--sdt-text-secondary);
    font-size: 13px;
  }

  .stack-devtool .sdt-iframe-error {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    color: var(--sdt-text-secondary);
    font-size: 13px;
  }

  .stack-devtool .sdt-iframe-error-btn {
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

  .stack-devtool .sdt-iframe-error-btn:hover {
    background: var(--sdt-accent-hover);
  }

  /* Shared content fade animation */
  .stack-devtool .sdt-tab-content-fade {
    animation: sdt-tab-fade-in 0.15s ease-out;
  }

  /* Console tab */
  .stack-devtool .sdt-console-tabs {
    position: relative;
    display: flex;
    flex: 1;
    gap: 2px;
    background: var(--sdt-bg-subtle);
    border-radius: var(--sdt-radius);
    padding: 2px;
  }

  .stack-devtool .sdt-console-tab-indicator {
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

  .stack-devtool .sdt-console-tab {
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

  .stack-devtool .sdt-console-tab:hover {
    color: var(--sdt-text);
  }

  .stack-devtool .sdt-console-tab[data-active="true"] {
    color: var(--sdt-text);
  }

  .stack-devtool .sdt-log-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .stack-devtool .sdt-log-item {
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

  .stack-devtool .sdt-log-time {
    color: var(--sdt-text-tertiary);
    flex-shrink: 0;
    font-size: 11px;
  }

  .stack-devtool .sdt-log-type {
    padding: 1px 6px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    flex-shrink: 0;
  }

  .stack-devtool .sdt-log-message {
    flex: 1;
    color: var(--sdt-text);
    word-break: break-all;
  }

  .stack-devtool .sdt-log-method {
    padding: 1px 6px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 600;
    flex-shrink: 0;
  }

  .stack-devtool .sdt-log-method-get {
    background: var(--sdt-info-muted);
    color: var(--sdt-info);
  }

  .stack-devtool .sdt-log-method-post {
    background: var(--sdt-success-muted);
    color: var(--sdt-success);
  }

  .stack-devtool .sdt-log-method-put, .stack-devtool .sdt-log-method-patch {
    background: var(--sdt-warning-muted);
    color: var(--sdt-warning);
  }

  .stack-devtool .sdt-log-method-delete {
    background: var(--sdt-error-muted);
    color: var(--sdt-error);
  }

  .stack-devtool .sdt-log-status {
    font-size: 11px;
    flex-shrink: 0;
  }

  .stack-devtool .sdt-log-status-ok {
    color: var(--sdt-success);
  }

  .stack-devtool .sdt-log-status-err {
    color: var(--sdt-error);
  }

  .stack-devtool .sdt-log-url {
    flex: 1;
    color: var(--sdt-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .stack-devtool .sdt-empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 40px 20px;
    color: var(--sdt-text-tertiary);
    font-size: 13px;
    text-align: center;
    gap: 4px;
  }

  .stack-devtool .sdt-empty-state-icon {
    font-size: 24px;
    margin-bottom: 8px;
    opacity: 0.5;
  }

  /* Config info table */
  .stack-devtool .sdt-config-table {
    width: 100%;
    border-collapse: collapse;
  }

  .stack-devtool .sdt-config-table td {
    padding: 8px 10px;
    border-bottom: 1px solid var(--sdt-border-subtle);
    font-size: 12px;
  }

  .stack-devtool .sdt-config-table td:first-child {
    color: var(--sdt-text-secondary);
    width: 160px;
    font-weight: 500;
  }

  .stack-devtool .sdt-config-table td:last-child {
    color: var(--sdt-text);
    font-family: var(--sdt-font-mono);
    word-break: break-all;
  }

  .stack-devtool .sdt-config-table td .sdt-config-link {
    font-family: inherit;
    color: var(--sdt-accent);
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .stack-devtool .sdt-config-table td .sdt-config-link:hover {
    color: var(--sdt-text);
  }

  .stack-devtool .sdt-config-muted {
    color: var(--sdt-text-tertiary);
    font-style: italic;
  }

  /* Resize handle */
  .stack-devtool .sdt-resize-handle {
    position: absolute;
    top: 0;
    left: -4px;
    width: 8px;
    height: 100%;
    cursor: ew-resize;
    z-index: 10;
  }

  .stack-devtool .sdt-resize-handle::after {
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

  .stack-devtool .sdt-resize-handle:hover::after,
  .stack-devtool .sdt-resize-handle:active::after {
    background: var(--sdt-accent);
  }

  .stack-devtool .sdt-resize-handle-top {
    position: absolute;
    top: -4px;
    left: 0;
    width: 100%;
    height: 8px;
    cursor: ns-resize;
    z-index: 10;
  }

  .stack-devtool .sdt-resize-handle-top::after {
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

  .stack-devtool .sdt-resize-handle-top:hover::after,
  .stack-devtool .sdt-resize-handle-top:active::after {
    background: var(--sdt-accent);
  }

  .stack-devtool .sdt-resize-handle-corner {
    position: absolute;
    top: -6px;
    left: -6px;
    width: 14px;
    height: 14px;
    cursor: nwse-resize;
    z-index: 11;
  }

  .stack-devtool .sdt-resize-handle-corner::after {
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

  .stack-devtool .sdt-resize-handle-corner:hover::after,
  .stack-devtool .sdt-resize-handle-corner:active::after {
    background: var(--sdt-accent);
  }

  .stack-devtool .sdt-no-components {
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
  .stack-devtool .sdt-support-tab {
    display: flex;
    flex-direction: column;
    height: calc(100% + 32px);
    margin: -16px;
  }

  .stack-devtool .sdt-support-tab > .sdt-console-tabs {
    margin: 12px 12px 0;
    flex: none;
  }

  .stack-devtool .sdt-support-content {
    flex: 1;
    min-height: 0;
    position: relative;
  }

  .stack-devtool .sdt-support-pane {
    position: absolute;
    inset: 0;
    visibility: hidden;
    pointer-events: none;
  }

  .stack-devtool .sdt-tab-pane-active .sdt-support-pane-active {
    visibility: visible;
    pointer-events: auto;
    animation: sdt-tab-fade-in 0.15s ease-out;
  }

  .stack-devtool .sdt-support-feedback-pane {
    padding: 16px;
    height: 100%;
    overflow-y: auto;
  }

  .stack-devtool .sdt-support-iframe-pane {
    height: 100%;
  }

  .stack-devtool .sdt-support-iframe-pane .sdt-iframe-container {
    height: 100%;
    margin: 0;
  }

  .stack-devtool .sdt-support-form {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .stack-devtool .sdt-support-type-toggle {
    display: flex;
    gap: 4px;
    background: var(--sdt-bg-subtle);
    border-radius: var(--sdt-radius);
    padding: 3px;
    margin-bottom: 4px;
  }

  .stack-devtool .sdt-support-type-btn {
    flex: 1;
    padding: 6px 10px;
    background: transparent;
    border: none;
    border-radius: var(--sdt-radius-sm);
    cursor: pointer;
    font-family: var(--sdt-font);
    font-size: 12px;
    font-weight: 500;
    color: var(--sdt-text-secondary);
    transition: all 0.15s ease;
    text-align: center;
  }

  .stack-devtool .sdt-support-type-btn:hover {
    color: var(--sdt-text);
  }

  .stack-devtool .sdt-support-type-btn-active {
    background: var(--sdt-bg-active);
    color: var(--sdt-text);
  }

  .stack-devtool .sdt-support-input,
  .stack-devtool .sdt-support-textarea {
    width: 100%;
    padding: 8px 10px;
    background: var(--sdt-bg-elevated);
    border: 1px solid var(--sdt-border-subtle);
    border-radius: var(--sdt-radius-sm);
    color: var(--sdt-text);
    font-family: var(--sdt-font);
    font-size: 12px;
    outline: none;
    transition: border-color 0.15s ease;
  }

  .stack-devtool .sdt-support-input::placeholder,
  .stack-devtool .sdt-support-textarea::placeholder {
    color: var(--sdt-text-tertiary);
  }

  .stack-devtool .sdt-support-input:focus,
  .stack-devtool .sdt-support-textarea:focus {
    border-color: var(--sdt-accent);
  }

  .stack-devtool .sdt-support-textarea {
    resize: vertical;
    min-height: 80px;
    line-height: 1.5;
  }

  .stack-devtool .sdt-support-submit {
    width: 100%;
    padding: 8px 16px;
    background: var(--sdt-accent);
    color: white;
    border: none;
    border-radius: var(--sdt-radius-sm);
    cursor: pointer;
    font-family: var(--sdt-font);
    font-size: 12px;
    font-weight: 600;
    transition: background 0.15s ease;
    margin-top: 4px;
  }

  .stack-devtool .sdt-support-submit:hover:not(:disabled) {
    background: var(--sdt-accent-hover);
  }

  .stack-devtool .sdt-support-submit:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .stack-devtool .sdt-support-status {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 20px 16px;
    border-radius: var(--sdt-radius);
    text-align: center;
    gap: 4px;
  }

  .stack-devtool .sdt-support-status-success {
    background: var(--sdt-success-muted);
    border: 1px solid rgba(34, 197, 94, 0.2);
  }

  .stack-devtool .sdt-support-status-error {
    background: var(--sdt-error-muted);
    border: 1px solid rgba(239, 68, 68, 0.2);
  }

  .stack-devtool .sdt-support-status-icon {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    font-weight: 700;
    margin-bottom: 4px;
  }

  .stack-devtool .sdt-support-status-success .sdt-support-status-icon {
    background: var(--sdt-success-muted);
    color: var(--sdt-success);
  }

  .stack-devtool .sdt-support-status-error .sdt-support-status-icon {
    background: var(--sdt-error-muted);
    color: var(--sdt-error);
  }

  .stack-devtool .sdt-support-status-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--sdt-text);
  }

  .stack-devtool .sdt-support-status-msg {
    font-size: 12px;
    color: var(--sdt-text-secondary);
  }

  .stack-devtool .sdt-support-links {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding-top: 12px;
    margin-top: 8px;
    border-top: 1px solid var(--sdt-border-subtle);
  }

  .stack-devtool .sdt-support-link {
    font-size: 11px;
    color: var(--sdt-accent);
    text-decoration: none;
    transition: color 0.15s ease;
  }

  .stack-devtool .sdt-support-link:hover {
    color: var(--sdt-accent-hover);
    text-decoration: underline;
  }

  .stack-devtool .sdt-support-link-sep {
    font-size: 11px;
    color: var(--sdt-text-tertiary);
  }
`;
