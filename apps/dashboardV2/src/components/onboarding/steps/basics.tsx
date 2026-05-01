import { useUser } from "@stackframe/tanstack-start"
import { UsersThreeIcon } from "@phosphor-icons/react"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useCurrentUserTeamsQuery } from "@/lib/stack/react-query"

type BasicsStepProps = {
  displayName: string,
  setDisplayName: (value: string) => void,
  teamId: string | null,
  setTeamId: (value: string) => void,
}

export function BasicsStep({
  displayName,
  setDisplayName,
  teamId,
  setTeamId,
}: BasicsStepProps) {
  const user = useUser({ or: "redirect", projectIdMustMatch: "internal" })
  const teams = useCurrentUserTeamsQuery(user).data ?? []
  const teamsById = new Map(teams.map((t) => [t.id, t]))

  return (
    <div className="mx-auto max-w-xl space-y-8">
      <div className="space-y-2">
        <p className="font-mono text-[11px] tracking-[0.18em] text-muted-foreground uppercase">
          Step 1
        </p>
        <h2 className="font-heading text-2xl font-semibold tracking-tight">
          Name your project
        </h2>
        <p className="text-sm text-muted-foreground">
          Choose the team that will own this project and give it a name.
        </p>
      </div>

      <div className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="team">Team</Label>
          {teams.length === 0 ? (
            <div className="flex items-center gap-2 rounded-md border border-dashed bg-muted/30 px-3 py-3 text-xs text-muted-foreground">
              <UsersThreeIcon className="size-4" />
              You need a team first. Cancel and create one from Projects.
            </div>
          ) : (
            <Select
              value={teamId ?? undefined}
              onValueChange={(value) => {
                if (typeof value !== "string") return
                setTeamId(value)
              }}
            >
              <SelectTrigger id="team" className="h-9 w-full">
                <SelectValue placeholder="Select a team">
                  {(value: unknown) => {
                    if (typeof value !== "string" || value.length === 0) {
                      return "Select a team"
                    }
                    return teamsById.get(value)?.displayName ?? value
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {teams.map((team) => (
                  <SelectItem key={team.id} value={team.id}>
                    {team.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="displayName">Project name</Label>
          <Input
            id="displayName"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="My Awesome App"
            autoFocus
          />
          <p className="text-[11px] text-muted-foreground">
            At least 2 characters. You can change this later.
          </p>
        </div>
      </div>
    </div>
  )
}
