import { useMemo, useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import { useUser } from "@stackframe/tanstack-start"

import { useProjectsDau } from "@/hooks/use-projects-dau"
import { useCurrentUserTeamsQuery, useOwnedProjectsQuery } from "@/lib/stack/react-query"

export type OwnedProject = {
  id: string,
  displayName: string,
  description: string | null,
  createdAt: Date,
  ownerTeamId: string | null,
}

export function useProjectsPage() {
  const user = useUser({ or: "redirect", projectIdMustMatch: "internal" })
  const { data: projects = [] } = useOwnedProjectsQuery(user)
  const { data: teams = [] } = useCurrentUserTeamsQuery(user)
  const navigate = useNavigate()

  const dauQuery = useProjectsDau()

  const [query, setQuery] = useState("")
  const [createTeamOpen, setCreateTeamOpen] = useState(false)

  const projectsByTeam = useMemo(() => {
    const map = new Map<string, Array<OwnedProject>>()
    for (const t of teams) map.set(t.id, [])
    const orphans: Array<OwnedProject> = []
    for (const p of projects) {
      if (p.ownerTeamId != null && map.has(p.ownerTeamId)) {
        map.get(p.ownerTeamId)!.push(p)
      } else {
        orphans.push(p)
      }
    }
    return { map, orphans }
  }, [projects, teams])

  const q = query.trim().toLowerCase()
  const matchProject = (p: OwnedProject) =>
    q === "" ||
    p.displayName.toLowerCase().includes(q) ||
    (p.description?.toLowerCase().includes(q) ?? false) ||
    p.id.toLowerCase().includes(q)

  const goToNew = () => navigate({ to: "/projects/new" })

  const visibleTeamSections = teams
    .map((team) => {
      const teamProjects = (projectsByTeam.map.get(team.id) ?? []).filter(matchProject)
      return {
        team,
        projects: teamProjects,
        totalCount: projectsByTeam.map.get(team.id)?.length ?? 0,
      }
    })
    .filter(({ projects: teamProjects }) => q === "" || teamProjects.length > 0)

  return {
    teams,
    query,
    setQuery,
    createTeamOpen,
    setCreateTeamOpen,
    visibleTeamSections,
    orphanProjects: projectsByTeam.orphans.filter(matchProject),
    orphanTotalCount: projectsByTeam.orphans.length,
    dauByProject: dauQuery.data?.projects,
    goToNew,
  }
}
