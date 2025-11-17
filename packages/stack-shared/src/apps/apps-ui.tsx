import { typedIncludes } from "../utils/arrays";
import { ALL_APPS, AppId } from "./apps-config";

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
  disabled,
  style,
  cn,
}: AppIconProps) {
  const svgGradients = (gradients: Record<string, string[]>) => {
    return (
      <svg width="0" height="0">
        {Object.entries(gradients).map(([id, gradient]) => {
          return (
            <linearGradient key={id} id={id} x1="100%" y1="100%" x2="0%" y2="0%">
              {gradient.map((color, index) => {
                return <stop key={index} stopColor={color} offset={`${index * 100 / (gradient.length - 1)}%`} />;
              })}
            </linearGradient>
          );
        })}
      </svg>
    );
  };

  const app = ALL_APPS[appId];

  return (
    <div
      style={style}
      className={cn(
        "relative w-24 h-24 rounded-[24.154%] overflow-hidden select-none",
        !disabled && "bg-[linear-gradient(45deg,#dde,#fff)] dark:bg-[linear-gradient(45deg,#222,#666)]",
        disabled && 'border-gray-400/70 border-dashed border-4',
        className,
      )}
    >
      <div className={cn("w-full h-full isolate relative")}>
        {LogoComponent ? (
          <div
            className="absolute inset-[20%] w-[60%] h-[60%] rounded-[24.154%] overflow-hidden flex items-center justify-center border"
            style={{
              opacity: disabled ? 0.6 : 1,
            }}
          >
            <LogoComponent />
          </div>
        ) : (
          <>
            <svg width="0" height="0">
              {svgGradients({
                "app-icon-gradient-light": ["#c0f", "#66f", "#4af"],
                "app-icon-gradient-dark": ["#3ec", "#9af", "#a5f"],
                "app-icon-gradient-light-expert": ["#f0c", "#f66", "#fa4"],
                "app-icon-gradient-dark-expert": ["#f0c", "#f66", "#fa4"],
                "app-icon-gradient-light-integration": ["#E5AB00", "#FFBA00", "#F8DF80"],
                "app-icon-gradient-dark-integration": ["#E5AB00", "#FFBA00", "#F8DF80"],
              })}
            </svg>
            <IconComponent
              opacity={disabled ? 0.75 : 1}
              className={cn(
                "inset-[20%] w-[60%] h-[60%] bg-clip-text text-transparent text-white absolute",
                (typedIncludes(app.tags, "expert")
                  ? "stroke-[url(#app-icon-gradient-light-expert)] dark:stroke-[url(#app-icon-gradient-dark-expert)]"
                  : typedIncludes(app.tags, "integration")
                    ? "stroke-[url(#app-icon-gradient-light-integration)] dark:stroke-[url(#app-icon-gradient-dark-integration)]"
                    : "stroke-[url(#app-icon-gradient-light)] dark:stroke-[url(#app-icon-gradient-dark)]"
                )
              )}
            />
          </>
        )}
      </div>
      <div className="absolute top-0 left-[-100%] right-0 flex flex-col gap-1 [transform:_rotate(-45deg)_translateY(24px)] [transform-origin:top_center]">
        {app.stage !== "stable" && (
          <div className={cn(
            "h-4 uppercase text-xs font-bold font-mono tracking-widest text-center",
            disabled
              ? "bg-gray-400/80 text-white"
              : app.stage === "alpha"
                ? "bg-red-500 text-white"
                : "bg-yellow-600 text-white"
            )}
          >
            {app.stage}
          </div>
        )}
      </div>
    </div>
  );
}

