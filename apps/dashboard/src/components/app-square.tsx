import { useAdminApp } from "@/app/(main)/(protected)/projects/[projectId]/use-admin-app";
import { ALL_APPS_FRONTEND, getAppPath } from "@/lib/apps-frontend";
import { ALL_APPS, AppId } from "@stackframe/stack-shared/dist/apps/apps-config";
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger, cn } from "@stackframe/stack-ui";
import Image from "next/image";
import AppBgDark from "../../public/app-bg-dark.png";
import AppBgLight from "../../public/app-bg-light.png";
import { Link } from "./link";

export const appSquareWidthExpression = "max(min(16vw,180px),128px)";
export const appSquarePaddingExpression = "max(min(1vw,1.5rem),0.25rem)";

export function AppIcon({ appId, className, disabled, style }: {
  appId: AppId,
  className?: string,
  disabled?: boolean,
  style?: React.CSSProperties,
}) {
  const appFrontend = ALL_APPS_FRONTEND[appId];
  return <div style={style} className={cn(
    "relative w-24 h-24 rounded-[24.154%] overflow-hidden p-[20%] select-none",
    className
  )}>
    <div className={cn(
      "absolute inset-0 hidden dark:block rounded-[24.154%]",
      !disabled && "bg-[linear-gradient(45deg,#222_0%,#666_100%)]",
      disabled && 'border border-gray-500/50 border-dashed border-4 bg-gray-500/20'
    )}>
      <Image src={AppBgDark} alt="App background" fill className="object-cover hidden" />
    </div>
    <div className={cn(
      "absolute inset-0 block dark:hidden",
      !disabled && "bag-[linear-gradient(45deg,_rgba(10,_201,_150,_1)_0%,_rgba(15,_28,_98,_1)_50%,_rgba(170,_68,_242,_1)_100%)]",
      disabled && 'border border-gray-500/500 border-dashed border-4'
    )}>
      <Image src={AppBgLight} alt="App background" fill className="object-cover" />
    </div>
    <div className={cn(
      "w-full h-full isolate relative",
      "bg-red z-1",
    )}>
      <svg width="0" height="0">
        <linearGradient id="app-icon-gradient-light" x1="100%" y1="100%" x2="0%" y2="0%">
          <stop stopColor="#0AC996" offset="0%" />
          <stop stopColor="#051C62" offset="50%" />
          <stop stopColor="#AA44F2" offset="100%" />
        </linearGradient>
      </svg>
      <svg width="0" height="0">
        <linearGradient id="app-icon-gradient-dark" x1="100%" y1="100%" x2="0%" y2="0%">
          <stop stopColor="#30E6C8" offset="0%" />
          <stop stopColor="#9EA3FE" offset="50%" />
          <stop stopColor="#AE55F2" offset="100%" />
        </linearGradient>
      </svg>
      <appFrontend.icon
        className={cn(
          "w-full h-full bg-clip-text text-transparent text-white",
          disabled
            ? "stroke-gray-500/50"
            : "stroke-[url(#app-icon-gradient-light)] dark:stroke-[url(#app-icon-gradient-dark)]"
        )} />
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
              "text-xs sm:text-sm text-center max-w-20 sm:max-w-28 md:max-w-32 lg:max-w-36 truncate select-none",
              isEnabled
                ? 'text-gray-700 dark:text-gray-300'
                : 'text-gray-500 dark:text-gray-500'
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
