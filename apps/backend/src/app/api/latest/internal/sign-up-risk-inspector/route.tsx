// Platform-admin diagnostic tool. Stats-based signals are evaluated against
// the internal project's own sign-ups because this request has no source IP.

import { ensurePlatformAdmin } from "@/lib/platform-admin";
import { calculateSignUpRiskAssessment, signUpRiskSignalIds } from "@/lib/risk-scores";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@hexclave/shared";
import { riskScoreFieldSchema } from "@hexclave/shared/dist/interface/crud/users";
import { adaptSchema, clientOrHigherAuthTypeSchema, emailSchema, yupArray, yupMixed, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import type { Json } from "@hexclave/shared/dist/utils/json";
import { INTERNAL_PROJECT_ID } from "../newly-created-projects/helpers";

export const POST = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({
      type: clientOrHigherAuthTypeSchema.defined(),
      tenancy: adaptSchema.defined(),
      user: adaptSchema,
      project: adaptSchema.defined(),
    }),
    body: yupObject({
      emails: yupArray(emailSchema.defined()).min(1).max(50).defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      results: yupArray(yupObject({
        email: emailSchema.defined(),
        scores: yupObject({
          bot: riskScoreFieldSchema,
          free_trial_abuse: riskScoreFieldSchema,
        }).defined(),
        heuristic_facts: yupObject({
          email_normalized: yupString().nullable().defined(),
          email_base: yupString().nullable().defined(),
        }).defined(),
        breakdown: yupArray(yupObject({
          signal: yupString().oneOf(signUpRiskSignalIds).defined(),
          factor: yupObject({
            bot: yupNumber().min(0).max(1).defined(),
            free_trial_abuse: yupNumber().min(0).max(1).defined(),
          }).defined(),
          details: yupMixed<Record<string, Json>>().defined(),
        }).defined()).defined(),
      }).defined()).defined(),
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

    const emails = [...new Set(req.body.emails.map((email) => email.trim().toLowerCase()))];
    const results = await Promise.all(emails.map(async (email) => {
      const assessment = await calculateSignUpRiskAssessment(req.auth.tenancy, {
        primaryEmail: email,
        primaryEmailVerified: false,
        authMethod: "password",
        oauthProvider: null,
        ipAddress: null,
        ipTrusted: null,
        turnstileAssessment: { status: "ok" },
      });
      return {
        email,
        scores: {
          bot: assessment.scores.bot,
          free_trial_abuse: assessment.scores.free_trial_abuse,
        },
        heuristic_facts: {
          email_normalized: assessment.heuristicFacts.emailNormalized,
          email_base: assessment.heuristicFacts.emailBase,
        },
        breakdown: assessment.breakdown,
      };
    }));

    return {
      statusCode: 200 as const,
      bodyType: "json" as const,
      body: { results },
    };
  },
});
