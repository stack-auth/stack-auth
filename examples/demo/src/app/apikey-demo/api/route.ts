import { NextResponse } from "next/server";
import { stackServerApp } from "src/stack";
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { apiKey } = body;

    if (!apiKey) {
      return NextResponse.json(
        { error: "API key is required" },
        { status: 400 }
      );
    }

    // Try to validate the API key using the stack app
    let user;
    let userError;
    let team;
    let teamError;

    try {
      user = await stackServerApp.getUser({ apiKey });
    } catch (error) {
      userError = error.message;
    }

    try {
      team = await stackServerApp.getTeam({ apiKey });
    } catch (error) {
      teamError = error.message;
    }

    return NextResponse.json({
      user: { user, error: userError },
      team: { team, error: teamError }
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }
}
