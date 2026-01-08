import { parseRootChangelog } from "@/lib/changelog";
import { NextResponse } from "next/server";

const REVALIDATE_SECONDS = 60 * 60;

export async function GET() {
  const changelogUrl = process.env.STACK_CHANGELOG_URL;

  if (!changelogUrl) {
    return NextResponse.json({ entries: [] });
  }

  try {
    const response = await fetch(changelogUrl, {
      headers: {
        "Accept": "text/plain",
        "User-Agent": "stack-auth-dashboard-changelog-widget",
      },
      next: {
        revalidate: REVALIDATE_SECONDS,
      },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: "Failed to download changelog" },
        { status: 502 },
      );
    }

    const content = await response.text();
    const entries = parseRootChangelog(content).slice(0, 8);

    return NextResponse.json({ entries });
  } catch (error) {
    console.error("Failed to fetch remote changelog", error);
    return NextResponse.json(
      { error: "Failed to fetch changelog" },
      { status: 500 },
    );
  }
}
