import { describe, expect, it } from "vitest";
import { applyProjectWeeklyUsersRows } from "./route";

describe("internal projects weekly users helpers", () => {
  it("applies ClickHouse rows through a Map and skips unknown projects", () => {
    const byProject = new Map([
      ["project-a", {
        weekly_users: 0,
        daily_users: [
          { date: "2026-05-01", activity: 0 },
          { date: "2026-05-02", activity: 0 },
        ],
      }],
      ["__proto__", {
        weekly_users: 0,
        daily_users: [
          { date: "2026-05-01", activity: 0 },
          { date: "2026-05-02", activity: 0 },
        ],
      }],
    ]);

    applyProjectWeeklyUsersRows(
      byProject,
      [
        { projectId: "project-a", day: "1970-01-01", users: 4 },
        { projectId: "__proto__", day: "1970-01-01", users: 7 },
        { projectId: "missing-project", day: "1970-01-01", users: 99 },
        { projectId: "project-a", day: "2026-05-01", users: 2 },
        { projectId: "__proto__", day: "2026-05-02", users: 5 },
        { projectId: "missing-project", day: "2026-05-01", users: 99 },
      ],
    );

    expect(Object.fromEntries(byProject)).toMatchInlineSnapshot(`
      {
        "__proto__": {
          "daily_users": [
            {
              "activity": 0,
              "date": "2026-05-01",
            },
            {
              "activity": 5,
              "date": "2026-05-02",
            },
          ],
          "weekly_users": 7,
        },
        "project-a": {
          "daily_users": [
            {
              "activity": 2,
              "date": "2026-05-01",
            },
            {
              "activity": 0,
              "date": "2026-05-02",
            },
          ],
          "weekly_users": 4,
        },
      }
    `);
  });
});
