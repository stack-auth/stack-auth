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
        { projectId: "project-a", weeklyUsers: 4 },
        { projectId: "__proto__", weeklyUsers: 7 },
        { projectId: "missing-project", weeklyUsers: 99 },
      ],
      [
        { projectId: "project-a", day: "2026-05-01", dailyUsers: 2 },
        { projectId: "__proto__", day: "2026-05-02", dailyUsers: 5 },
        { projectId: "missing-project", day: "2026-05-01", dailyUsers: 99 },
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
