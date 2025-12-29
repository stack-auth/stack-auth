import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui";
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Code, Eye, Laptop, DeviceTablet, DeviceMobile, FloppyDisk } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

type VibeCodeEditorLayoutProps = {
  previewComponent: React.ReactNode,
  editorComponent: React.ReactNode,
  chatComponent: React.ReactNode,
  onSave?: () => void,
  isDirty?: boolean,
  viewport?: 'desktop' | 'tablet' | 'phone',
  onViewportChange?: (viewport: 'desktop' | 'tablet' | 'phone') => void,
}

export default function VibeCodeLayout({
  previewComponent,
  editorComponent,
  chatComponent,
  onSave,
  isDirty,
  viewport = 'desktop',
  onViewportChange,
}: VibeCodeEditorLayoutProps) {
  const [isEditorOpen, setIsEditorOpen] = useState(false);

  return (
    <div className="flex flex-col h-full w-full overflow-hidden bg-background">
      {/* Top Header / Toolbar */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-border/10 dark:border-foreground/5 bg-background/60 backdrop-blur-xl z-20">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 px-1.5 py-1 rounded-xl bg-foreground/[0.04] p-1 backdrop-blur-sm">
            <button
              onClick={() => onViewportChange?.('desktop')}
              className={cn(
                "p-2 rounded-lg transition-all duration-150 hover:transition-none",
                viewport === 'desktop' ? "bg-background text-foreground shadow-sm ring-1 ring-foreground/[0.06]" : "text-muted-foreground hover:text-foreground"
              )}
              title="Desktop View"
            >
              <Laptop size={18} />
            </button>
            <button
              onClick={() => onViewportChange?.('tablet')}
              className={cn(
                "p-2 rounded-lg transition-all duration-150 hover:transition-none",
                viewport === 'tablet' ? "bg-background text-foreground shadow-sm ring-1 ring-foreground/[0.06]" : "text-muted-foreground hover:text-foreground"
              )}
              title="Tablet View"
            >
              <DeviceTablet size={18} />
            </button>
            <button
              onClick={() => onViewportChange?.('phone')}
              className={cn(
                "p-2 rounded-lg transition-all duration-150 hover:transition-none",
                viewport === 'phone' ? "bg-background text-foreground shadow-sm ring-1 ring-foreground/[0.06]" : "text-muted-foreground hover:text-foreground"
              )}
              title="Mobile View"
            >
              <DeviceMobile size={18} />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsEditorOpen(true)}
            className="gap-2 text-muted-foreground hover:text-foreground"
          >
            <Code size={18} />
            View Code
          </Button>
          {onSave && (
            <Button
              size="sm"
              onClick={onSave}
              disabled={!isDirty}
              className="gap-2"
            >
              <FloppyDisk size={18} />
              Save Changes
            </Button>
          )}
        </div>
      </div>

      <ResizablePanelGroup direction="horizontal" className="flex-1 overflow-hidden">
        <ResizablePanel defaultSize={70} minSize={30} className="relative bg-muted/20">
          <div className="absolute inset-0 overflow-auto p-8 flex justify-center items-start">
            <div className={cn(
              "w-full h-full transition-all duration-300 ease-in-out flex items-start justify-center",
              viewport === 'phone' && "max-w-[390px]",
              viewport === 'tablet' && "max-w-[820px]",
              viewport === 'desktop' && "max-w-full"
            )}>
              <div className="w-full h-full bg-background rounded-2xl shadow-2xl border border-border/10 dark:border-foreground/5 overflow-hidden">
                {previewComponent}
              </div>
            </div>
          </div>
        </ResizablePanel>
        
        <ResizableHandle className="w-1 bg-border/5 hover:bg-primary/20 transition-colors" />
        
        <ResizablePanel defaultSize={30} minSize={20} className="bg-background border-l border-border/10 dark:border-foreground/5 flex flex-col h-full">
          {chatComponent}
        </ResizablePanel>
      </ResizablePanelGroup>

      {/* Code Editor Modal */}
      <Dialog open={isEditorOpen} onOpenChange={setIsEditorOpen}>
        <DialogContent className="max-w-[90vw] w-[1200px] h-[80vh] p-0 overflow-hidden flex flex-col gap-0 border-border/10 dark:border-foreground/5">
          <DialogHeader className="px-6 py-4 border-b border-border/10 dark:border-foreground/5 flex flex-row items-center justify-between space-y-0">
            <DialogTitle className="text-sm font-semibold uppercase tracking-wider flex items-center gap-2">
              <Code size={18} className="text-blue-500" />
              Template Source Code
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-hidden min-h-0">
            {editorComponent}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
