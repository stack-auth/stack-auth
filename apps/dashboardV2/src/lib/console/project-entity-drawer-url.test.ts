import { describe, expect, it } from "vitest"

import { getProjectEntityDrawerHref } from "@/lib/console/project-entity-drawer-url"

describe("getProjectEntityDrawerHref", () => {
  it("opens a user drawer without changing the current route", () => {
    expect(
      getProjectEntityDrawerHref(
        "http://localhost:8111/projects/project/session-replays/replay-1?foo=bar#events",
        { userId: "user-1" }
      )
    ).toBe(
      "/projects/project/session-replays/replay-1?foo=bar&userId=user-1#events"
    )
  })

  it("switches drawer entity params without dropping unrelated search params", () => {
    expect(
      getProjectEntityDrawerHref(
        "http://localhost:8111/projects/project?foo=bar&userId=user-1",
        { teamId: "team-1" }
      )
    ).toBe("/projects/project?foo=bar&teamId=team-1")
  })

  it("clears drawer params when the selection is empty", () => {
    expect(
      getProjectEntityDrawerHref(
        "http://localhost:8111/projects/project/users?userId=user-1&teamId=team-1&foo=bar",
        { userId: null, teamId: null }
      )
    ).toBe("/projects/project/users?foo=bar")
  })
})
