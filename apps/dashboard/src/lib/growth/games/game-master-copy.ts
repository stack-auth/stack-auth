/**
 * The game master's voice.
 *
 * Kept as data in one module, and picked deterministically from a seed, for two reasons: the lines
 * have to stay in one register (this is the only place in the product that talks like this, and a
 * line drifting into cutesy is very visible), and a Math.random() pick would re-roll on every React
 * re-render, so the host would appear to change its mind mid-question.
 */

export const GAME_MASTER_LINES = {
  roundStart: [
    "Eight questions about your own product. No peeking at the metrics page.",
    "Let's find out whether you actually read your dashboards.",
    "Your numbers, your guesses. Ready when you are.",
  ],
  correct: [
    "Correct.",
    "Nailed it.",
    "That's the one.",
    "Exactly right.",
  ],
  correctStreak: [
    "Two for two.",
    "Still going.",
    "You're on a run.",
    "Nobody's stopping you.",
  ],
  wrong: [
    "Not this time.",
    "Off the mark.",
    "Nope — have a look at the real number.",
    "Close, but no.",
  ],
  wrongAfterStreak: [
    "And the streak ends there.",
    "That breaks the run.",
    "So much for the hot streak.",
  ],
} as const;

export type GameMasterMoment = keyof typeof GAME_MASTER_LINES;

function hash(seed: string): number {
  // FNV-1a, same one-liner as the backend's fact seeding. Nothing here is a secret; it only needs to
  // be stable for a given seed.
  let value = 0x811c9dc5;
  for (let index = 0; index < seed.length; index++) {
    value ^= seed.charCodeAt(index);
    value = Math.imul(value, 0x01000193);
  }
  return value >>> 0;
}

/** Deterministic pick, so the same moment in the same round always says the same thing. */
export function pickGameMasterLine(moment: GameMasterMoment, seed: string): string {
  const lines = GAME_MASTER_LINES[moment];
  return lines[hash(`${moment}:${seed}`) % lines.length];
}

/**
 * The line to show after an answer is graded. `streakBefore` is the run the player was on going into
 * the question, which is what makes "and the streak ends there" land only when there was one.
 */
export function gameMasterAnswerLine(input: { correct: boolean, streakBefore: number, seed: string }): string {
  if (input.correct) {
    return pickGameMasterLine(input.streakBefore >= 1 ? "correctStreak" : "correct", input.seed);
  }
  return pickGameMasterLine(input.streakBefore >= 2 ? "wrongAfterStreak" : "wrong", input.seed);
}
