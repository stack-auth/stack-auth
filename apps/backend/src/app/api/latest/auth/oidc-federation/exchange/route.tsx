import { Prisma } from "@/generated/prisma/client";
import { SystemEventTypes, logEvent } from "@/lib/events";
import { validateOidcJwt } from "@/lib/oidc-jwt";
import { mintServerAccessToken } from "@/lib/server-access-token";
import { DEFAULT_BRANCH_ID, getSoleTenancyFromProjectBranch } from "@/lib/tenancies";
import { globalPrismaClient } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { yupNumber, yupObject, yupString, yupTuple } from "@stackframe/stack-shared/dist/schema-fields";
import { StatusError, captureError } from "@stackframe/stack-shared/dist/utils/errors";
import { matchClaims } from "@stackframe/stack-shared/dist/utils/oidc-federation";
import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";

type AuditRow = Omit<Prisma.OidcFederationExchangeAuditUncheckedCreateInput, "id" | "createdAt" | "outcome"> & {
  outcome: "success" | "failure",
};

async function writeAudit(row: AuditRow): Promise<void> {
  try {
    await globalPrismaClient.oidcFederationExchangeAudit.create({ data: row });
  } catch (error) {
    captureError("oidc-federation-audit-write-failed", error);
  }
}

const GRANT_TYPE = "urn:ietf:params:oauth:grant-type:token-exchange";
const SUBJECT_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:jwt";
const ISSUED_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:access_token";

function flattenClaimConditions(
  conds: Record<string, Record<string, string | undefined> | undefined> | undefined,
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [claimKey, valueRecord] of Object.entries(conds ?? {})) {
    const values = Object.values(valueRecord ?? {}).filter((v): v is string => typeof v === "string");
    if (values.length > 0) out.set(claimKey, values);
  }
  return out;
}

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "OIDC Federation token exchange",
    description:
      "Exchange an OIDC JWT issued by a project-trusted identity provider for a short-lived Stack server access token. " +
      "Follows RFC 8693 (OAuth 2.0 Token Exchange).",
    tags: ["Auth"],
  },
  request: yupObject({
    method: yupString().oneOf(["POST"]).defined(),
    headers: yupObject({
      "x-stack-project-id": yupTuple([yupString().defined()]).defined(),
      "x-stack-branch-id": yupTuple([yupString().defined()]).optional(),
    }).defined(),
    body: yupObject({
      grant_type: yupString().oneOf([GRANT_TYPE]).defined(),
      subject_token: yupString().defined(),
      subject_token_type: yupString().oneOf([SUBJECT_TOKEN_TYPE]).defined(),
      requested_token_type: yupString().optional(),
      audience: yupString().optional(),
      resource: yupString().optional(),
      scope: yupString().optional(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      access_token: yupString().defined(),
      issued_token_type: yupString().oneOf([ISSUED_TOKEN_TYPE]).defined(),
      token_type: yupString().oneOf(["Bearer"]).defined(),
      expires_in: yupNumber().defined(),
    }).defined(),
  }),
  handler: async (req) => {
    const projectId = req.headers["x-stack-project-id"][0];
    const branchId = req.headers["x-stack-branch-id"]?.[0] ?? DEFAULT_BRANCH_ID;

    const tenancy = await getSoleTenancyFromProjectBranch(projectId, branchId, true);
    if (!tenancy) {
      throw new StatusError(400, "invalid_request: project or branch not found");
    }

    const trustPolicies = tenancy.config.oidcFederation.trustPolicies;
    const policyEntries = Object.entries(trustPolicies).filter(([_, policy]) => policy.enabled);
    if (policyEntries.length === 0) {
      throw new StatusError(400, "invalid_request: no enabled OIDC federation trust policies for this project");
    }

    const attemptReasons: Array<{ policyId: string, reason: string }> = [];
    let bestAttempt: { policyId: string, issuer: string, subject: string } | null = null;
    for (const [policyId, policy] of policyEntries) {
      const issuerUrl = policy.issuerUrl;
      const audiences = Object.values(policy.audiences ?? {}).filter((v): v is string => typeof v === "string");
      if (typeof issuerUrl !== "string" || audiences.length === 0) {
        attemptReasons.push({ policyId, reason: "policy is missing issuerUrl or audiences" });
        continue;
      }

      let validated: Awaited<ReturnType<typeof validateOidcJwt>>;
      try {
        validated = await validateOidcJwt({ issuerUrl, audiences, token: req.body.subject_token, prisma: globalPrismaClient });
      } catch (error) {
        attemptReasons.push({ policyId, reason: error instanceof Error ? error.message : String(error) });
        continue;
      }
      bestAttempt = { policyId, issuer: validated.issuer, subject: validated.subject };

      const stringEquals = flattenClaimConditions(policy.claimConditions.stringEquals);
      const stringLike = flattenClaimConditions(policy.claimConditions.stringLike);
      const match = matchClaims({ stringEquals, stringLike }, validated.claims);
      if (!match.matched) {
        attemptReasons.push({ policyId, reason: match.reason });
        continue;
      }

      const minted = await mintServerAccessToken({
        projectId: tenancy.project.id,
        branchId: tenancy.branchId,
        federation: {
          policyId,
          issuer: validated.issuer,
          subject: validated.subject,
          audience: validated.audience,
        },
        ttlSeconds: policy.tokenTtlSeconds ?? 900,
      });

      runAsynchronously(logEvent([SystemEventTypes.OidcFederationExchange], {
        projectId: tenancy.project.id,
        policyId,
        issuer: validated.issuer,
        subject: validated.subject,
        outcome: "success",
        reason: "",
      }));
      runAsynchronously(writeAudit({
        tenancyId: tenancy.id,
        policyId,
        issuer: validated.issuer,
        subject: validated.subject,
        outcome: "success",
        reason: "",
      }));

      return {
        statusCode: 200,
        bodyType: "json" as const,
        body: {
          access_token: minted.accessToken,
          issued_token_type: ISSUED_TOKEN_TYPE,
          token_type: "Bearer" as const,
          expires_in: minted.ttlSeconds,
        },
      };
    }

    const reasonForPolicy = (policyId: string): string =>
      attemptReasons.find(a => a.policyId === policyId)?.reason ?? "no trust policy matched";
    const failureContext = bestAttempt
      ? { policyId: bestAttempt.policyId, issuer: bestAttempt.issuer, subject: bestAttempt.subject, reason: reasonForPolicy(bestAttempt.policyId) }
      : { policyId: attemptReasons[0]?.policyId ?? "", issuer: "", subject: "", reason: attemptReasons[0]?.reason ?? "no trust policy matched" };

    runAsynchronously(logEvent([SystemEventTypes.OidcFederationExchange], {
      projectId: tenancy.project.id,
      policyId: failureContext.policyId,
      issuer: failureContext.issuer,
      subject: failureContext.subject,
      outcome: "failure",
      reason: failureContext.reason,
    }));
    runAsynchronously(writeAudit({
      tenancyId: tenancy.id,
      policyId: failureContext.policyId,
      issuer: failureContext.issuer,
      subject: failureContext.subject,
      outcome: "failure",
      reason: failureContext.reason,
    }));
    throw new StatusError(400, `invalid_request: ${failureContext.reason}`);
  },
});
