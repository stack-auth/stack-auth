"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useDevToolContext, type TabId } from "./dev-tool-context";
import { DevToolTabBar, type TabDef } from "./dev-tool-tab-bar";
import { OverviewTab } from "./tabs/overview-tab";
import { ComponentsTab } from "./tabs/components-tab";
import { DocsTab } from "./tabs/docs-tab";
import { DashboardTab } from "./tabs/dashboard-tab";
import { ConsoleTab, ExportDialog } from "./tabs/console-tab";
import { SupportTab } from "./tabs/support-tab";
import { AITab } from "./tabs/ai-tab";

// IF_PLATFORM react-like

const TabIcon = ({ children }: { children: React.ReactNode }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);

const TABS: TabDef<TabId>[] = [
  { id: 'overview', label: 'Overview', icon: <TabIcon><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></TabIcon> },
  { id: 'components', label: 'Components', icon: <TabIcon><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></TabIcon> },
  { id: 'ai', label: 'AI', icon: <TabIcon><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></TabIcon> },
  { id: 'docs', label: 'Docs', icon: <TabIcon><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></TabIcon> },
  { id: 'dashboard', label: 'Dashboard', icon: <TabIcon><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></TabIcon> },
  { id: 'console', label: 'Console', icon: <TabIcon><polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" /></TabIcon> },
  { id: 'support', label: 'Support', icon: <TabIcon><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></TabIcon> },
];

const TAB_COMPONENTS: Record<TabId, React.ComponentType> = {
  overview: OverviewTab,
  components: ComponentsTab,
  ai: AITab,
  docs: DocsTab,
  dashboard: DashboardTab,
  console: ConsoleTab,
  support: SupportTab,
};

/**
 * Renders all tabs that have been visited at least once. Each tab lives in its
 * own absolutely-positioned layer so the active one can fade in while inactive
 * ones stay mounted but hidden (preserving iframe state, scroll position, etc.).
 */
function TabContent({ activeTab }: { activeTab: TabId }) {
  const [mountedTabs, setMountedTabs] = useState<Set<TabId>>(() => new Set([activeTab]));
  const [animKey, setAnimKey] = useState(0);
  const prevTabRef = useRef<TabId>(activeTab);

  useEffect(() => {
    setMountedTabs((prev) => {
      if (prev.has(activeTab)) return prev;
      const next = new Set(prev);
      next.add(activeTab);
      return next;
    });

    if (prevTabRef.current !== activeTab) {
      setAnimKey((k) => k + 1);
      prevTabRef.current = activeTab;
    }
  }, [activeTab]);

  return (
    <div className="sdt-tab-layers">
      {Array.from(mountedTabs).map((tabId) => {
        const Component = TAB_COMPONENTS[tabId];
        const isActive = tabId === activeTab;
        return (
          <div
            key={tabId}
            className={`sdt-tab-pane ${isActive ? 'sdt-tab-pane-active' : ''}`}
            {...(isActive ? { 'data-anim-key': animKey } : {})}
          >
            <Component />
          </div>
        );
      })}
    </div>
  );
}

export function DevToolPanel({ onClose }: { onClose: () => void }) {
  const { state, setState } = useDevToolContext();
  const [isExiting, setIsExiting] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const isResizingRef = useRef<'width' | 'height' | 'both' | null>(null);
  const startPosRef = useRef({ x: 0, y: 0, width: 0, height: 0 });

  const handleClose = useCallback(() => {
    setIsExiting(true);
    setTimeout(() => {
      onClose();
      setIsExiting(false);
    }, 150);
  }, [onClose]);

  const setActiveTab = useCallback((tab: TabId) => {
    setState((prev) => ({ ...prev, activeTab: tab }));
  }, [setState]);

  // Resize handlers
  const onResizeMouseDown = useCallback((direction: 'width' | 'height' | 'both') => (e: React.MouseEvent) => {
    e.preventDefault();
    isResizingRef.current = direction;
    startPosRef.current = {
      x: e.clientX,
      y: e.clientY,
      width: state.panelWidth,
      height: state.panelHeight,
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!isResizingRef.current) return;
      const dir = isResizingRef.current;
      if (dir === 'width' || dir === 'both') {
        const delta = startPosRef.current.x - e.clientX;
        const newWidth = Math.max(400, Math.min(window.innerWidth - 32, startPosRef.current.width + delta));
        setState((prev) => ({ ...prev, panelWidth: newWidth }));
      }
      if (dir === 'height' || dir === 'both') {
        const delta = startPosRef.current.y - e.clientY;
        const newHeight = Math.max(250, Math.min(window.innerHeight - 80, startPosRef.current.height + delta));
        setState((prev) => ({ ...prev, panelHeight: newHeight }));
      }
    };

    const onMouseUp = () => {
      isResizingRef.current = null;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = direction === 'both' ? 'nwse-resize' : direction === 'width' ? 'ew-resize' : 'ns-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [state.panelWidth, state.panelHeight, setState]);

  const hasIframe = state.activeTab === 'docs' || state.activeTab === 'dashboard' || state.activeTab === 'support';

  const handleReloadIframe = useCallback(() => {
    const pane = panelRef.current?.querySelector<HTMLElement>('.sdt-tab-pane-active');
    const iframe = pane?.querySelector<HTMLIFrameElement>('iframe');
    if (iframe) {
      // Re-assigning iframe.src triggers a full reload of the iframe content
      iframe.src = iframe.src;
    }
  }, []);

  const trailingButtons = (
    <>
      {hasIframe && (
        <button className="sdt-close-btn" onClick={handleReloadIframe} aria-label="Reload" title="Reload">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1.5 7a5.5 5.5 0 0 1 9.17-4.1L12.5 5" />
            <path d="M12.5 1.5V5H9" />
            <path d="M12.5 7a5.5 5.5 0 0 1-9.17 4.1L1.5 9" />
            <path d="M1.5 12.5V9H5" />
          </svg>
        </button>
      )}
      <button className="sdt-close-btn" onClick={handleClose} aria-label="Close dev tools">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="3" y1="3" x2="11" y2="11" />
          <line x1="11" y1="3" x2="3" y2="11" />
        </svg>
      </button>
    </>
  );

  return (
    <div
      ref={panelRef}
      className={`sdt-panel ${isExiting ? 'sdt-panel-exiting' : ''}`}
      style={{
        width: state.panelWidth,
        height: state.panelHeight,
      }}
    >
      {/* Resize handles */}
      <div className="sdt-resize-handle" onMouseDown={onResizeMouseDown('width')} />
      <div className="sdt-resize-handle-top" onMouseDown={onResizeMouseDown('height')} />
      <div className="sdt-resize-handle-corner" onMouseDown={onResizeMouseDown('both')} />

      <div className="sdt-panel-inner">
        <DevToolTabBar
          tabs={TABS}
          activeTab={state.activeTab}
          onTabChange={setActiveTab}
          variant="bar"
          trailing={trailingButtons}
        />

        <div className="sdt-content">
          <TabContent activeTab={state.activeTab} />
        </div>
      </div>

      {state.showExportDialog && (
        <ExportDialog onClose={() => setState((prev) => ({ ...prev, showExportDialog: false }))} />
      )}
    </div>
  );
}

// END_PLATFORM
