import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import {
  adaptSchema,
  adminAuthTypeSchema,
  yupBoolean,
  yupNumber,
  yupObject,
  yupString,
} from "@stackframe/stack-shared/dist/schema-fields";
import { KnownErrors } from "@stackframe/stack-shared";
import { getExternalDbSyncFusebox, updateExternalDbSyncFusebox } from "@/lib/external-db-sync-metadata";

const fuseboxResponseSchema = yupObject({
  statusCode: yupNumber().oneOf([200]).defined(),
  bodyType: yupString().oneOf(["json"]).defined(),
  body: yupObject({
    ok: yupBoolean().defined(),
    sequencer_enabled: yupBoolean().defined(),
    poller_enabled: yupBoolean().defined(),
  }).defined(),
});

const fuseboxRequestSchema = yupObject({
  auth: yupObject({
    type: adminAuthTypeSchema,
    tenancy: adaptSchema,
  }).defined(),
  body: yupObject({
    sequencer_enabled: yupBoolean().defined(),
    poller_enabled: yupBoolean().defined(),
  }).defined(),
  method: yupString().oneOf(["POST"]).defined(),
});

const fuseboxGetRequestSchema = yupObject({
  auth: yupObject({
    type: adminAuthTypeSchema,
    tenancy: adaptSchema,
  }).defined(),
  method: yupString().oneOf(["GET"]).defined(),
});

function ensureInternalProject(projectId: string) {
  if (projectId !== "internal") {
    throw new KnownErrors.ExpectedInternalProject();
  }
}

export const GET = createSmartRouteHandler({
  metadata: {
    summary: "Get external DB sync fusebox settings",
    description: "Returns enablement flags for the external DB sync pipeline.",
    tags: ["External DB Sync"],
    hidden: true,
  },
  request: fuseboxGetRequestSchema,
  response: fuseboxResponseSchema,
  handler: async ({ auth }) => {
    ensureInternalProject(auth.tenancy.project.id);
    const fusebox = await getExternalDbSyncFusebox();
    return {
      statusCode: 200,
      bodyType: "json" as const,
      body: {
        ok: true,
        sequencer_enabled: fusebox.sequencerEnabled,
        poller_enabled: fusebox.pollerEnabled,
      },
    };
  },
});

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Update external DB sync fusebox settings",
    description: "Updates enablement flags for the external DB sync pipeline.",
    tags: ["External DB Sync"],
    hidden: true,
  },
  request: fuseboxRequestSchema,
  response: fuseboxResponseSchema,
  handler: async ({ auth, body }) => {
    ensureInternalProject(auth.tenancy.project.id);
    const fusebox = await updateExternalDbSyncFusebox({
      sequencerEnabled: body.sequencer_enabled,
      pollerEnabled: body.poller_enabled,
    });
    return {
      statusCode: 200,
      bodyType: "json" as const,
      body: {
        ok: true,
        sequencer_enabled: fusebox.sequencerEnabled,
        poller_enabled: fusebox.pollerEnabled,
      },
    };
  },
});
