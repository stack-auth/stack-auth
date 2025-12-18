import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { getMonorepoRoot } from "@/lib/monorepo-root";
import { parseRootChangelog } from "@/lib/parse-changelogs";

function getChangelogPath(): string {
  return path.join(getMonorepoRoot(), "CHANGELOG.md");
}

function getUpdatedAt(filePath: string): string | null {
  try {
    const stats = fs.statSync(filePath);
    return stats.mtime.toISOString();
  } catch {
    return null;
  }
}

export async function GET() {
  const changelogPath = getChangelogPath();
  const entries = parseRootChangelog(getMonorepoRoot());

  return NextResponse.json(
    {
      source: "/CHANGELOG.md",
      updatedAt: getUpdatedAt(changelogPath),
      totalEntries: entries.length,
      entries,
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=300",
      },
    },
  );
}
