import { SmartResponse } from "@/route-handlers/smart-response";
import { Response as OAuthResponse } from "@node-oauth/oauth2-server";
import { StackAssertionError, StatusError, throwErr } from "@stackframe/stack-shared/utils/errors";

export function oauthResponseToSmartResponse(oauthResponse: OAuthResponse): SmartResponse {
  if (!oauthResponse.status) {
    throw new StackAssertionError(`OAuth response status is missing`, { oauthResponse });
  } else if (oauthResponse.status >= 500 && oauthResponse.status < 600) {
    throw new StackAssertionError(`OAuth server error: ${JSON.stringify(oauthResponse.body)}`, { oauthResponse });
  } else if (oauthResponse.status >= 200 && oauthResponse.status < 500) {
    return {
      statusCode: {
        // our API never returns 301 or 302 by convention, so transform them to 307 or 308
        301: 308,
        302: 307,
      }[oauthResponse.status] ?? oauthResponse.status,
      bodyType: "json",
      body: oauthResponse.body,
      headers: Object.fromEntries(Object.entries(oauthResponse.headers || {}).map(([k, v]) => ([k, [v]]))),
    };
  } else {
    throw new StackAssertionError(`Invalid OAuth response status code: ${oauthResponse.status}`, { oauthResponse });
  }
}

export abstract class OAuthResponseError extends StatusError {
  public name = "OAuthResponseError";

  constructor(
    public readonly oauthResponse: OAuthResponse
  ) {
    super(
      oauthResponse.status ?? throwErr(`OAuth response status is missing`),
      JSON.stringify(oauthResponse.body),
    );
  }

  public override getBody(): Uint8Array {
    return new TextEncoder().encode(JSON.stringify(this.oauthResponse.body, undefined, 2));
  }

  public override getHeaders(): Record<string, string[]> {
    return {
      "Content-Type": ["application/json; charset=utf-8"],
      ...Object.fromEntries(Object.entries(this.oauthResponse.headers || {}).map(([k, v]) => ([k, [v]]))),
    };
  }
}
