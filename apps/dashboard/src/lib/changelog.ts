export type ChangeType = "major" | "minor" | "patch";

export type ChangelogEntry = {
  version: string,
  type: ChangeType,
  markdown: string,
  bulletCount: number,
  releasedAt?: string,
  isUnreleased?: boolean,
};
