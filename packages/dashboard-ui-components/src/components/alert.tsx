"use client";

import { CheckCircle, Info, WarningCircle, XCircle } from "@phosphor-icons/react";
import { cn } from "@stackframe/stack-ui";

type DesignAlertVariant = "default" | "success" | "error" | "warning" | "info";

const variantIconMap = new Map<DesignAlertVariant, React.ElementType>([
  ["default", Info],
  ["success", CheckCircle],
  ["error", XCircle],
  ["warning", WarningCircle],
  ["info", Info],
]);

type VariantStyles = {
  container: string,
  icon: string,
  title: string,
};

const variantStyles = new Map<DesignAlertVariant, VariantStyles>([
  [
    "default",
    {
      container: "bg-background border-border",
      icon: "text-foreground",
      title: "text-foreground",
    },
  ],
  [
    "success",
    {
      container: "bg-green-500/[0.06] border-green-500/30",
      icon: "text-green-500",
      title: "text-green-600 dark:text-green-400",
    },
  ],
  [
    "error",
    {
      container: "bg-red-500/[0.06] border-red-500/30",
      icon: "text-red-500",
      title: "text-red-600 dark:text-red-400",
    },
  ],
  [
    "warning",
    {
      container: "bg-amber-500/[0.08] border-amber-500/40",
      icon: "text-amber-600 dark:text-amber-400",
      title: "text-amber-700 dark:text-amber-300",
    },
  ],
  [
    "info",
    {
      container: "bg-blue-500/[0.06] border-blue-500/30",
      icon: "text-blue-500",
      title: "text-blue-600 dark:text-blue-400",
    },
  ],
]);

function getMapValueOrThrow<TKey, TValue>(map: Map<TKey, TValue>, key: TKey, mapName: string) {
  const value = map.get(key);
  if (!value) {
    throw new Error(`Missing ${mapName} entry for key "${String(key)}"`);
  }
  return value;
}

export type DesignAlertProps = React.HTMLAttributes<HTMLDivElement> & {
  variant?: DesignAlertVariant,
  title?: React.ReactNode,
  description?: React.ReactNode,
  glassmorphic?: boolean,
};

export function DesignAlert({
  variant = "default",
  title,
  description,
  glassmorphic = false,
  className,
  children,
  ...props
}: DesignAlertProps) {
  const styles = getMapValueOrThrow(variantStyles, variant, "variantStyles");
  const Icon = getMapValueOrThrow(variantIconMap, variant, "variantIconMap");

  return (
    <div
      role="alert"
      className={cn(
        "relative w-full rounded-2xl border p-4 text-sm",
        "flex gap-3 items-start",
        styles.container,
        glassmorphic && "backdrop-blur-xl",
        className
      )}
      {...props}
    >
      <Icon className={cn("h-4 w-4 mt-0.5 flex-shrink-0", styles.icon)} />
      <div className="min-w-0">
        {title && (
          <h5 className={cn("mb-1 font-medium leading-none tracking-tight", styles.title)}>
            {title}
          </h5>
        )}
        {description && (
          <div className="text-sm text-foreground/80 dark:text-muted-foreground [&_p]:leading-relaxed">
            {description}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
