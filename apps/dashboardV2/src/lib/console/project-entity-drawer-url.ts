type ProjectEntityDrawerSelection = {
  userId?: string | null
  teamId?: string | null
}

export function getProjectEntityDrawerHref(
  currentHref: string,
  selection: ProjectEntityDrawerSelection
) {
  if (selection.userId != null && selection.teamId != null) {
    throw new Error("Cannot open both a user drawer and a team drawer.")
  }

  const url = new URL(currentHref)

  if (selection.userId == null) {
    url.searchParams.delete("userId")
  } else {
    url.searchParams.set("userId", selection.userId)
  }

  if (selection.teamId == null) {
    url.searchParams.delete("teamId")
  } else {
    url.searchParams.set("teamId", selection.teamId)
  }

  return `${url.pathname}${url.search}${url.hash}`
}
