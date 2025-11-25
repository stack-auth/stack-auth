import React from "react";
import { AppId } from "./apps-config";

export const appSquareWidthExpression = "max(min(11vw,180px),80px)";
export const appSquarePaddingExpression = "max(min(1vw,1.5rem),0.25rem)";

export type AppIconProps = {
  appId: AppId,
  /**
   * Icon component from the app frontend config
   */
  IconComponent: React.FunctionComponent<React.SVGProps<SVGSVGElement>>,
  /**
   * Optional logo component from the app frontend config
   */
  LogoComponent?: React.FunctionComponent<{}>,
  className?: string,
  /**
   * Whether this app is enabled/installed (shows green icon)
   */
  enabled?: boolean,
  /**
   * Whether this app is disabled (shows dashed border)
   */
  disabled?: boolean,
  style?: React.CSSProperties,
  /**
   * cn utility function for className merging (e.g., from stack-ui or tailwind-merge)
   */
  cn: (...inputs: any[]) => string,
};

export function AppIcon({
  appId,
  IconComponent,
  LogoComponent,
  className,
  enabled = false,
  disabled,
  style,
  cn,
}: AppIconProps) {
  return (
    <div
      style={style}
      className={cn(
        "relative w-12 h-12 sm:w-14 sm:h-14 rounded-[20%] overflow-hidden select-none border",
        !disabled && "bg-gray-100 dark:bg-gray-900 border-gray-200 dark:border-gray-700/50",
        disabled && 'bg-gray-100 dark:bg-gray-900 border-gray-300 dark:border-gray-700 border-dashed',
        className,
      )}
    >
      <div className={cn("w-full h-full isolate relative flex items-center justify-center")}>
        {LogoComponent ? (
          <div
            className={cn(
              "w-[50%] h-[50%] flex items-center justify-center",
              !enabled && "grayscale opacity-60"
            )}
          >
            <LogoComponent />
          </div>
        ) : (
          <IconComponent
            className={cn(
              "w-[50%] h-[50%]",
              enabled
                ? "stroke-emerald-500 dark:stroke-emerald-400"
                : "stroke-gray-400 dark:stroke-gray-500"
            )}
            style={{
              opacity: disabled ? 0.5 : 1,
            }}
          />
        )}
      </div>
    </div>
  );
}

