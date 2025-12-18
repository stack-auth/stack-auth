import path from "path";

export function getMonorepoRoot(): string {
  return process.env.STACK_MONOREPO_ROOT ?? path.resolve(process.cwd(), "..", "..");
}
