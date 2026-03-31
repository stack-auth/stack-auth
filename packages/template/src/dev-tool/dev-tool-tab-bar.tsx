"use client";

import React, { useEffect, useRef, useState } from "react";

// IF_PLATFORM react-like

export type TabDef<T extends string = string> = {
  id: T;
  label: string;
  icon?: React.ReactNode;
};

/**
 * Measures the active tab button's position and returns inline styles for the
 * sliding indicator element.  Skips the CSS transition on first render so it
 * doesn't animate in from nowhere.
 */
function useTabIndicator<T extends string>(
  activeTab: T,
  barRef: React.RefObject<HTMLDivElement | null>,
) {
  const [style, setStyle] = useState<React.CSSProperties>({ opacity: 0 });
  const initialRef = useRef(true);

  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;

    function measure() {
      const btn = bar!.querySelector<HTMLElement>(`[data-tab-id="${activeTab}"]`);
      if (!btn) return;

      // Use offset* instead of getBoundingClientRect so the measurement isn't
      // affected by CSS transforms (e.g. the panel's scale-in animation).
      setStyle({
        transform: `translateX(${btn.offsetLeft}px)`,
        width: `${btn.offsetWidth}px`,
        height: `${btn.offsetHeight}px`,
        opacity: 1,
        transition: initialRef.current ? 'none' : undefined,
      });
      initialRef.current = false;
    }

    measure();

    const ro = new ResizeObserver(measure);
    ro.observe(bar);
    return () => ro.disconnect();
  }, [activeTab, barRef]);

  return style;
}

/**
 * A reusable animated tab bar with a sliding active indicator.
 *
 * @param tabs       Array of tab definitions.
 * @param activeTab  Currently active tab id.
 * @param onTabChange  Called when a tab is clicked.
 * @param variant    Visual variant — `"bar"` for the main tabbar,
 *                   `"pills"` for the console-style pill group.
 * @param trailing   Optional element rendered after the tabs (e.g. a close or clear button).
 */
export function DevToolTabBar<T extends string>({
  tabs,
  activeTab,
  onTabChange,
  variant = 'bar',
  trailing,
}: {
  tabs: readonly TabDef<T>[];
  activeTab: T;
  onTabChange: (tab: T) => void;
  variant?: 'bar' | 'pills';
  trailing?: React.ReactNode;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const indicatorStyle = useTabIndicator(activeTab, barRef);

  const barClass = variant === 'pills' ? 'sdt-console-tabs' : 'sdt-tabbar';
  const tabClass = variant === 'pills' ? 'sdt-console-tab' : 'sdt-tab';
  const indicatorClass = variant === 'pills' ? 'sdt-console-tab-indicator' : 'sdt-tab-indicator';

  return (
    <div className={barClass} ref={barRef}>
      <div className={indicatorClass} style={indicatorStyle} />
      {tabs.map((tab) => (
        <button
          key={tab.id}
          className={tabClass}
          data-tab-id={tab.id}
          data-active={activeTab === tab.id}
          onClick={() => onTabChange(tab.id)}
        >
          {tab.icon && <span className="sdt-tab-icon">{tab.icon}</span>}
          {tab.label}
        </button>
      ))}
      {variant === 'bar' && <div className="sdt-tabbar-spacer" />}
      {trailing}
    </div>
  );
}

// END_PLATFORM
