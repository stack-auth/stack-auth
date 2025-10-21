"use client";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import * as React from "react";
import { cn } from "../../lib/cn";

type TabsRootProps = React.ComponentPropsWithoutRef<typeof TabsPrimitive.Root> & {
  "data-tabs-root-id"?: string,
};

const Tabs = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Root>,
  TabsRootProps
>(({ className, "data-tabs-root-id": dataTabsRootId, ...props }, ref) => {
  const generatedId = React.useId();
  const normalizedId = React.useMemo(
    () => `tabs-root-${generatedId.replace(/:/g, "")}`,
    [generatedId],
  );
  const rootId = dataTabsRootId ?? normalizedId;

  return (
    <TabsPrimitive.Root
      ref={ref}
      data-tabs-root
      data-tabs-root-id={rootId}
      {...props}
      className={cn(
        "flex flex-col overflow-hidden rounded-xl border bg-fd-secondary shadow-sm backdrop-blur-sm",
        className,
      )}
    />
  );
});

Tabs.displayName = "Tabs";

const TabsList = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>((props, ref) => (
  <TabsPrimitive.List
    ref={ref}
    data-tabs-list
    {...props}
    className={cn(
      "flex gap-1 p-1 text-fd-secondary-foreground overflow-x-auto backdrop-blur-sm not-prose",
      props.className,
    )}
  />
));
TabsList.displayName = "TabsList";

const TabsTrigger = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, value, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    value={value}
    data-tabs-trigger
    data-tab-value={value}
    {...props}
    className={cn(
      "relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-all duration-200 ease-out [&_svg]:size-4 text-fd-muted-foreground hover:text-fd-accent-foreground disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-fd-background data-[state=active]:text-fd-primary data-[state=active]:shadow-sm",
      "before:absolute before:inset-0 before:rounded-lg before:opacity-0 before:transition-opacity before:duration-200",
      "hover:before:opacity-5",
      className,
    )}
  />
));
TabsTrigger.displayName = "TabsTrigger";

const TabsContent = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, value, forceMount = true, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    value={value}
    forceMount={forceMount}
    data-tabs-content
    data-tab-value={value}
    {...props}
    className={cn(
      "relative p-3 text-sm bg-fd-background outline-none",
      "before:absolute before:inset-0 before:opacity-0 before:transition-opacity before:duration-300 before:pointer-events-none",
      "focus-visible:before:opacity-100",
      "data-[state=inactive]:hidden",
      className,
    )}
  />
));
TabsContent.displayName = "TabsContent";

export { Tabs, TabsContent, TabsList, TabsTrigger };
