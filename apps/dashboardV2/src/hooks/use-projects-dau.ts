import { useQuery } from "@tanstack/react-query"
import { useUser } from "@stackframe/tanstack-start"
import { stackApp } from "@/lib/stack/app"

export type DauPoint = { date: string, activity: number }
export type ProjectsDauResponse = { projects: Record<string, Array<DauPoint>> }

const stackAppInternalsSymbol = Symbol.for(
  "StackAuth--DO-NOT-USE-OR-YOU-WILL-BE-FIRED--StackAppInternals",
)

type StackAppInternals = {
  sendRequest: (
    path: string,
    requestOptions: RequestInit,
    requestType?: "client" | "server" | "admin",
  ) => Promise<Response>,
}

function getInternals(): StackAppInternals {
  const internals = (stackApp as unknown as Record<symbol, unknown>)[
    stackAppInternalsSymbol
  ]
  if (internals == null || typeof internals !== "object") {
    throw new Error("Stack app internals are unavailable")
  }
  return internals as StackAppInternals
}

export function useProjectsDau() {
  const user = useUser({ or: "redirect", projectIdMustMatch: "internal" })

  return useQuery<ProjectsDauResponse>({
    queryKey: ["projects-dau", user.id],
    queryFn: async () => {
      const response = await getInternals().sendRequest(
        "/internal/projects-dau",
        {},
        "client",
      )
      if (!response.ok) {
        const text = await response.text()
        throw new Error(
          `Failed to load projects DAU: ${response.status} ${response.statusText} — ${text}`,
        )
      }
      const body = (await response.json()) as unknown
      if (
        body == null ||
        typeof body !== "object" ||
        !("projects" in body) ||
        typeof (body).projects !== "object"
      ) {
        throw new Error("Unexpected projects-dau response shape")
      }
      return body as ProjectsDauResponse
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })
}
