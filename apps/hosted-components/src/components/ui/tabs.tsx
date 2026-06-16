import { forwardRefIfNeeded } from "@hexclave/shared/dist/utils/react";
import React from "react";

import { cn } from "./utils";

type TabsContextValue = {
  value: string,
  setValue: (value: string) => void,
};

const TabsContext = React.createContext<TabsContextValue | null>(null);

function useTabsContext() {
  const context = React.useContext(TabsContext);
  if (context == null) {
    throw new Error("Tabs components must be rendered inside Tabs");
  }
  return context;
}

type TabsProps = React.HTMLAttributes<HTMLDivElement> & {
  defaultValue: string,
  value?: string,
  onValueChange?: (value: string) => void,
};

function Tabs({ defaultValue, value, onValueChange, ...props }: TabsProps) {
  const [uncontrolledValue, setUncontrolledValue] = React.useState(defaultValue);
  const currentValue = value ?? uncontrolledValue;

  const contextValue = React.useMemo<TabsContextValue>(() => ({
    value: currentValue,
    setValue: (nextValue) => {
      setUncontrolledValue(nextValue);
      onValueChange?.(nextValue);
    },
  }), [currentValue, onValueChange]);

  return (
    <TabsContext.Provider value={contextValue}>
      <div {...props} />
    </TabsContext.Provider>
  );
}

const TabsList = forwardRefIfNeeded<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, children, ...props }, ref) => {
    const tabs = useTabsContext();
    const containerRef = React.useRef<HTMLDivElement | null>(null);
    const [indicatorStyle, setIndicatorStyle] = React.useState<{ left: number, top: number, width: number, height: number } | null>(null);

    const measure = React.useCallback(() => {
      const container = containerRef.current;
      if (container == null) {
        return;
      }
      const activeTab = container.querySelector<HTMLElement>('[role="tab"][data-state="active"]');
      if (activeTab == null) {
        setIndicatorStyle(null);
        return;
      }
      setIndicatorStyle({
        left: activeTab.offsetLeft,
        top: activeTab.offsetTop,
        width: activeTab.offsetWidth,
        height: activeTab.offsetHeight,
      });
    }, []);

    // useLayoutEffect so the indicator is positioned before paint on mount, then
    // re-measured whenever the active value changes (which is what drives the glide).
    React.useLayoutEffect(() => {
      measure();
    }, [measure, tabs.value]);

    React.useEffect(() => {
      const container = containerRef.current;
      if (container == null) {
        return;
      }
      const observer = new ResizeObserver(() => measure());
      observer.observe(container);
      return () => observer.disconnect();
    }, [measure]);

    return (
      <div
        ref={(node) => {
          containerRef.current = node;
          if (typeof ref === "function") {
            ref(node);
          } else if (ref != null) {
            ref.current = node;
          }
        }}
        role="tablist"
        className={cn("stack-scope relative inline-flex h-9 items-center justify-center rounded-lg border border-black/[0.08] bg-zinc-100/70 p-1 text-muted-foreground dark:border-white/[0.10] dark:bg-zinc-900/45", className)}
        {...props}
      >
        {indicatorStyle != null && (
          <div
            aria-hidden
            className="pointer-events-none absolute rounded-md border border-black/[0.08] bg-white/80 shadow-sm transition-[left,top,width,height] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] dark:border-white/[0.10] dark:bg-zinc-800/80 dark:ring-1 dark:ring-white/[0.06]"
            style={{
              left: indicatorStyle.left,
              top: indicatorStyle.top,
              width: indicatorStyle.width,
              height: indicatorStyle.height,
            }}
          />
        )}
        {children}
      </div>
    );
  },
);
TabsList.displayName = "TabsList";

const TabsTrigger = forwardRefIfNeeded<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { value: string }>(
  ({ className, value, onClick, ...props }, ref) => {
    const tabs = useTabsContext();
    const active = tabs.value === value;

    return (
      <button
        ref={ref}
        type="button"
        role="tab"
        aria-selected={active}
        data-state={active ? "active" : "inactive"}
        className={cn(
          "relative z-10 inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium text-muted-foreground ring-offset-background transition-colors duration-300 hover:text-foreground/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:font-semibold data-[state=active]:text-foreground",
          className,
        )}
        onClick={(event) => {
          tabs.setValue(value);
          onClick?.(event);
        }}
        {...props}
      />
    );
  },
);
TabsTrigger.displayName = "TabsTrigger";

const TabsContent = forwardRefIfNeeded<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & { value: string }>(
  ({ className, value, ...props }, ref) => {
    const tabs = useTabsContext();
    const active = tabs.value === value;
    if (!active) {
      return null;
    }

    return (
      <div
        ref={ref}
        role="tabpanel"
        data-state="active"
        className={cn("mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2", className)}
        {...props}
      />
    );
  },
);
TabsContent.displayName = "TabsContent";

export { Tabs, TabsList, TabsTrigger, TabsContent };
