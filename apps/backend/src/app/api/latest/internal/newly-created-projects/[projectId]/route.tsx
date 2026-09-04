import { ensurePlatformAdmin } from "@/lib/platform-admin";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@hexclave/shared";
import { ALL_APPS } from "@hexclave/shared/dist/apps/apps-config";
import {
  adaptSchema,
  clientOrHigherAuthTypeSchema,
  yupArray,
  yupBoolean,
  yupMixed,
  yupNumber,
  yupObject,
  yupString,
} from "@hexclave/shared/dist/schema-fields";
import { StatusError } from "@hexclave/shared/dist/utils/errors";
import { EMAIL_SETUP_PROVIDERS } from "../schemas";
import {
  FEATURED_APP_IDS,
  INTERNAL_PROJECT_ID,
  loadNewlyCreatedProjectDetail,
} from "../helpers";
import {
  FeaturedAppsSchema,
  ProjectOwnerSchema,
} from "../schemas";

export const GET = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({
      type: clientOrHigherAuthTypeSchema.defined(),
      tenancy: adaptSchema.defined(),
      user: adaptSchema,
      project: adaptSchema.defined(),
    }),
    params: yupObject({
      projectId: yupString().defined(),
    }).defined(),
    query: yupObject({
      replay_cursor: yupString().optional(),
    }).default({}),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      id: yupString().defined(),
      display_name: yupString().defined(),
      description: yupString().defined(),
      created_at: yupString().defined(),
      updated_at: yupString().defined(),
      is_development_environment: yupBoolean().defined(),
      is_production_mode: yupBoolean().defined(),
      onboarding_status: yupString().defined(),
      onboarding_state: yupMixed().nullable().defined(),
      is_onboarding: yupBoolean().defined(),
      non_anonymous_users: yupNumber().integer().defined(),
      anonymous_users: yupNumber().integer().defined(),
      last_user_activity_at: yupString().nullable().defined(),
      has_activity_24h_after_creation: yupBoolean().defined(),
      owner: ProjectOwnerSchema,
      domains: yupArray(yupString().defined()).defined(),
      stripe_connected: yupBoolean().defined(),
      stripe_setup_complete: yupBoolean().defined(),
      email_customized: yupBoolean().defined(),
      email_customization: yupObject({
        has_draft: yupBoolean().defined(),
        has_modified_template: yupBoolean().defined(),
      }).defined(),
      email_setup: yupObject({
        kind: yupString().oneOf(["shared", "custom-domain", "custom-server"]).defined(),
        provider: yupString().oneOf(EMAIL_SETUP_PROVIDERS).nullable().defined(),
        sender_email: yupString().nullable().defined(),
        managed_subdomain: yupString().nullable().defined(),
      }).defined(),
      has_live_payment: yupBoolean().defined(),
      featured_apps: FeaturedAppsSchema,
      other_enabled_apps: yupArray(yupString().oneOf(Object.keys(ALL_APPS)).defined()).defined(),
      featured_app_ids: yupArray(yupString().oneOf([...FEATURED_APP_IDS]).defined()).defined(),
      branch_config: yupMixed().defined(),
      rendered_config: yupMixed().defined(),
      session_replays: yupArray(yupObject({
        id: yupString().defined(),
        project_user: yupObject({
          id: yupString().defined(),
          display_name: yupString().nullable().defined(),
          primary_email: yupString().nullable().defined(),
        }).defined(),
        started_at_millis: yupNumber().defined(),
        last_event_at_millis: yupNumber().defined(),
        chunk_count: yupNumber().defined(),
        event_count: yupNumber().defined(),
      }).defined()).defined(),
      replay_next_cursor: yupString().nullable().defined(),
    }).defined(),
  }),
  handler: async (req) => {
    if (!req.auth.user) {
      throw new KnownErrors.UserAuthenticationRequired();
    }
    if (req.auth.project.id !== INTERNAL_PROJECT_ID) {
      throw new KnownErrors.ExpectedInternalProject();
    }
    await ensurePlatformAdmin(req.auth.user);

    const detail = await loadNewlyCreatedProjectDetail(req.params.projectId, req.query.replay_cursor);
    if (detail == null) {
      throw new StatusError(404, "Project not found");
    }

    return {
      statusCode: 200 as const,
      bodyType: "json" as const,
      body: {
        ...detail,
        featured_app_ids: [...FEATURED_APP_IDS],
      },
    };
  },
});
