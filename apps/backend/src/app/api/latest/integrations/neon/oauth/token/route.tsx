import { globalPrismaClient } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { neonAuthorizationHeaderSchema, yupMixed, yupNumber, yupObject, yupString, yupTuple, yupUnion } from "@stackframe/stack-shared/dist/schema-fields";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";

export const POST = createSmartRouteHandler({
  metadata: {
    hidden: true,
  },
  request: yupObject({
    url: yupString().defined(),
    body: yupObject({
      grant_type: yupString().oneOf(["authorization_code"]).defined(),
      code: yupString().defined(),
      code_verifier: yupString().defined(),
      redirect_uri: yupString().defined(),
    }).defined(),
    headers: yupObject({
      authorization: yupTuple([neonAuthorizationHeaderSchema.defined()]).defined(),
    }).defined(),
  }),
  response: yupUnion(
    yupObject({
      statusCode: yupNumber().oneOf([200]).defined(),
      bodyType: yupString().oneOf(["json"]).defined(),
      body: yupObject({
        access_token: yupString().defined(),
        token_type: yupString().oneOf(["api_key"]).defined(),
        project_id: yupString().defined(),
      }).defined(),
    }),
    yupObject({
      statusCode: yupNumber().defined(),
      bodyType: yupString().oneOf(["text"]).defined(),
      body: yupMixed<any>().defined(),
    }),
  ),
  handler: async (req) => {
    const tokenResponse = await fetch(new URL("/api/v1/integrations/neon/oauth/idp/token", getEnvVariable("NEXT_PUBLIC_STACK_API_URL")), {
      method: "POST",
      body: new URLSearchParams(req.body).toString(),
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: req.headers.authorization[0],
      },
    });
    if (!tokenResponse.ok) {
      return {
        statusCode: tokenResponse.status,
        bodyType: "text",
        body: await tokenResponse.text(),
      };
    }
    const tokenResponseBody = await tokenResponse.json();

    const userInfoResponse = await fetch(new URL("/api/v1/integrations/neon/oauth/idp/me", getEnvVariable("NEXT_PUBLIC_STACK_API_URL")), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${tokenResponseBody.access_token}`,
      },
    });
    if (!userInfoResponse.ok) {
      const text = await userInfoResponse.text();
      throw new StackAssertionError("Failed to fetch user info? This should never happen", { text, userInfoResponse });
    }
    const userInfoResponseBody = await userInfoResponse.json();

    const accountId = userInfoResponseBody.sub;
    const mapping = await globalPrismaClient.idPAccountToCdfcResultMapping.findUnique({
      where: {
        idpId: "stack-preconfigured-idp:integrations/neon",
        idpAccountId: accountId,
      },
    });
    if (!mapping) {
      throw new StackAssertionError("No mapping found for account", { accountId });
    }

    return {
      statusCode: 200,
      bodyType: "json",
      body: mapping.cdfcResult as any,
    };
  },
});
