import { Link, createFileRoute } from "@tanstack/react-router"
import { MagnifyingGlassIcon, PlusIcon, UsersThreeIcon } from "@phosphor-icons/react"
import type { Team } from "@stackframe/tanstack-start"

import type {DauPoint} from "@/hooks/use-projects-dau";
import type {OwnedProject} from "@/hooks/projects/use-projects-page";
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { CreateTeamDialog } from "@/components/console/create-team-dialog"
import {  useProjectsPage } from "@/hooks/projects/use-projects-page"

export const Route = createFileRoute("/_app/projects/")({
  component: ProjectsPage,
})

function ProjectsPage() {
  const {
    teams,
    query,
    setQuery,
    createTeamOpen,
    setCreateTeamOpen,
    visibleTeamSections,
    orphanProjects,
    orphanTotalCount,
    dauByProject,
    goToNew,
  } = useProjectsPage()

  return (
    <div className="flex min-h-svh flex-col">
      <header className="border-b">
        <div className="mx-auto flex h-[52px] w-full max-w-6xl items-center justify-between gap-3 px-6">
          <h1 className="font-heading text-base font-semibold tracking-tight">
            Projects
          </h1>
          <div className="flex items-center gap-2">
            <div className="relative w-56">
              <MagnifyingGlassIcon className="absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search projects"
                className="h-8 ps-8 text-xs"
              />
            </div>
            <Button variant="outline" size="lg" onClick={() => setCreateTeamOpen(true)}>
              <UsersThreeIcon />
              New team
            </Button>
            <Button size="lg" onClick={goToNew}>
              <PlusIcon />
              New project
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-6">
        {teams.length === 0 ? (
          <NoTeamsEmpty onCreateTeam={() => setCreateTeamOpen(true)} />
        ) : (
          <div className="space-y-8">
            {visibleTeamSections.map(({ team, projects, totalCount }) => (
              <TeamSection
                key={team.id}
                team={team}
                projects={projects}
                totalCount={totalCount}
                onCreateProject={goToNew}
                dauByProject={dauByProject}
              />
            ))}

            {orphanTotalCount > 0 ? (
              <OrphanSection
                projects={orphanProjects}
                totalCount={orphanTotalCount}
                dauByProject={dauByProject}
              />
            ) : null}
          </div>
        )}
      </main>

      <CreateTeamDialog open={createTeamOpen} onOpenChange={setCreateTeamOpen} />
    </div>
  )
}

function TeamSection({
  team,
  projects,
  totalCount,
  onCreateProject,
  dauByProject,
}: {
  team: Team,
  projects: Array<OwnedProject>,
  totalCount: number,
  onCreateProject: () => void,
  dauByProject: Record<string, Array<DauPoint>> | undefined,
}) {
  return (
    <section>
      <header className="mb-2 flex items-baseline gap-2">
        <h2 className="font-heading text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {team.displayName}
        </h2>
        <span className="font-mono text-[10px] tracking-wider text-muted-foreground/70">
          · {totalCount}
        </span>
      </header>

      {projects.length === 0 ? (
        <div className="flex items-center justify-between rounded-lg border border-dashed px-4 py-6 text-xs text-muted-foreground">
          <span>No projects in this team yet.</span>
          <Button variant="ghost" size="sm" onClick={onCreateProject}>
            <PlusIcon />
            New project
          </Button>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <li key={project.id}>
              <ProjectCard project={project} dau={dauByProject?.[project.id]} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function OrphanSection({
  projects,
  totalCount,
  dauByProject,
}: {
  projects: Array<OwnedProject>,
  totalCount: number,
  dauByProject: Record<string, Array<DauPoint>> | undefined,
}) {
  if (projects.length === 0) return null
  return (
    <section>
      <header className="mb-2 flex items-baseline gap-2">
        <h2 className="font-heading text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Other projects
        </h2>
        <span className="font-mono text-[10px] tracking-wider text-muted-foreground/70">
          · {totalCount}
        </span>
      </header>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {projects.map((project) => (
          <li key={project.id}>
            <ProjectCard project={project} dau={dauByProject?.[project.id]} />
          </li>
        ))}
      </ul>
    </section>
  )
}

const RELATIVE_TIME_FORMAT = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" })
const RELATIVE_TIME_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 60 * 60 * 24 * 365],
  ["month", 60 * 60 * 24 * 30],
  ["week", 60 * 60 * 24 * 7],
  ["day", 60 * 60 * 24],
  ["hour", 60 * 60],
  ["minute", 60],
  ["second", 1],
]

function formatRelativeTime(date: Date | string | number) {
  const then = new Date(date).getTime()
  const diffSec = Math.round((then - Date.now()) / 1000)
  const abs = Math.abs(diffSec)
  for (const [unit, seconds] of RELATIVE_TIME_UNITS) {
    if (abs >= seconds || unit === "second") {
      return RELATIVE_TIME_FORMAT.format(Math.round(diffSec / seconds), unit)
    }
  }
  return RELATIVE_TIME_FORMAT.format(diffSec, "second")
}

function ProjectCard({
  project,
  dau,
}: {
  project: OwnedProject,
  dau: Array<DauPoint> | undefined,
}) {
  const total = dau?.reduce((sum, p) => sum + p.activity, 0) ?? 0
  const peak = dau ? Math.max(...dau.map((p) => p.activity), 0) : 0
  return (
    <Link
      to="/projects/$projectId"
      params={{ projectId: project.id }}
      className="group relative flex h-full flex-col overflow-hidden rounded-md border bg-card transition-colors hover:border-foreground/30 hover:bg-accent/30 hover:transition-none"
    >
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium leading-tight">
            {project.displayName}
          </p>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
            Created {formatRelativeTime(project.createdAt)}
          </p>
        </div>
        <div className="text-end leading-none">
          <span className="font-mono text-sm font-semibold tabular-nums">
            {total.toLocaleString()}
          </span>
          <span className="ms-1 font-mono text-[9px] tracking-wider text-muted-foreground uppercase">
            DAU
          </span>
        </div>
      </div>
      <Sparkline points={dau} peak={peak} />
    </Link>
  )
}

function Sparkline({
  points,
  peak,
}: {
  points: Array<DauPoint> | undefined,
  peak: number,
}) {
  const width = 320
  const height = 32
  const series = points && points.length > 0
    ? points.map((p) => p.activity)
    : Array.from({ length: 7 }, () => 0)
  const n = series.length
  const stepX = n > 1 ? width / (n - 1) : width
  const flat = peak === 0
  const max = flat ? 1 : peak
  const padY = 6
  const toY = (v: number) =>
    flat ? height / 2 : height - (v / max) * (height - padY * 2) - padY

  const coords = series.map((v, i) => [i * stepX, toY(v)] as const)
  const linePath = coords
    .map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`)
    .join(" ")
  const areaPath =
    `M 0 ${height} ` +
    coords.map(([x, y]) => `L ${x.toFixed(2)} ${y.toFixed(2)}`).join(" ") +
    ` L ${width.toFixed(2)} ${height} Z`

  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={flat ? "block text-muted-foreground/40" : "block text-primary"}
      aria-hidden="true"
    >
      {!flat ? (
        <path d={areaPath} fill="currentColor" fillOpacity={0.12} />
      ) : null}
      <path
        d={linePath}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeDasharray={flat ? "4 3" : undefined}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

function NoTeamsEmpty({ onCreateTeam }: { onCreateTeam: () => void }) {
  return (
    <div className="grid place-items-center py-16">
      <Empty className="max-w-md">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <UsersThreeIcon />
          </EmptyMedia>
          <EmptyTitle>Create a team to get started</EmptyTitle>
          <EmptyDescription>
            Projects belong to a team. Create your first team, then spin up a
            project under it.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button onClick={onCreateTeam}>
            <PlusIcon />
            New team
          </Button>
        </EmptyContent>
      </Empty>
    </div>
  )
}
