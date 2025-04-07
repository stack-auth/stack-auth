import { ServerTeam, ServerUser } from "@stackframe/stack";
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
    let user: ServerUser | null = null;
    let userError: any = null;
    let team: ServerTeam | null = null;
    let teamError: any = null;

    let api_keys: any = null;
    let api_keys_error: any = null;


    try {
      user = await stackServerApp.getUser({ apiKey });
      api_keys = await user?.listApiKeys();
    } catch (error) {
      userError = error.message;
    }

    try {
      team = await stackServerApp.getTeam({ apiKey });
      api_keys = await team?.listApiKeys();
    } catch (error) {
      teamError = error.message;
    }

    return NextResponse.json({
      user: { user, error: userError },
      team: { team, error: teamError },
      api_keys: { api_keys, error: api_keys_error }
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }
}
