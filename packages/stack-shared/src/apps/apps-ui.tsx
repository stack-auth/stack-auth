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
        "relative w-[72px] h-[72px] overflow-hidden select-none",
        "rounded-[20%] supports-[corner-shape:superellipse(1.5)]:[border-radius:30%] supports-[corner-shape:superellipse(1.5)]:[corner-shape:superellipse(1.5)]",  // https://x.com/konstiwohlwend/status/1991221528206405685
        "!shadow-[0_10px_24px_0_rgba(10,69,151,0.28)]",
        "before:absolute before:inset-0 before:bg-gradient-to-br before:from-[#4E7598] before:via-[#0D233D] before:to-[#4E7598] before:rounded-[inherit] before:supports-[corner-shape:superellipse(1.5)]:[border-radius:30%] before:supports-[corner-shape:superellipse(1.5)]:[corner-shape:superellipse(1.5)]",
        // !disabled && "bg-gray-300 dark:bg-gray-900",
        // disabled && 'bg-gray-300 dark:bg-gray-900',
        className,
      )}
    >
      <div className={cn("absolute inset-[1px] isolate flex items-center justify-center rounded-[inherit] supports-[corner-shape:superellipse(1.5)]:[border-radius:30%] supports-[corner-shape:superellipse(1.5)]:[corner-shape:superellipse(1.5)]", !disabled && "bg-gradient-to-br from-[#163050] to-[#090C11]", disabled && "bg-gray-300 dark:bg-gray-900")}>
        {LogoComponent ? (
          <div
            className={cn(
              "w-[40%] h-[40%] flex items-center justify-center",
              !enabled && "grayscale opacity-60"
            )}
          >
            <LogoComponent />
          </div>
        ) : (
          <IconComponent
            className={cn(
              "w-[40%] h-[40%]",
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

