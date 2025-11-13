import { useAdminApp } from "@/app/(main)/(protected)/projects/[projectId]/use-admin-app";
import { ALL_APPS_FRONTEND, AppFrontend, getAppPath } from "@/lib/apps-frontend";
import { ALL_APPS, AppId } from "@stackframe/stack-shared/dist/apps/apps-config";
import { AppIcon as SharedAppIcon, appSquarePaddingExpression, appSquareWidthExpression } from "@stackframe/stack-shared/dist/apps/apps-ui";
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger, cn } from "@stackframe/stack-ui";
import { Link } from "./link";

export { appSquarePaddingExpression, appSquareWidthExpression };

export function AppIcon({ appId, className, disabled, style }: {
  appId: AppId,
  className?: string,
  disabled?: boolean,
  style?: React.CSSProperties,
}) {
  const appFrontend: AppFrontend = ALL_APPS_FRONTEND[appId];

  return (
    <SharedAppIcon
      appId={appId}
      IconComponent={appFrontend.icon}
      LogoComponent={appFrontend.logo}
      className={className}
      disabled={disabled}
      style={style}
      cn={cn}
    />
  );
}

export function AppSquare({ appId }: {
  appId: AppId,
}) {
  const app = ALL_APPS[appId];
  const appFrontend = ALL_APPS_FRONTEND[appId];

  const adminApp = useAdminApp();
  const project = adminApp.useProject();
  const config = project.useConfig();

  const isEnabled = config.apps.installed[appId]?.enabled ?? false;
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
