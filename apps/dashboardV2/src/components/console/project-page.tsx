import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

export const PROJECT_PAGE_HEADER_HEIGHT = 52
export const PROJECT_PAGE_HEADER_WITH_NAV_HEIGHT = 88
export const PROJECT_PAGE_HEADER_STICKY_TOP_CLASS = "top-[52px]"
export const PROJECT_PAGE_HEADER_WITH_NAV_STICKY_TOP_CLASS = "top-[88px]"
export const PROJECT_PAGE_MAX_WIDTH_CLASS = "max-w-6xl"

type ProjectPageProps = {
  children: ReactNode,
  className?: string,
}

export function ProjectPage({ children, className }: ProjectPageProps) {
  return (
    <div className={cn("flex min-h-svh min-w-0 flex-1 flex-col", className)}>
      {children}
    </div>
  )
}

type ProjectPageHeaderProps = {
  title: ReactNode,
  badge?: ReactNode,
  actions?: ReactNode,
  nav?: ReactNode,
  maxWidthClassName?: string,
  className?: string,
}

export function ProjectPageHeader({
  title,
  badge,
  actions,
  nav,
  maxWidthClassName = PROJECT_PAGE_MAX_WIDTH_CLASS,
  className,
}: ProjectPageHeaderProps) {
  const titleContent = typeof title === "string"
    ? (
      <h1 className="truncate font-heading text-base font-semibold tracking-tight">
        {title}
      </h1>
    )
    : <div className="min-w-0">{title}</div>

  return (
    <header className={cn("sticky top-0 z-30 border-b bg-background", className)}>
      <div className={cn("mx-auto w-full px-6", maxWidthClassName)}>
        <div className="flex h-[52px] min-w-0 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            {titleContent}
            {badge}
          </div>
          {actions == null ? null : (
            <div className="flex shrink-0 items-center gap-2">{actions}</div>
          )}
        </div>
        {nav == null ? null : (
          <div className="flex h-9 items-end overflow-x-auto overflow-y-hidden">
            {nav}
          </div>
        )}
      </div>
    </header>
  )
}

type ProjectPageMainProps = {
  children: ReactNode,
  maxWidthClassName?: string,
  className?: string,
}

export function ProjectPageMain({
  children,
  maxWidthClassName = PROJECT_PAGE_MAX_WIDTH_CLASS,
  className,
}: ProjectPageMainProps) {
  return (
    <main className={cn("mx-auto flex w-full min-w-0 flex-1 flex-col px-6 py-8", maxWidthClassName, className)}>
      {children}
    </main>
  )
}
