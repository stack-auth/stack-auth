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

  const filterId = "glow-fx";

  return (
    <>
      {/* theoretically, this only needs to be in the dom once: */}
      <svg height="0" width="0" style={{ position: "absolute", marginLeft: "-100%" }}>
        <defs>
          <filter id={filterId} colorInterpolationFilters="sRGB" x="-50%" y="-50%" width="200%" height="200%">
            {/* drop shadow */}
            <feOffset dx="0" dy="2" in="SourceAlpha" result="dropOffset" />
            <feGaussianBlur stdDeviation="8" in="dropOffset" result="dropBlur" />
            <feFlood floodColor="#4271FF" floodOpacity="0.8" result="dropFlood" />
            <feComposite operator="in" in="dropFlood" in2="dropBlur" result="dropShadow" />
            {/* outer shadow */}
            <feOffset dx="0" dy="0" in="SourceAlpha" result="outerOffset" />
            <feGaussianBlur stdDeviation="4" in="outerOffset" result="outerBlur" />
            <feFlood floodColor="#00BBFF" floodOpacity="0.3" result="outerFlood" />
            <feComposite operator="in" in="outerFlood" in2="outerBlur" result="outerShadow" />
            {/* Combine: drop shadow behind, then outer shadow, then source graphic on top */}
            <feComposite operator="over" in="outerShadow" in2="dropShadow" result="combinedShadows" />
            <feComposite operator="over" in="SourceGraphic" in2="combinedShadows" />
          </filter>
        </defs>
      </svg>
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
                "w-[42%] h-[42%] flex items-center justify-center",
                "[&_svg]:overflow-visible",
                !enabled && "grayscale opacity-60"
              )}
              style={{ filter: `url(#${filterId})` }}
            >
              <LogoComponent />
            </div>
          ) : (
            <IconComponent
              className={cn(
                "w-[42%] h-[42%]",
                enabled
                  ? "stroke-emerald-500 dark:stroke-emerald-400"
                  : "stroke-gray-400 dark:stroke-gray-500"
              )}
              style={{
                opacity: disabled ? 0.5 : 1,
                filter: `url(#${filterId})`,
              }}
              overflow="visible"
            />
          )}
        </div>
      </div>
    </>
  );
}

