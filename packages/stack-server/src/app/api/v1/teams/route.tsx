import { NextRequest, NextResponse } from "next/server";
import * as yup from "yup";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { deprecatedParseRequest, deprecatedSmartRouteHandler } from "@/lib/route-handlers";
import { checkApiKeySet, secretServerKeyHeaderSchema } from "@/lib/api-keys";
import { isProjectAdmin } from "@/lib/projects";
import { createServerTeam, listServerTeams } from "@/lib/teams";
import { ServerTeamJson } from "@stackframe/stack-shared/dist/interface/serverInterface";

const getSchema = yup.object({
  query: yup.object({
    server: yup.string().oneOf(["true"]).required(),
  }).required(),
  headers: yup.object({
    "x-stack-secret-server-key": secretServerKeyHeaderSchema.default(""),
    "x-stack-admin-access-token": yup.string().default(""),
    "x-stack-project-id": yup.string().required(),
  }).required(),
});

export const GET = deprecatedSmartRouteHandler(async (req: NextRequest) => {
  const {
    query: {
      server,
    },
    headers: {
      "x-stack-project-id": projectId,
      "x-stack-secret-server-key": secretServerKey,
      "x-stack-admin-access-token": adminAccessToken,
    },
  } = await deprecatedParseRequest(req, getSchema);

  const skValid = await checkApiKeySet(projectId, { secretServerKey });
  const asValid = await isProjectAdmin(projectId, adminAccessToken);

  let teams: ServerTeamJson[] = [];
  if (server === "true") {
    if (!skValid && !asValid) {
      throw new StatusError(StatusError.Forbidden);
    }
    teams = await listServerTeams(projectId);
  }

  return NextResponse.json(teams);
});

const postSchema = yup.object({
  query: yup.object({
    server: yup.string().oneOf(["true"]).required(),
  }).required(),
  headers: yup.object({
    "x-stack-secret-server-key": secretServerKeyHeaderSchema.default(""),
    "x-stack-admin-access-token": yup.string().default(""),
    "x-stack-project-id": yup.string().required(),
  }).required(),
  body: yup.object({
    displayName: yup.string().required(),
  }).required(),
});

export const POST = deprecatedSmartRouteHandler(async (req: NextRequest) => {
  const {
    query: {
      server,
    },
    headers: {
      "x-stack-project-id": projectId,
      "x-stack-secret-server-key": secretServerKey,
      "x-stack-admin-access-token": adminAccessToken,
    },
    body,
  } = await deprecatedParseRequest(req, postSchema);

  const skValid = await checkApiKeySet(projectId, { secretServerKey });
  const asValid = await isProjectAdmin(projectId, adminAccessToken);

  if (server === "true") {
    if (!skValid && !asValid) {
      throw new StatusError(StatusError.Forbidden);
    }

    const team = await createServerTeam(projectId, body);
    return NextResponse.json(team);
  }

  return NextResponse.json(null);
});
