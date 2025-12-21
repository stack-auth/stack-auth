import { parseRootChangelog } from "@/lib/changelog";
import { NextResponse } from "next/server";

const ROOT_CHANGELOG_URL = "https://raw.githubusercontent.com/stack-auth/stack-auth/965c0d315609e7b1fe184e8ead40e154b5364b8c/CHANGELOG.md";
const REVALIDATE_SECONDS = 60 * 60;

export async function GET() {
  try {
    const response = await fetch(ROOT_CHANGELOG_URL, {
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
