import { getClickhouseAdminClient } from "@/lib/clickhouse";
import { isPreviewModeEnabled } from "@/lib/preview-mode";
import { seedDummyProject } from "@/lib/seed-dummy-data";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { StatusError } from "@hexclave/shared/dist/utils/errors";
import { ignoreUnhandledRejection } from "@hexclave/shared/dist/utils/promises";

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Create a preview project",
    description: "Creates a new project pre-filled with dummy data for the preview environment. Only available when NEXT_PUBLIC_STACK_IS_PREVIEW=true.",
    tags: ["Internal"],
  },
  request: yupObject({
    auth: yupObject({
      type: clientOrHigherAuthTypeSchema,
      tenancy: adaptSchema.defined(),
      user: adaptSchema.defined(),
      project: yupObject({
        id: yupString().oneOf(["internal"]).defined(),
      }).defined(),
    }).defined(),
    body: yupObject({}).optional().default({}),
    method: yupString().oneOf(["POST"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      project_id: yupString().defined(),
    }).defined(),
  }),
  async handler({ auth }) {
    if (!isPreviewModeEnabled()) {
      throw new StatusError(StatusError.Forbidden, "This endpoint is only available in preview mode");
    }

    // Pre-warm the ClickHouse Cloud connection, then hand the same client to
    // seedDummyProject so every analytics insert reuses it. The first insert
    // otherwise pays a one-time ~0.7s cold cost (idle-service wake-up + TLS).
    // Firing a trivial query now — unawaited — overlaps that wake-up and the
    // TLS handshake with the Postgres-heavy seeding below; threading the warmed
    // client through means the handshake is established exactly once.
    const clickhouseClient = getClickhouseAdminClient();
    const clickhouseWarmup = clickhouseClient
      .command({ query: "SELECT 1" });
    ignoreUnhandledRejection(clickhouseWarmup);

    const userId = auth.user.id;
    const prisma = await getPrismaClientForTenancy(auth.tenancy);

    // Find the user's first team (auto-created on sign-up via create_team_on_sign_up)
    const membership = await prisma.teamMember.findFirst({
      where: {
        tenancyId: auth.tenancy.id,
        projectUserId: userId,
      },
      select: {
        teamId: true,
      },
    });

    if (!membership) {
      throw new StatusError(StatusError.BadRequest, "User must belong to a team to create a preview project");
    }

    const projectId = await seedDummyProject({
      ownerTeamId: membership.teamId,
      oauthProviderIds: ['github', 'google', 'microsoft', 'spotify'],
      excludeAlphaApps: true,
      skipGithubConfigSource: true,
      clickhouseClient,
    });

    // Settle the warm-up promise (long since resolved by now) so it does not
    // float past the handler return.
    await clickhouseWarmup;

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        project_id: projectId,
      },
    };
  },
});
