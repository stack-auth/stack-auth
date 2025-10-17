import { useAdminApp } from "@/app/(main)/(protected)/projects/[projectId]/use-admin-app";
import { ALL_APPS_FRONTEND, AppFrontend, getAppPath } from "@/lib/apps-frontend";
import { ALL_APPS, AppId } from "@stackframe/stack-shared/dist/apps/apps-config";
import { typedIncludes } from "@stackframe/stack-shared/dist/utils/arrays";
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger, cn } from "@stackframe/stack-ui";
import { Link } from "./link";

export const appSquareWidthExpression = "max(min(11vw,180px),80px)";
export const appSquarePaddingExpression = "max(min(1vw,1.5rem),0.25rem)";

export function AppIcon({ appId, className, disabled, style }: {
  appId: AppId,
  className?: string,
  disabled?: boolean,
  style?: React.CSSProperties,
}) {
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
  const appFrontend: AppFrontend = ALL_APPS_FRONTEND[appId];
  return <div style={style} className={cn(
    "relative w-24 h-24 rounded-[24.154%] overflow-hidden select-none",
    !disabled && "bg-[linear-gradient(45deg,#dde,#fff)] dark:bg-[linear-gradient(45deg,#222,#666)]",
    disabled && 'border-gray-400/70 border-dashed border-4',
    className,
  )}>
    <div className={cn(
      "w-full h-full isolate relative",
    )}>
      {appFrontend.logo ? (
        <div
          className="absolute inset-[20%] w-[60%] h-[60%] rounded-[24.154%] flex items-center justify-center border"
          style={{
            opacity: disabled ? 0.6 : 1,
          }}
        >
          <appFrontend.logo className="rounded-[24.154%]" />
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
          <appFrontend.icon
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
  </div>;
}

export function AppSquare({ appId }: {
  appId: AppId,
}) {
  const app = ALL_APPS[appId];
  const appFrontend = ALL_APPS_FRONTEND[appId];

  const adminApp = useAdminApp();
  const project = adminApp.useProject();
  const config = project.useConfig();

  const isEnabled = config.apps.installed[appId].enabled;
  const appPath = getAppPath(project.id, appFrontend);
  const appDetailsPath = `/projects/${project.id}/apps/${appId}`;

  const setEnabled = async (enabled: boolean) => {
    await project.updateConfig({
      [`apps.installed.${appId}.enabled`]: enabled,
    });
  };

  return (
    <ContextMenu>
      <div className="flex flex-col items-center">
        <ContextMenuTrigger>
          <Link
            href={isEnabled ? appPath : appDetailsPath}
            className={cn(
              "flex flex-col items-center gap-1 sm:gap-2 transition-all duration-200 cursor-pointer group select-none",
              "p-2 rounded-lg",
              "hover:bg-foreground/15 hover:duration-0",
            )}
            style={{
              padding: appSquarePaddingExpression,
            }}
          >
            <AppIcon
              appId={appId}
              disabled={!isEnabled}
              style={{
                width: `calc(${appSquareWidthExpression} - 2 * ${appSquarePaddingExpression})`,
                height: `calc(${appSquareWidthExpression} - 2 * ${appSquarePaddingExpression})`,
              }}
              className={cn(
                `shadow-md`,
              )}
            />
            <span className={cn(
              "text-xs lg:text-sm text-center max-w-20 sm:max-w-28 md:max-w-32 lg:max-w-36 truncate select-none",
              isEnabled
                ? 'text-gray-700 dark:text-gray-300'
                : 'text-gray-600 dark:text-gray-400'
            )}
            >
              {app.displayName}
            </span>
          </Link>
        </ContextMenuTrigger>
      </div>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => window.open(appPath, '_blank')}>
          Open in new tab
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => runAsynchronouslyWithAlert(setEnabled(!isEnabled))}>
          {isEnabled ? 'Disable' : 'Enable'}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
