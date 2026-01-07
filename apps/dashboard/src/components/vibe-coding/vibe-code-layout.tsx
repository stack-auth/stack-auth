import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { ChatsCircle, Code, DeviceMobile, DeviceTablet, FloppyDisk, Laptop } from "@phosphor-icons/react";
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { useState } from "react";

type VibeCodeEditorLayoutProps = {
  previewComponent: React.ReactNode,
  editorComponent: React.ReactNode,
  chatComponent: React.ReactNode,
  onSave?: () => void | Promise<void>,
  isDirty?: boolean,
  viewport?: 'desktop' | 'tablet' | 'phone',
  onViewportChange?: (viewport: 'desktop' | 'tablet' | 'phone') => void,
  previewActions?: React.ReactNode,
  editorTitle?: string,
  headerAction?: React.ReactNode,
  defaultViewport?: 'desktop' | 'tablet' | 'phone',
}

export default function VibeCodeLayout({
  previewComponent,
  editorComponent,
  chatComponent,
  onSave,
  isDirty,
  viewport,
  onViewportChange,
  previewActions,
  editorTitle = "Code",
  headerAction,
  defaultViewport = 'desktop',
}: VibeCodeEditorLayoutProps) {
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [internalViewport, setInternalViewport] = useState<'desktop' | 'tablet' | 'phone'>(defaultViewport);
  const [isSaving, setIsSaving] = useState(false);

  const currentViewport = viewport ?? internalViewport;
  const handleViewportChange = (newViewport: 'desktop' | 'tablet' | 'phone') => {
    if (onViewportChange) {
      onViewportChange(newViewport);
    } else {
      setInternalViewport(newViewport);
    }
  };

  const handleSave = () => {
    if (!onSave) return;
    setIsSaving(true);
    runAsynchronouslyWithAlert(async () => {
      await onSave();
      setIsSaving(false);
    }, {
      onError: () => {
        setIsSaving(false);
      },
    });
  };

  return (
    <TooltipProvider delayDuration={300}>
      {/* Mobile Layout - visible on small screens, hidden on md+ */}
      <div className="flex flex-col h-full w-full overflow-hidden md:hidden">
        {/* Mobile Header - Compact */}
        <div className="px-3 pt-3 pb-2 shrink-0">
          <div className="flex flex-col gap-2">
            {/* Primary Actions Row */}
            <div className="flex items-center gap-2 px-2 py-2 rounded-lg bg-background/60 dark:bg-background/40 backdrop-blur-xl shadow-sm ring-1 ring-foreground/[0.06]">
              {/* Viewport Switcher - Compact */}
              <div className="flex items-center gap-0.5 rounded-md bg-foreground/[0.04] p-0.5">
                <button
                  onClick={() => handleViewportChange('desktop')}
                  className={cn(
                    "p-1 rounded transition-all duration-150 hover:transition-none",
                    currentViewport === 'desktop'
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground"
                  )}
                  aria-label="Desktop view"
                >
                  <Laptop size={14} weight={currentViewport === 'desktop' ? 'fill' : 'regular'} />
                </button>
                <button
                  onClick={() => handleViewportChange('tablet')}
                  className={cn(
                    "p-1 rounded transition-all duration-150 hover:transition-none",
                    currentViewport === 'tablet'
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground"
                  )}
                  aria-label="Tablet view"
                >
                  <DeviceTablet size={14} weight={currentViewport === 'tablet' ? 'fill' : 'regular'} />
                </button>
                <button
                  onClick={() => handleViewportChange('phone')}
                  className={cn(
                    "p-1 rounded transition-all duration-150 hover:transition-none",
                    currentViewport === 'phone'
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground"
                  )}
                  aria-label="Phone view"
                >
                  <DeviceMobile size={14} weight={currentViewport === 'phone' ? 'fill' : 'regular'} />
                </button>
              </div>

              {/* Spacer */}
              <div className="flex-1" />

              {/* Right Actions - Compact */}
              <div className="flex items-center gap-1.5">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setIsEditorOpen(!isEditorOpen);
                    if (!isEditorOpen) setIsChatOpen(false);
                  }}
                  className={cn(
                    "h-7 gap-1 px-2 rounded-md transition-all duration-150 hover:transition-none",
                    isEditorOpen
                      ? "bg-foreground/[0.06] text-foreground"
                      : "text-muted-foreground"
                  )}
                >
                  <Code size={14} weight={isEditorOpen ? 'fill' : 'regular'} />
                  <span className="text-[10px] font-medium">Code</span>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setIsChatOpen(!isChatOpen);
                    if (!isChatOpen) setIsEditorOpen(false);
                  }}
                  className={cn(
                    "h-7 gap-1 px-2 rounded-md transition-all duration-150 hover:transition-none",
                    isChatOpen
                      ? "bg-foreground/[0.06] text-foreground"
                      : "text-muted-foreground"
                  )}
                >
                  <ChatsCircle size={14} weight={isChatOpen ? 'fill' : 'regular'} />
                  <span className="text-[10px] font-medium">Chat</span>
                </Button>
                {onSave && (
                  <Button
                    size="sm"
                    onClick={handleSave}
                    disabled={!isDirty || isSaving}
                    className="h-7 gap-1 px-2 rounded-md"
                  >
                    {isSaving ? (
                      <>
                        <Spinner size={14} />
                        <span className="text-[10px] font-medium">Saving...</span>
                      </>
                    ) : (
                      <>
                        <FloppyDisk size={14} />
                        <span className="text-[10px] font-medium">Save</span>
                      </>
                    )}
                  </Button>
                )}
              </div>
            </div>

            {/* Header Action Row (Theme selector, etc) */}
            {headerAction && (
              <div className="px-2 py-1.5 rounded-lg bg-background/60 dark:bg-background/40 backdrop-blur-xl shadow-sm ring-1 ring-foreground/[0.06]">
                <div className="scale-90 origin-left">
                  {headerAction}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Mobile Content Area - Stacked */}
        <div className="flex-1 overflow-hidden flex flex-col px-3 pb-3 gap-2">
          {/* Preview Panel - Always visible when neither editor nor chat is open */}
          {!isEditorOpen && !isChatOpen && (
            <div className="flex-1 overflow-hidden rounded-xl shadow-lg ring-1 ring-foreground/[0.06] bg-background/60 dark:bg-background/40 backdrop-blur-xl">
              <div className="h-full bg-gradient-to-br from-muted/30 via-muted/20 to-muted/30 dark:from-foreground/[0.02] dark:via-foreground/[0.01] dark:to-foreground/[0.02]">
                <div className="h-full overflow-auto flex justify-center items-start p-2">
                  <div className="w-full h-full">
                    {previewComponent}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Code Editor - Shown when toggled */}
          {isEditorOpen && (
            <div className="flex-1 overflow-hidden rounded-xl shadow-lg ring-1 ring-foreground/[0.06] bg-background/60 dark:bg-background/40 backdrop-blur-xl">
              <div className="h-full overflow-hidden">
                {editorComponent}
              </div>
            </div>
          )}

          {/* Chat Panel - Shown when toggled */}
          {isChatOpen && (
            <div className="flex-1 overflow-hidden rounded-xl shadow-lg ring-1 ring-foreground/[0.06] bg-background/60 dark:bg-background/40 backdrop-blur-xl">
              {chatComponent}
            </div>
          )}
        </div>
      </div>

      {/* Desktop/Tablet Layout - hidden on small screens, visible on md+ */}
      <div className="hidden md:flex flex-col h-full w-full overflow-hidden">
        <div className="flex-1 overflow-hidden flex flex-col">
          {/* Top Header / Toolbar - with consistent inset spacing */}
          <div className="px-6 pt-4 pb-3">
            <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-background/60 dark:bg-background/40 backdrop-blur-xl shadow-sm ring-1 ring-foreground/[0.06]">
              {/* Viewport Switcher */}
              <div className="flex items-center gap-1 rounded-lg bg-foreground/[0.04] p-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => handleViewportChange('desktop')}
                      className={cn(
                        "p-1.5 rounded-md transition-all duration-150 hover:transition-none",
                        currentViewport === 'desktop'
                          ? "bg-background text-foreground shadow-sm ring-1 ring-foreground/[0.06]"
                          : "text-muted-foreground hover:text-foreground hover:bg-background/50"
                      )}
                    >
                      <Laptop size={16} weight={currentViewport === 'desktop' ? 'fill' : 'regular'} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">Desktop</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => handleViewportChange('tablet')}
                      className={cn(
                        "p-1.5 rounded-md transition-all duration-150 hover:transition-none",
                        currentViewport === 'tablet'
                          ? "bg-background text-foreground shadow-sm ring-1 ring-foreground/[0.06]"
                          : "text-muted-foreground hover:text-foreground hover:bg-background/50"
                      )}
                    >
                      <DeviceTablet size={16} weight={currentViewport === 'tablet' ? 'fill' : 'regular'} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">Tablet</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => handleViewportChange('phone')}
                      className={cn(
                        "p-1.5 rounded-md transition-all duration-150 hover:transition-none",
                        currentViewport === 'phone'
                          ? "bg-background text-foreground shadow-sm ring-1 ring-foreground/[0.06]"
                          : "text-muted-foreground hover:text-foreground hover:bg-background/50"
                      )}
                    >
                      <DeviceMobile size={16} weight={currentViewport === 'phone' ? 'fill' : 'regular'} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">Mobile</TooltipContent>
                </Tooltip>
              </div>

              {/* Theme Selector / Header Action */}
              {headerAction}

              {/* Spacer */}
              <div className="flex-1" />

              {/* Right Actions */}
              <div className="flex items-center gap-2">
                {previewActions}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setIsEditorOpen(!isEditorOpen)}
                      className={cn(
                        "h-8 gap-1.5 px-3 rounded-lg transition-all duration-150 hover:transition-none",
                        isEditorOpen
                          ? "bg-foreground/[0.06] text-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <Code size={16} weight={isEditorOpen ? 'fill' : 'regular'} />
                      <span className="text-xs font-medium">{isEditorOpen ? 'Hide Code' : 'View Code'}</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">
                    {isEditorOpen ? 'Hide source code' : 'View and edit source code'}
                  </TooltipContent>
                </Tooltip>
                {onSave && (
                  <Button
                    size="sm"
                    onClick={handleSave}
                    disabled={!isDirty || isSaving}
                    className="h-8 gap-1.5 px-3 rounded-lg"
                  >
                    {isSaving ? (
                      <>
                        <Spinner size={16} />
                        <span className="text-xs font-medium">Saving...</span>
                      </>
                    ) : (
                      <>
                        <FloppyDisk size={16} />
                        <span className="text-xs font-medium">Save</span>
                      </>
                    )}
                  </Button>
                )}
              </div>
            </div>
          </div>

          {/* Main Content Area */}
          <ResizablePanelGroup direction="horizontal" className="flex-1 overflow-hidden">
            {/* Left Panel - Preview & Code */}
            <ResizablePanel defaultSize={67} minSize={33} className="relative">
              <div className="absolute inset-0 pl-6 pr-2 pb-6 flex flex-col gap-4">
                <ResizablePanelGroup direction="vertical" className="flex-1 rounded-2xl overflow-hidden shadow-xl ring-1 ring-foreground/[0.06] bg-background/60 dark:bg-background/40 backdrop-blur-xl">
                  {/* Preview Panel */}
                  <ResizablePanel defaultSize={isEditorOpen ? 50 : 100} minSize={30} className="relative">
                    <div className="absolute inset-0 bg-gradient-to-br from-muted/30 via-muted/20 to-muted/30 dark:from-foreground/[0.02] dark:via-foreground/[0.01] dark:to-foreground/[0.02]">
                      <div className="absolute inset-0 overflow-auto flex justify-center items-start p-2.5">
                        <div className={cn(
                          "w-full h-full transition-all duration-200 ease-out flex items-start justify-center",
                          currentViewport === 'phone' && "max-w-[420px]",
                          currentViewport === 'tablet' && "max-w-[860px]",
                          currentViewport === 'desktop' && "max-w-full"
                        )}>
                          {previewComponent}
                        </div>
                      </div>
                    </div>
                  </ResizablePanel>

                  {/* Code Editor Panel */}
                  {isEditorOpen && (
                    <>
                      <ResizableHandle className="h-px bg-border/10 dark:bg-foreground/[0.06] hover:bg-blue-500/30 hover:h-1 transition-all duration-150 hover:transition-none" />
                      <ResizablePanel defaultSize={50} minSize={30} className="relative">
                        <div className="absolute inset-0 flex flex-col">
                          {/* Editor Content with integrated background */}
                          <div className="flex-1 overflow-hidden min-h-0 relative">
                            {/* Subtle top gradient for integration */}
                            <div className="absolute top-0 left-0 right-0 h-8 bg-gradient-to-b from-background/40 to-transparent pointer-events-none z-10" />
                            {editorComponent}
                          </div>
                        </div>
                      </ResizablePanel>
                    </>
                  )}
                </ResizablePanelGroup>
              </div>
            </ResizablePanel>

            {/* Resize Handle */}
            <ResizableHandle
              className="w-px bg-border/10 dark:bg-foreground/[0.06] hover:bg-blue-500/30 hover:w-1 transition-all duration-150 hover:transition-none mb-6"
            />

            {/* Chat Panel */}
            <ResizablePanel
              defaultSize={35}
              minSize={20}
              maxSize={50}
              className="relative"
            >
              <div className="absolute inset-0 pl-2 pr-6 pb-6 flex flex-col">
                <div className="flex-1 overflow-hidden rounded-2xl shadow-xl ring-1 ring-foreground/[0.06] bg-background/60 dark:bg-background/40 backdrop-blur-xl">
                  {chatComponent}
                </div>
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
      </div>
    </TooltipProvider>
  );
}
