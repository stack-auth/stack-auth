"use client";

import { DASHBOARD_APPS, type AppId } from "@/lib/apps";
import { ActionDialog, Button } from "@stackframe/stack-ui";
import { Check, X, ZoomIn } from "lucide-react";
import { useState } from "react";

interface AppDetailDialogProps {
  appId: AppId;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onEnable: (appId: AppId) => void;
  isEnabled: boolean;
}

export function AppDetailDialog({
  appId,
  isOpen,
  onOpenChange,
  onEnable,
  isEnabled,
}: AppDetailDialogProps) {
  const app = DASHBOARD_APPS[appId];
  const [selectedScreenshot, setSelectedScreenshot] = useState<number>(0);
  const [isZoomed, setIsZoomed] = useState(false);
  
  if (!app) return null;

  const IconComponent = app.icon;
  const ScreenshotComponent = app.screenshots[selectedScreenshot] || app.screenshots[0];
  const DescriptionComponent = app.description;

  const handleScreenshotClick = () => {
    setIsZoomed(true);
  };

  const handleZoomClose = () => {
    setIsZoomed(false);
  };

  return (
    <>
      <ActionDialog
        open={isOpen}
        onOpenChange={onOpenChange}
        title={app.displayName}
        description={app.subtitle}
        okButton={
          isEnabled
            ? {
                children: "Close",
                variant: "outline",
              }
            : {
                children: "Enable App",
                onClick: () => onEnable(appId),
              }
        }
        cancelButton={false}
        className="max-w-4xl"
      >
        <div className="space-y-6">
          {/* App Header */}
          <div className="flex items-start gap-4">
            <div className="flex-shrink-0">
              <div className="w-20 h-20 bg-muted rounded-lg flex items-center justify-center">
                <IconComponent size={40} className="text-muted-foreground" />
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-2">
                <h2 className="text-2xl font-bold">{app.displayName}</h2>
                {isEnabled && (
                  <div className="flex items-center gap-1 bg-green-100 text-green-700 px-2 py-1 rounded-full text-sm font-medium">
                    <Check size={14} />
                    Enabled
                  </div>
                )}
              </div>
              <p className="text-muted-foreground mb-3">{app.subtitle}</p>
              
              {/* Tags */}
              <div className="flex flex-wrap gap-2">
                {app.tags.map((tag) => (
                  <span
                    key={tag}
                    className="px-3 py-1 bg-muted text-sm rounded-full"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Screenshots */}
          {app.screenshots.length > 0 && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold">Screenshots</h3>
              
              {/* Screenshot Navigation */}
              {app.screenshots.length > 1 && (
                <div className="flex gap-2">
                  {app.screenshots.map((_, index) => (
                    <button
                      key={index}
                      onClick={() => setSelectedScreenshot(index)}
                      className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                        selectedScreenshot === index
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground hover:bg-muted/80"
                      }`}
                    >
                      {index + 1}
                    </button>
                  ))}
                </div>
              )}

              {/* Main Screenshot */}
              <div className="relative group">
                <div
                  className="bg-muted rounded-lg p-6 cursor-pointer hover:bg-muted/80 transition-colors"
                  onClick={handleScreenshotClick}
                >
                  <ScreenshotComponent />
                </div>
                
                {/* Zoom Button */}
                <Button
                  variant="outline"
                  size="sm"
                  className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={handleScreenshotClick}
                >
                  <ZoomIn size={16} />
                </Button>
              </div>
            </div>
          )}

          {/* Description */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Description</h3>
            <div className="prose prose-sm max-w-none">
              <DescriptionComponent />
            </div>
          </div>
        </div>
      </ActionDialog>

      {/* Zoom Modal */}
      {isZoomed && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
          <div className="relative max-w-4xl max-h-[90vh] bg-background rounded-lg overflow-hidden">
            <Button
              variant="outline"
              size="sm"
              className="absolute top-4 right-4 z-10"
              onClick={handleZoomClose}
            >
              <X size={16} />
            </Button>
            <div className="p-6 max-h-[90vh] overflow-auto">
              <ScreenshotComponent />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
