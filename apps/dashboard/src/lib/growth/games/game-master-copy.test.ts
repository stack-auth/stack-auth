import { describe, expect, it } from "vitest";
import { GAME_MASTER_LINES, gameMasterAnswerLine, pickGameMasterLine } from "./game-master-copy";

describe("pickGameMasterLine", () => {
  it("is stable for a seed, so the host does not change its mind on re-render", () => {
    const first = pickGameMasterLine("correct", "round-1:q3");
    expect(pickGameMasterLine("correct", "round-1:q3")).toBe(first);
    expect(GAME_MASTER_LINES.correct).toContain(first);
  });

  it("varies across seeds", () => {
    const picks = new Set(Array.from({ length: 40 }, (_, index) => pickGameMasterLine("correct", `seed-${index}`)));
    expect(picks.size).toBeGreaterThan(1);
  });

  it("only ever returns a line from the requested moment's bank", () => {
    for (const moment of Object.keys(GAME_MASTER_LINES) as (keyof typeof GAME_MASTER_LINES)[]) {
      for (let index = 0; index < 20; index++) {
        expect(GAME_MASTER_LINES[moment]).toContain(pickGameMasterLine(moment, `s${index}`));
      }
    }
  });
});

describe("gameMasterAnswerLine", () => {
  it("acknowledges a streak only once there is one to acknowledge", () => {
    expect(GAME_MASTER_LINES.correct).toContain(gameMasterAnswerLine({ correct: true, streakBefore: 0, seed: "a" }));
    expect(GAME_MASTER_LINES.correctStreak).toContain(gameMasterAnswerLine({ correct: true, streakBefore: 1, seed: "a" }));
  });

  it("only mourns a streak that was actually running", () => {
    // "And the streak ends there" after a single correct answer would be a lie the player can see.
    expect(GAME_MASTER_LINES.wrong).toContain(gameMasterAnswerLine({ correct: false, streakBefore: 0, seed: "a" }));
    expect(GAME_MASTER_LINES.wrong).toContain(gameMasterAnswerLine({ correct: false, streakBefore: 1, seed: "a" }));
    expect(GAME_MASTER_LINES.wrongAfterStreak).toContain(gameMasterAnswerLine({ correct: false, streakBefore: 4, seed: "a" }));
  });

  it("never uses an exclamation mark or emoji", () => {
    // The register is "confident host", not "slot machine" — the energy lives in the phrasing.
    for (const lines of Object.values(GAME_MASTER_LINES)) {
      for (const line of lines) {
        expect(line).not.toMatch(/[!\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
      }
    }
  });
});
