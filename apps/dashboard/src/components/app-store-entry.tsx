'use client';

import { AppIcon } from "@/components/app-square";
import { ALL_APPS_FRONTEND } from "@/lib/apps-frontend";
import { ALL_APPS, ALL_APP_TAGS, AppId } from "@stackframe/stack-shared/dist/apps/apps-config";
import { Badge, Button, Dialog, DialogContent, DialogTitle, ScrollArea } from "@stackframe/stack-ui";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import Image from "next/image";
import { FunctionComponent, useCallback, useEffect, useRef, useState } from "react";

export function AppStoreEntry({
  appId,
  onEnable,
  titleComponent: TitleComponent = "h1",
}: {
  appId: AppId,
  onEnable: () => Promise<void>,
  titleComponent?: FunctionComponent<any> | string,
}) {
  const app = ALL_APPS[appId];
  const appFrontend = ALL_APPS_FRONTEND[appId];
  const screenshotContainerRef = useRef<HTMLDivElement>(null);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  const scrollScreenshots = (direction: 'left' | 'right') => {
    if (screenshotContainerRef.current) {
      const scrollAmount = 300; // scroll by ~1 screenshot width
      const currentScroll = screenshotContainerRef.current.scrollLeft;
      screenshotContainerRef.current.scrollTo({
        left: direction === 'left' ? currentScroll - scrollAmount : currentScroll + scrollAmount,
        behavior: 'smooth'
      });
    }
  };

  const navigatePreview = useCallback((direction: 'prev' | 'next') => {
    if (previewIndex === null) return;
    const newIndex = direction === 'prev'
      ? Math.max(0, previewIndex - 1)
      : Math.min(appFrontend.screenshots.length - 1, previewIndex + 1);
    setPreviewIndex(newIndex);
  }, [previewIndex, appFrontend.screenshots.length]);

  // Keyboard navigation for preview
  useEffect(() => {
    if (previewIndex === null) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        navigatePreview('prev');
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        navigatePreview('next');
      } else if (e.key === 'Escape') {
        setPreviewIndex(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [previewIndex, navigatePreview]);

  return (
    <div className="flex flex-col h-full">
      {/* Header with app icon and basic info */}
      <div className="p-6 border-b">
        <div className="flex gap-4">
          <AppIcon appId={appId} className="w-24 h-24 shadow-md" />
          <div className="flex-1">
            <TitleComponent className="text-2xl font-bold mb-1">{app.displayName}</TitleComponent>
            <p className="text-gray-600 dark:text-gray-400 mb-2">{app.subtitle}</p>
            <div className="flex items-center gap-2 text-sm text-gray-500">
              {app.tags.map((tag) => (
                <Badge key={tag} variant={tag === "expert" ? "destructive" : "outline"} >{ALL_APP_TAGS[tag].displayName}</Badge>
              ))}
            </div>
          </div>
          <div className="text-right">
            <Button
              onClick={onEnable}
              size="lg"
              className="px-8"
            >
              Enable
            </Button>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
              No additional cost
            </p>
          </div>
        </div>
      </div>

      {/* Screenshots */}
      {appFrontend.screenshots.length > 0 && (
        <div className="border-b relative group">
          <div
            ref={screenshotContainerRef}
            className="overflow-x-auto overflow-y-hidden"
            style={{
              scrollbarWidth: 'thin',
              scrollbarColor: 'rgb(156 163 175) transparent'
            }}
          >
            <div className="flex gap-4 p-6 pb-8">
              {appFrontend.screenshots.map((screenshot, index) => (
                <button
                  key={index}
                  onClick={() => setPreviewIndex(index)}
                  className="relative h-48 w-72 rounded-lg shadow-md flex-shrink-0 overflow-hidden cursor-pointer hover:shadow-xl hover:scale-105 transition-all"
                >
                  <Image
                    src={screenshot}
                    alt={`${app.displayName} screenshot ${index + 1}`}
                    fill
                    className="object-cover select-none"
                    draggable={false}
                  />
                </button>
              ))}
            </div>
          </div>
          {appFrontend.screenshots.length > 1 && (
            <>
              <button
                onClick={() => scrollScreenshots('left')}
                className="absolute left-2 top-1/2 -translate-y-1/2 bg-white/90 dark:bg-black/90 hover:bg-white dark:hover:bg-black p-2 rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition-opacity"
                aria-label="Previous screenshot"
              >
                <ChevronLeft className="w-6 h-6" />
              </button>
              <button
                onClick={() => scrollScreenshots('right')}
                className="absolute right-2 top-1/2 -translate-y-1/2 bg-white/90 dark:bg-black/90 hover:bg-white dark:hover:bg-black p-2 rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition-opacity"
                aria-label="Next screenshot"
              >
                <ChevronRight className="w-6 h-6" />
              </button>
            </>
          )}
        </div>
      )}

      {/* Long description */}
      <ScrollArea className="flex-1 p-6">
        <div className="prose dark:prose-invert max-w-none">
          {app.stage === "alpha" && (
            <p className="text-red-500 dark:text-red-400 bg-red-500/10 p-2 rounded-md text-sm text-center">
              IMPORTANT: This app is in alpha. It is still under development, and may break in unexpected ways.
            </p>
          )}
          {app.stage === "beta" && (
            <p className="text-yellow-700 dark:text-yellow-400 bg-yellow-500/10 p-2 rounded-md text-sm text-center">
              IMPORTANT: This app is in beta. You may still experience some bugs and issues.
            </p>
          )}
          {appFrontend.storeDescription}
        </div>
      </ScrollArea>

      {/* Screenshot Preview Modal */}
      <Dialog open={previewIndex !== null} onOpenChange={(open) => !open && setPreviewIndex(null)}>
        <DialogContent className="max-w-7xl max-h-[95vh] p-0 bg-black/95 border-0" noCloseButton>
          <DialogTitle className="sr-only">
            {previewIndex !== null
              ? `${app.displayName} screenshot ${previewIndex + 1} of ${appFrontend.screenshots.length}`
              : 'Screenshot preview'}
          </DialogTitle>
          <div className="relative w-full h-full flex items-center justify-center p-4">
            {previewIndex !== null && (
              <>
                {/* Close button */}
                <button
                  onClick={() => setPreviewIndex(null)}
                  className="absolute top-4 right-4 z-50 bg-white/10 hover:bg-white/20 p-2 rounded-full transition-colors"
                  aria-label="Close preview"
                >
                  <X className="w-6 h-6 text-white" />
                </button>

                {/* Image counter */}
                <div className="absolute top-4 left-4 z-50 bg-white/10 px-3 py-1 rounded-full text-white text-sm">
                  {previewIndex + 1} / {appFrontend.screenshots.length}
                </div>

                {/* Previous button */}
                {previewIndex > 0 && (
                  <button
                    onClick={() => navigatePreview('prev')}
                    className="absolute left-4 top-1/2 -translate-y-1/2 z-50 bg-white/10 hover:bg-white/20 p-3 rounded-full transition-colors"
                    aria-label="Previous screenshot"
                  >
                    <ChevronLeft className="w-8 h-8 text-white" />
                  </button>
                )}

                {/* Next button */}
                {previewIndex < appFrontend.screenshots.length - 1 && (
                  <button
                    onClick={() => navigatePreview('next')}
                    className="absolute right-4 top-1/2 -translate-y-1/2 z-50 bg-white/10 hover:bg-white/20 p-3 rounded-full transition-colors"
                    aria-label="Next screenshot"
                  >
                    <ChevronRight className="w-8 h-8 text-white" />
                  </button>
                )}

                {/* Image */}
                <div className="relative w-full h-[85vh] flex items-center justify-center">
                  <Image
                    src={appFrontend.screenshots[previewIndex]}
                    alt={`${app.displayName} screenshot ${previewIndex + 1}`}
                    fill
                    className="object-contain"
                    sizes="100vw"
                  />
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
