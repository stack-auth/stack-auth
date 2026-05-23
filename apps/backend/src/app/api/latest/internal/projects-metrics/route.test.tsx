import { describe, expect, it } from "vitest";
import { applyProjectMetricsRows } from "./route";

describe("internal projects metrics helpers", () => {
  it("applies total user and daily signup rows through a Map and skips unknown projects", () => {
    const byProject = new Map([
      ["project-a", {
        total_users: 0,
        daily_signups: [
          { date: "2026-05-01", activity: 0 },
          { date: "2026-05-02", activity: 0 },
        ],
      }],
      ["__proto__", {
        total_users: 0,
        daily_signups: [
          { date: "2026-05-01", activity: 0 },
          { date: "2026-05-02", activity: 0 },
        ],
      }],
    ]);

    applyProjectMetricsRows(
      byProject,
      [
        { projectId: "project-a", totalUsers: 12 },
        { projectId: "__proto__", totalUsers: 7 },
        { projectId: "missing-project", totalUsers: 99 },
      ],
      [
        { projectId: "project-a", day: "2026-05-01", signups: 2 },
        { projectId: "__proto__", day: "2026-05-02", signups: 5 },
        { projectId: "missing-project", day: "2026-05-01", signups: 99 },
      ],
    );

    expect(Object.fromEntries(byProject)).toMatchInlineSnapshot(`
      {
        "__proto__": {
          "daily_signups": [
            {
              "activity": 0,
              "date": "2026-05-01",
            },
            {
              "activity": 5,
              "date": "2026-05-02",
            },
          ],
          "total_users": 7,
        },
        "project-a": {
          "daily_signups": [
            {
              "activity": 2,
              "date": "2026-05-01",
            },
            {
              "activity": 0,
              "date": "2026-05-02",
            },
          ],
          "total_users": 12,
        },
      }
    `);
  });
});
