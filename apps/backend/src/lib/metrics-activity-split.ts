import type { MetricsActivitySplit } from "@stackframe/stack-shared/dist/interface/admin-metrics";

export type ActivitySplit = MetricsActivitySplit;

export function createEmptySplitSeries(days: string[]): ActivitySplit {
  const emptySeries = days.map((date) => ({ date, activity: 0 }));
  return {
    total: emptySeries.map((item) => ({ ...item })),
    new: emptySeries.map((item) => ({ ...item })),
    retained: emptySeries.map((item) => ({ ...item })),
    reactivated: emptySeries.map((item) => ({ ...item })),
  };
}

/**
 * Bucket each day's active entity ids into new / retained / reactivated counts.
 *
 * Classification rules (in order):
 *   1. createdDay === current day                       → new
 *   2. entity was active on the immediately previous day → retained
 *   3. entity was active earlier in the window           → reactivated
 *   4. createdDay falls inside the window                → new (gap-day case)
 *   5. otherwise (created before window, or unknown)     → reactivated
 *      (avoids inflating "new" for pre-existing entities first seen inside the window)
 */
export function buildSplitFromDailyEntitySets(options: {
  orderedDays: string[],
  entityIdsByDay: Map<string, Set<string>>,
  createdDayByEntityId?: Map<string, string>,
}): ActivitySplit {
  const { orderedDays, entityIdsByDay, createdDayByEntityId } = options;
  const split = createEmptySplitSeries(orderedDays);
  const windowStart = orderedDays[0];
  const previouslySeen = new Set<string>();
  let previousDaySet = new Set<string>();

  for (let i = 0; i < orderedDays.length; i += 1) {
    const day = orderedDays[i];
    const currentDaySet = entityIdsByDay.get(day) ?? new Set<string>();
    let newCount = 0;
    let retainedCount = 0;
    let reactivatedCount = 0;

    for (const entityId of currentDaySet) {
      const createdDay = createdDayByEntityId?.get(entityId);
      if (createdDay === day) {
        newCount += 1;
      } else if (previousDaySet.has(entityId)) {
        retainedCount += 1;
      } else if (previouslySeen.has(entityId)) {
        reactivatedCount += 1;
      } else if (createdDay != null && createdDay >= windowStart) {
        // Created within the window on a different day, but not active on the
        // immediately previous day — treat as new (gap-day case).
        newCount += 1;
      } else {
        // Either created before the window started, or createdDay is unknown.
        // Either way, we cannot legitimately bucket this as "new" — count as
        // reactivated to avoid inflating new-user metrics for pre-existing
        // entities first seen inside the window.
        reactivatedCount += 1;
      }
    }

    split.total[i].activity = currentDaySet.size;
    split.new[i].activity = newCount;
    split.retained[i].activity = retainedCount;
    split.reactivated[i].activity = reactivatedCount;

    for (const entityId of currentDaySet) {
      previouslySeen.add(entityId);
    }
    previousDaySet = currentDaySet;
  }

  return split;
}

if (import.meta.vitest) {
  const { test, expect, describe } = import.meta.vitest;

  // Three-day window for the simple cases below.
  const days = ['2026-04-01', '2026-04-02', '2026-04-03'];

  describe("buildSplitFromDailyEntitySets", () => {
    test("classifies a user active only today as new when their createdDay === today", () => {
      const split = buildSplitFromDailyEntitySets({
        orderedDays: days,
        entityIdsByDay: new Map([
          ['2026-04-01', new Set()],
          ['2026-04-02', new Set()],
          ['2026-04-03', new Set(['user-a'])],
        ]),
        createdDayByEntityId: new Map([['user-a', '2026-04-03']]),
      });
      expect(split.new.map((d) => d.activity)).toEqual([0, 0, 1]);
      expect(split.retained.map((d) => d.activity)).toEqual([0, 0, 0]);
      expect(split.reactivated.map((d) => d.activity)).toEqual([0, 0, 0]);
      expect(split.total.map((d) => d.activity)).toEqual([0, 0, 1]);
    });

    test("classifies a user active on consecutive days as new on day 1 and retained on day 2", () => {
      const split = buildSplitFromDailyEntitySets({
        orderedDays: days,
        entityIdsByDay: new Map([
          ['2026-04-01', new Set(['user-a'])],
          ['2026-04-02', new Set(['user-a'])],
          ['2026-04-03', new Set()],
        ]),
        createdDayByEntityId: new Map([['user-a', '2026-04-01']]),
      });
      expect(split.new.map((d) => d.activity)).toEqual([1, 0, 0]);
      expect(split.retained.map((d) => d.activity)).toEqual([0, 1, 0]);
      expect(split.reactivated.map((d) => d.activity)).toEqual([0, 0, 0]);
    });

    test("classifies a user with a gap day as new then reactivated", () => {
      // Active day 1, missing day 2, active day 3 → reactivated on day 3
      // because they were previously seen but not on the immediately previous day.
      const split = buildSplitFromDailyEntitySets({
        orderedDays: days,
        entityIdsByDay: new Map([
          ['2026-04-01', new Set(['user-a'])],
          ['2026-04-02', new Set()],
          ['2026-04-03', new Set(['user-a'])],
        ]),
        createdDayByEntityId: new Map([['user-a', '2026-04-01']]),
      });
      expect(split.new.map((d) => d.activity)).toEqual([1, 0, 0]);
      expect(split.retained.map((d) => d.activity)).toEqual([0, 0, 0]);
      expect(split.reactivated.map((d) => d.activity)).toEqual([0, 0, 1]);
    });

    test("classifies a user created in-window with a gap before first activity as new (rule 4)", () => {
      // createdDay is 2026-04-02 but they're not active on 2026-04-02.
      // First active 2026-04-03 → bucket as new (created within window),
      // not reactivated, because they have never been seen before.
      const split = buildSplitFromDailyEntitySets({
        orderedDays: days,
        entityIdsByDay: new Map([
          ['2026-04-01', new Set()],
          ['2026-04-02', new Set()],
          ['2026-04-03', new Set(['user-a'])],
        ]),
        createdDayByEntityId: new Map([['user-a', '2026-04-02']]),
      });
      expect(split.new.map((d) => d.activity)).toEqual([0, 0, 1]);
      expect(split.reactivated.map((d) => d.activity)).toEqual([0, 0, 0]);
    });

    test("classifies a user created before the window as reactivated, never new (rule 5)", () => {
      // createdDay is 2026-03-15 (before window). They are first seen on 2026-04-02.
      // Should bucket as reactivated to avoid inflating new-user metrics with
      // pre-existing entities that just happened to log in inside the window.
      const split = buildSplitFromDailyEntitySets({
        orderedDays: days,
        entityIdsByDay: new Map([
          ['2026-04-01', new Set()],
          ['2026-04-02', new Set(['user-a'])],
          ['2026-04-03', new Set(['user-a'])],
        ]),
        createdDayByEntityId: new Map([['user-a', '2026-03-15']]),
      });
      expect(split.new.map((d) => d.activity)).toEqual([0, 0, 0]);
      expect(split.retained.map((d) => d.activity)).toEqual([0, 0, 1]);
      expect(split.reactivated.map((d) => d.activity)).toEqual([0, 1, 0]);
    });

    test("treats unknown createdDay as 'never new' (rule 5 fallback)", () => {
      // user-a is active in the window but has no createdDay record. The
      // function should not bucket them as new — falls into reactivated.
      const split = buildSplitFromDailyEntitySets({
        orderedDays: days,
        entityIdsByDay: new Map([
          ['2026-04-01', new Set()],
          ['2026-04-02', new Set(['user-a'])],
          ['2026-04-03', new Set()],
        ]),
        createdDayByEntityId: new Map(),
      });
      expect(split.new.map((d) => d.activity)).toEqual([0, 0, 0]);
      expect(split.reactivated.map((d) => d.activity)).toEqual([0, 1, 0]);
    });

    test("handles multiple users with different classification on the same day", () => {
      // Day 3:
      //   - user-a created day 3 → new
      //   - user-b active day 2 + day 3 → retained
      //   - user-c active day 1 then day 3 (gap) → reactivated
      const split = buildSplitFromDailyEntitySets({
        orderedDays: days,
        entityIdsByDay: new Map([
          ['2026-04-01', new Set(['user-c'])],
          ['2026-04-02', new Set(['user-b'])],
          ['2026-04-03', new Set(['user-a', 'user-b', 'user-c'])],
        ]),
        createdDayByEntityId: new Map([
          ['user-a', '2026-04-03'],
          ['user-b', '2026-04-02'],
          ['user-c', '2026-04-01'],
        ]),
      });
      expect(split.total[2].activity).toBe(3);
      expect(split.new[2].activity).toBe(1);        // user-a
      expect(split.retained[2].activity).toBe(1);   // user-b
      expect(split.reactivated[2].activity).toBe(1); // user-c
    });

    test("returns all-zero series when no entities are active", () => {
      const split = buildSplitFromDailyEntitySets({
        orderedDays: days,
        entityIdsByDay: new Map(),
        createdDayByEntityId: new Map(),
      });
      expect(split.total.map((d) => d.activity)).toEqual([0, 0, 0]);
      expect(split.new.map((d) => d.activity)).toEqual([0, 0, 0]);
      expect(split.retained.map((d) => d.activity)).toEqual([0, 0, 0]);
      expect(split.reactivated.map((d) => d.activity)).toEqual([0, 0, 0]);
    });

    test("preserves the orderedDays date list across all four series", () => {
      const split = buildSplitFromDailyEntitySets({
        orderedDays: days,
        entityIdsByDay: new Map(),
      });
      const dateList = days;
      expect(split.total.map((d) => d.date)).toEqual(dateList);
      expect(split.new.map((d) => d.date)).toEqual(dateList);
      expect(split.retained.map((d) => d.date)).toEqual(dateList);
      expect(split.reactivated.map((d) => d.date)).toEqual(dateList);
    });
  });

  describe("createEmptySplitSeries", () => {
    test("returns independent series objects (not aliased)", () => {
      const split = createEmptySplitSeries(['2026-04-01', '2026-04-02']);
      split.new[0].activity = 5;
      // Mutating .new should not bleed into .total/.retained/.reactivated.
      expect(split.total[0].activity).toBe(0);
      expect(split.retained[0].activity).toBe(0);
      expect(split.reactivated[0].activity).toBe(0);
    });
  });
}
