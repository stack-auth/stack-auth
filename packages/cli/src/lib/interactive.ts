export function isNonInteractiveEnv(): boolean {
  return !!(
    process.env.CI
    || process.env.GITHUB_ACTIONS
    || process.env.NONINTERACTIVE
    || !process.stdin.isTTY
  );
}
