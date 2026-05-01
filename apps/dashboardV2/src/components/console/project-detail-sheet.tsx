import { CaretLeftIcon, CaretRightIcon, XIcon } from "@phosphor-icons/react"
import type { ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { Sheet, SheetContent } from "@/components/ui/sheet"
import { cn } from "@/lib/utils"

type ProjectDetailSheetProps = {
  open: boolean
  onOpenChange: (nextOpen: boolean) => void
  children: ReactNode
  className?: string
}

export function ProjectDetailSheet({
  open,
  onOpenChange,
  children,
  className,
}: ProjectDetailSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <SheetContent
        showOverlay={false}
        showCloseButton={false}
        className={cn(
          "w-[min(56rem,calc(100vw-1rem))] !max-w-[56rem]",
          className
        )}
      >
        {children}
        <div className="absolute end-4 top-4 z-10 flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Go back"
            onClick={() => window.history.back()}
          >
            <CaretLeftIcon />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Go forward"
            onClick={() => window.history.forward()}
          >
            <CaretRightIcon />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Close"
            onClick={() => onOpenChange(false)}
          >
            <XIcon />
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
