import * as React from "react"
import { useNavigate } from "@tanstack/react-router"
import { useVirtualizer } from "@tanstack/react-virtual"
import { ArrowsLeftRightIcon, CheckIcon, PlusIcon } from "@phosphor-icons/react"
import { useUser } from "@stackframe/tanstack-start"
import type { CurrentInternalUser } from "@stackframe/tanstack-start"

import { cn } from "@/lib/utils"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

type OwnedProject = ReturnType<CurrentInternalUser["useOwnedProjects"]>[number]
type Team = ReturnType<CurrentInternalUser["useTeams"]>[number]

type Row =
  | { kind: "header", key: string, label: string }
  | { kind: "project", key: string, project: OwnedProject, teamLabel: string }

const HEADER_HEIGHT = 28
const PROJECT_HEIGHT = 44

function buildRows(projects: ReadonlyArray<OwnedProject>, teams: ReadonlyArray<Team>): Array<Row> {
  const teamById = new Map(teams.map((t) => [t.id, t]))
  const grouped = new Map<string, Array<OwnedProject>>()
  const orphans: Array<OwnedProject> = []

  for (const p of projects) {
    if (p.ownerTeamId != null && teamById.has(p.ownerTeamId)) {
      const list = grouped.get(p.ownerTeamId) ?? []
      list.push(p)
      grouped.set(p.ownerTeamId, list)
    } else {
      orphans.push(p)
    }
  }

  const rows: Array<Row> = []
  for (const team of teams) {
    const teamProjects = grouped.get(team.id)
    if (!teamProjects || teamProjects.length === 0) continue
    rows.push({ kind: "header", key: `h:${team.id}`, label: team.displayName })
    for (const p of teamProjects) {
      rows.push({
        kind: "project",
        key: `p:${p.id}`,
        project: p,
        teamLabel: team.displayName,
      })
    }
  }
  if (orphans.length > 0) {
    rows.push({ kind: "header", key: "h:__personal", label: "Personal" })
    for (const p of orphans) {
      rows.push({ kind: "project", key: `p:${p.id}`, project: p, teamLabel: "Personal" })
    }
  }
  return rows
}

export function ProjectSwitcher({ currentProjectId }: { currentProjectId: string }) {
  const user = useUser({ or: "redirect", projectIdMustMatch: "internal" })
  const projects = user.useOwnedProjects()
  const teams = user.useTeams()
  const navigate = useNavigate()
  const [open, setOpen] = React.useState(false)

  // Callback ref so the virtualizer re-renders once the scroll element attaches.
  const [parentEl, setParentEl] = React.useState<HTMLDivElement | null>(null)

  const rows = React.useMemo(() => buildRows(projects, teams), [projects, teams])
  const estimateSize = React.useCallback((index: number) => {
    const row = rows[index]
    return row.kind === "header" ? HEADER_HEIGHT : PROJECT_HEIGHT
  }, [rows])

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentEl,
    estimateSize,
    overscan: 6,
  })

  const goTo = (id: string) => {
    setOpen(false)
    navigate({ to: "/projects/$projectId", params: { projectId: id } })
  }

  const goToAll = () => {
    setOpen(false)
    navigate({ to: "/projects" })
  }

  const totalSize = virtualizer.getTotalSize()
  const virtualItems = virtualizer.getVirtualItems()

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label="Switch project"
        title="Switch project"
        className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground hover:transition-none group-data-[collapsible=icon]:hidden"
      >
        <ArrowsLeftRightIcon />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={8}
        className="w-72 gap-0 p-1"
      >
        <div className="px-2 py-1.5 text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
          Switch project
        </div>
        <div
          ref={setParentEl}
          className="relative max-h-80 overflow-y-auto overflow-x-hidden"
        >
          {rows.length === 0 ? (
            <div className="flex h-12 items-center justify-center text-xs text-muted-foreground">
              No projects yet
            </div>
          ) : (
            <div className="relative w-full" style={{ height: `${totalSize}px` }}>
              {virtualItems.map((row) => {
                const item = rows[row.index]
                return (
                  <div
                    key={item.key}
                    data-index={row.index}
                    className="absolute left-0 top-0 w-full"
                    style={{
                      transform: `translateY(${row.start}px)`,
                      height: `${row.size}px`,
                    }}
                  >
                    {item.kind === "header" ? (
                      <div className="flex h-full items-end px-2 pb-1 text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
                        <span className="truncate">{item.label}</span>
                      </div>
                    ) : (
                      <ProjectRow
                        project={item.project}
                        active={item.project.id === currentProjectId}
                        onSelect={() => goTo(item.project.id)}
                      />
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
        <div className="mt-1 border-t pt-1">
          <button
            type="button"
            onClick={goToAll}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-accent"
          >
            <PlusIcon className="size-4 shrink-0" />
            <span className="truncate">All projects</span>
          </button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function ProjectRow({
  project,
  active,
  onSelect,
}: {
  project: OwnedProject,
  active: boolean,
  onSelect: () => void,
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex h-full w-full items-center gap-2 rounded-md px-2 text-left transition-colors",
        active ? "bg-accent" : "hover:bg-accent",
      )}
    >
      <div className="grid size-6 shrink-0 place-items-center rounded-sm bg-primary/10 font-heading text-[10px] font-semibold text-primary">
        {project.displayName.slice(0, 1).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-heading text-sm leading-tight">
          {project.displayName}
        </p>
        <p className="truncate font-mono text-[10px] text-muted-foreground">
          {project.id}
        </p>
      </div>
      {active ? (
        <CheckIcon className="size-4 shrink-0 text-muted-foreground" />
      ) : null}
    </button>
  )
}
