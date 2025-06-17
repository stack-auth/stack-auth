"use client";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import * as React from "react";
import { cn } from "../../lib/cn";

const Tabs = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Root>
>((props, ref) => {
  return (
    <TabsPrimitive.Root
      ref={ref}
      {...props}
      className={cn(
        "flex flex-col overflow-hidden rounded-xl border bg-fd-secondary shadow-sm backdrop-blur-sm",
        props.className,
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
>((props, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    {...props}
    className={cn(
      "relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-all duration-200 ease-out [&_svg]:size-4 text-fd-muted-foreground hover:text-fd-accent-foreground disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-fd-background data-[state=active]:text-fd-primary data-[state=active]:shadow-sm",
      "before:absolute before:inset-0 before:rounded-lg before:opacity-0 before:transition-opacity before:duration-200",
      "hover:before:opacity-5",
      props.className,
    )}
  />
));
TabsTrigger.displayName = "TabsTrigger";

const TabsContent = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>((props, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    {...props}
    className={cn(
      "relative p-3 text-sm bg-fd-background outline-none",
      "before:absolute before:inset-0 before:opacity-0 before:transition-opacity before:duration-300",
      "focus-visible:before:opacity-100",
      props.className,
    )}
  />
));
TabsContent.displayName = "TabsContent";

export { Tabs, TabsContent, TabsList, TabsTrigger };

