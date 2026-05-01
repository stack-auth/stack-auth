import { useNavigate } from "@tanstack/react-router"
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises"
import type { ReactNode } from "react"

import { cn } from "@/lib/utils"
import { getProjectEntityDrawerHref } from "@/lib/console/project-entity-drawer-url"

type ProjectEntityDrawerLinkProps = {
  children: ReactNode
  className?: string
}

export function ProjectUserDrawerLink({
  userId,
  children,
  className,
}: ProjectEntityDrawerLinkProps & {
  userId: string
}) {
  const navigate = useNavigate()
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        runAsynchronouslyWithAlert(
          navigate({
            href: getProjectEntityDrawerHref(window.location.href, { userId }),
            resetScroll: false,
          })
        )
      }}
      className={cn(
        "cursor-pointer text-primary underline-offset-4 transition-colors hover:underline hover:transition-none",
        className
      )}
    >
      {children}
    </button>
  )
}

export function ProjectTeamDrawerLink({
  teamId,
  children,
  className,
}: ProjectEntityDrawerLinkProps & {
  teamId: string
}) {
  const navigate = useNavigate()
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        runAsynchronouslyWithAlert(
          navigate({
            href: getProjectEntityDrawerHref(window.location.href, { teamId }),
            resetScroll: false,
          })
        )
      }}
      className={cn(
        "cursor-pointer text-primary underline-offset-4 transition-colors hover:underline hover:transition-none",
        className
      )}
    >
      {children}
    </button>
  )
}
