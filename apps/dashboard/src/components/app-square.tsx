import { useAdminApp } from "@/app/(main)/(protected)/projects/[projectId]/use-admin-app";
import { ALL_APPS_FRONTEND, AppFrontend, getAppPath } from "@/lib/apps-frontend";
import { ALL_APPS, AppId } from "@stackframe/stack-shared/dist/apps/apps-config";
import { AppIcon as SharedAppIcon, appSquarePaddingExpression, appSquareWidthExpression } from "@stackframe/stack-shared/dist/apps/apps-ui";
import { Button, cn } from "@stackframe/stack-ui";
import { Check } from "lucide-react";
import { useState } from "react";
import { AppWarningModal } from "./app-warning-modal";
import { Link } from "./link";

export { appSquarePaddingExpression, appSquareWidthExpression };

type AppSquareVariant = "default" | "installed" | "featured";

export function AppIcon({
  appId,
  className,
  variant = "default",
  enabled = false,
}: {
  appId: AppId,
  className?: string,
  variant?: AppSquareVariant,
  enabled?: boolean,
}) {
  const appFrontend: AppFrontend = ALL_APPS_FRONTEND[appId];

  return (
    <SharedAppIcon
      appId={appId}
      IconComponent={appFrontend.icon}
      LogoComponent={appFrontend.logo}
      className={className}
      enabled={enabled || variant === "installed"}
      cn={cn}
    />
  );
}

export function AppSquare({
  appId,
  variant = "default",
  showSubtitle = false,
  onToggleEnabled
}: {
  appId: AppId,
  variant?: AppSquareVariant,
  showSubtitle?: boolean,
  onToggleEnabled?: (enabled: boolean) => void,
}) {
  const app = ALL_APPS[appId];
  const appFrontend = ALL_APPS_FRONTEND[appId];
  const [isHovered, setIsHovered] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showWarningModal, setShowWarningModal] = useState(false);

  const adminApp = useAdminApp()!;
  const project = adminApp.useProject();
  const config = project.useConfig();

  const isEnabled = config.apps.installed[appId]?.enabled ?? false;

  const handleToggleEnabled = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (isProcessing) return;

    // Show warning modal for alpha/beta apps when enabling
    if (!isEnabled && app.stage !== "stable") {
      setShowWarningModal(true);
      return;
    }

    // Direct disable for enabled apps or enable for stable apps
    await performToggle();
  };

  const performToggle = async () => {
    setIsProcessing(true);
    try {
      await project.updateConfig({
        [`apps.installed.${appId}.enabled`]: !isEnabled,
      });
      onToggleEnabled?.(!isEnabled);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <>
      <div
        className={cn(
          "group relative aspect-square",
          isProcessing && "pointer-events-none opacity-50"
        )}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <div
          className={cn(
            "absolute inset-0 flex flex-col items-center p-3 sm:p-4 rounded-xl sm:rounded-2xl transition-all duration-200 cursor-default overflow-hidden",
            "bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-800",
            "hover:border-gray-300 dark:hover:border-gray-700 hover:shadow-lg",
            isEnabled && "border-green-500/40 dark:border-green-500/30 bg-green-50/30 dark:bg-green-950/20"
          )}
        >
          {/* Icon container - fixed height portion */}
          <div className="flex items-center justify-center w-full h-[45%]">
            <AppIcon
              appId={appId}
              variant={isEnabled ? "installed" : variant}
            />
          </div>

          {/* Text container - fixed height portion */}
          <div className="w-full h-[55%] flex flex-col items-center justify-start pt-2 overflow-hidden">
            <span className={cn(
              "text-[11px] sm:text-xs font-medium text-center w-full line-clamp-1",
              "text-gray-900 dark:text-gray-100"
            )}>
              {app.displayName}
            </span>

            {showSubtitle && (
              <span className="mt-1 text-[9px] sm:text-[10px] text-gray-500 dark:text-gray-400 text-center line-clamp-2 w-full leading-normal">
                {app.subtitle}
              </span>
            )}
          </div>

          {/* Hover actions */}
          <div className={cn(
            "absolute inset-x-0 bottom-3 sm:bottom-4 flex justify-center transition-all duration-200",
            (isHovered || isProcessing) ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2 pointer-events-none"
          )}>
            <Button
              onClick={handleToggleEnabled}
              loading={isProcessing}
              variant="plain"
              size="plain"
              className={cn(
                "px-3 sm:px-4 py-1 sm:py-1.5 text-[10px] sm:text-xs font-medium rounded-full transition-all h-auto min-h-0",
                "shadow-lg backdrop-blur-sm",
                isProcessing && "px-2 sm:px-3 py-1 text-[9px] sm:text-[10px]",
                isEnabled
                  ? "bg-gray-900/90 dark:bg-gray-100/90 text-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-200"
                  : "bg-blue-600/90 text-white hover:bg-blue-700"
              )}
            >
              {isEnabled ? 'Disable' : 'Enable'}
            </Button>
          </div>
        </div>

        {/* Status badges in top-right corner */}
        {isEnabled && (
          <div className="absolute top-2 right-2 sm:top-3 sm:right-3 w-5 h-5 sm:w-6 sm:h-6 bg-green-500 rounded-full flex items-center justify-center shadow-md z-10">
            <Check className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-white" strokeWidth={3} />
          </div>
        )}

        {!isEnabled && app.stage !== "stable" && (
          <div className="absolute top-2 right-2 sm:top-3 sm:right-3 z-10">
            <div className={cn(
              "px-1.5 sm:px-2 py-0.5 rounded sm:rounded-md text-[8px] sm:text-[10px] font-bold uppercase tracking-wide border",
              app.stage === "alpha"
                ? "bg-orange-500/10 text-orange-500 border-orange-500/50"
                : "bg-blue-500/10 text-blue-500 border-blue-500/50"
            )}>
              {app.stage === "alpha" ? "Alpha" : "Beta"}
            </div>
          </div>
        )}
      </div>

      {/* Warning Modal */}
      {app.stage !== "stable" && (
        <AppWarningModal
          isOpen={showWarningModal}
          onClose={() => setShowWarningModal(false)}
          onConfirm={performToggle}
          appName={app.displayName}
          stage={app.stage as "alpha" | "beta"}
        />
      )}
    </>
  );
}

// Compact version for lists
export function AppListItem({
  appId,
  onEnable,
  showActions = true
}: {
  appId: AppId,
  onEnable?: () => void | Promise<void>,
  showActions?: boolean,
}) {
  const app = ALL_APPS[appId];
  const appFrontend = ALL_APPS_FRONTEND[appId];
  const [isLoading, setIsLoading] = useState(false);

  const adminApp = useAdminApp()!;
  const project = adminApp.useProject();
  const config = project.useConfig();

  const isEnabled = config.apps.installed[appId]?.enabled ?? false;
  const appPath = getAppPath(project.id, appFrontend);
  const appDetailsPath = `/projects/${project.id}/apps/${appId}`;

  const handleEnable = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    setIsLoading(true);
    try {
      await onEnable?.();
    } catch (error) {
      // Re-throw to let Button component handle it via runAsynchronouslyWithAlert
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Link
      href={isEnabled ? appPath : appDetailsPath}
      className={cn(
        "flex items-center gap-3 p-3 rounded-lg transition-all",
        "hover:bg-gray-50 dark:hover:bg-gray-800/50",
        isEnabled && "bg-green-50/50 dark:bg-green-900/10 border border-green-200 dark:border-green-800"
      )}
    >
      <AppIcon
        appId={appId}
        variant={isEnabled ? "installed" : "default"}
      />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
            {app.displayName}
          </span>
          {app.stage !== "stable" && (
            <div className={cn(
              "px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide",
              "border",
              app.stage === "alpha"
                ? "bg-orange-50 dark:bg-orange-950/30 text-orange-600 dark:text-orange-400 border-orange-200 dark:border-orange-800"
                : "bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800"
            )}>
              {app.stage === "alpha" ? "Alpha" : "Beta"}
            </div>
          )}
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
          {app.subtitle}
        </p>
      </div>

      {showActions && (
        <div className="flex items-center gap-2">
          {isEnabled ? (
            <Check className="w-4 h-4 text-green-500" />
          ) : (
            <Button
              onClick={handleEnable}
              loading={isLoading}
              variant="plain"
              size="plain"
              className="px-3 py-1 text-xs font-medium bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors"
            >
              Enable
            </Button>
          )}
        </div>
      )}
    </Link>
  );
}
