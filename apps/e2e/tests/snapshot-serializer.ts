import { isApiKey, parseProjectApiKey } from "@stackframe/stack-shared/dist/utils/api-keys";
import { typedIncludes } from "@stackframe/stack-shared/dist/utils/arrays";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { nicify } from "@stackframe/stack-shared/dist/utils/strings";
import { SnapshotSerializer } from "vitest";

const hideHeaders = [
  "access-control-allow-headers",
  "access-control-allow-methods",
  "access-control-allow-origin",
  "access-control-expose-headers",
  "access-control-max-age",
  "cache-control",
  "connection",
  "content-security-policy",
  "content-type",
  "content-length",
  "cross-origin-opener-policy",
  "date",
  "keep-alive",
  "permissions-policy",
  "referrer-policy",
  "transfer-encoding",
  "vary",
  "x-content-type-options",
  "x-frame-options",
  "content-encoding",
  "etag",
  "x-stack-request-id",
  "x-middleware-rewrite",
] as const;

const stripHeaders = [] as const;

const stripFields = [
  "access_token",
  "refresh_token",
  "refreshTokenId",
  "date",
  "last_active_at_millis",
  "signed_up_at_millis",
  "expires_at_millis",
  "created_at_millis",
  "sent_at_millis",
  "updated_at_millis",
  "manually_revoked_at_millis",
  "last_four",
  "attempt_code",
  "nonce",
  "authorization_code",
  "secret",
  "token",
  "createdAt",
  "updatedAt",
  "response",
  "msgId",
  "endpointId",
  "timestamp",
  "responseStatusCode",
  "responseDurationMs",
  "iterator",
  "prevIterator",
  "nextAttempt",
  "lastFour",
] as const;

const stripFieldsIfString = [
  "secret_api_key",
  "publishable_client_key",
  "secret_server_key",
  "super_secret_admin_key",
] as const;

const stripCookies = [
  "_interaction",
  "_interaction.sig",
  "_interaction_resume",
  "_interaction_resume.sig",
  "_session",
  "_session.sig",
  "_session.legacy",
  "_session.legacy.sig",
] as const;

const stripUrlQueryParams = [
  "redirect_uri",
  "state",
  "code",
  "code_challenge",
  "interaction_uid",
] as const;

const keyedCookieNamePrefixes = [
  "stack-oauth-inner-",
] as const;

const stringRegexReplacements = [
  [/(\/integrations\/neon\/oauth\/idp\/(interaction|auth)\/)[a-zA-Z0-9_-]+/gi, "$1<stripped $2 UID>"],
] as const;

function addAll<T>(set: Set<T>, values: readonly T[]) {
  for (const value of values) {
    set.add(value);
  }
}

const snapshotSerializer: SnapshotSerializer = {
  serialize(val, config, indentation, depth, refs, printer) {
    return nicify(val, {
      currentIndent: indentation,
      maxDepth: config.maxDepth - depth,
      refs: new Map(refs.map((ref, i) => [ref, `vitestRef[${i}]`])),
      lineIndent: config.indent,
      multiline: true,
      path: "snapshot",
      overrides: (value, options) => {
        const parentValue = options?.parent?.value;

        // Strip all string regex replacements
        if (typeof value === "string") {
          for (const [regex, replacement] of stringRegexReplacements) {
            const newValue: string = value.replace(regex, replacement);
            if (newValue !== value) return nicify(newValue, options);
          }
        }

        // Strip all API keys
        if (typeof value === "string" && isApiKey(value)) {
          const apiKey = parseProjectApiKey(value);
          return `${apiKey.prefix}_<stripped ${apiKey.isPublic ? "public " : ""}${apiKey.type} API key>`;
        }

        // Strip all UUIDs except all-zero UUID
        if (typeof value === "string") {
          const newValue = value.replace(
            /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}/gi,
            "<stripped UUID>"
          );
          if (newValue !== value) return nicify(newValue, options);
        }
        // match something like "Your code is 34JXKG" and replace it with "Your code is <stripped code>"
        if (typeof value === "string") {
          const newValue = value.replace(
            /Your code is [0-9A-Z]{6}/gi,
            "Your code is <stripped code>"
          );
          if (newValue !== value) return nicify(newValue, options);
        }

        // strip svix message id with the format msg_2ssgKCpeddVpe8ZpqB8Zl0rmXyD
        if (typeof value === "string") {
          const newValue = value.replace(/msg_[0-9a-zA-Z]{27}/gi, "<stripped svix message id>");
          if (newValue !== value) return nicify(newValue, options);
        }

        // Strip URL query params
        const urlRegexHeuristic = /(?:(?:https?|ftp|file):\/\/|www\.|ftp\.)(?:\([-A-Z0-9+&@#\/%=~_|$?!:,.]*\)|[-A-Z0-9+&@#\/%=~_|$?!:,.])*(?:\([-A-Z0-9+&@#\/%=~_|$?!:,.]*\)|[A-Z0-9+&@#\/%=~_|$])/igm;
        if (typeof value === "string") {
          for (const urlMatch of value.matchAll(urlRegexHeuristic)) {
            const questionMarkIndex = urlMatch[0].indexOf("?");
            if (questionMarkIndex >= 0) {
              const searchParamsObj = new URLSearchParams(urlMatch[0].slice(questionMarkIndex + 1));
              for (const param of stripUrlQueryParams) {
                if (searchParamsObj.has(param)) {
                  searchParamsObj.set(param, "<stripped query param>");
                }
              }
              let newValue = `${urlMatch[0].slice(0, questionMarkIndex)}?${searchParamsObj.toString()}`;
              if (urlMatch[0].endsWith("/") !== newValue.endsWith("/")) {
                if (urlMatch[0].endsWith("/")) {
                  newValue += "/";
                } else {
                  newValue = newValue.slice(0, -1);
                }
              }
              if (newValue !== value) return nicify(newValue, options);
            }
          }
        }

        // Strip headers
        if (options?.parent?.value instanceof Headers) {
          if (typeof value !== "string") {
            throw new StackAssertionError("Headers should only contain string values");
          }
          const headerName = options.keyInParent?.toString().toLowerCase();
          if (typedIncludes(stripHeaders, headerName)) {
            return `<stripped header '${headerName}'>`;
          }
          if (headerName === "set-cookie") {
            const partsStrings = value.split(";").map((part) => part.trim());
            let cookieName = partsStrings[0].split("=")[0];
            if (keyedCookieNamePrefixes.some((prefix) => cookieName.startsWith(prefix))) {
              cookieName = `${keyedCookieNamePrefixes}<stripped cookie name key>`;
            }
            const cookieValue = partsStrings[0].split("=")[1];
            const parts = new Map(partsStrings.map((part) => {
              const [key, value] = part.split("=");
              return [key, value];
            }));
            const expiresDate = new Date(parts.get("Expires") ?? "2002-01-01");
            if (expiresDate.getTime() < new Date("2001-01-01").getTime()) {
              return `<deleting cookie '${cookieName}' at path '${parts.get("Path") ?? "/"}'>`;
            } else {
              return `<setting cookie ${JSON.stringify(cookieName)} at path ${JSON.stringify(parts.get("path") ?? "/")} to ${typedIncludes(stripCookies, cookieName) ? "<stripped cookie value>" : JSON.stringify(cookieValue)}>`;
            }
          }
        }

        // Hide fields
        const oldHideFields = options?.hideFields ?? [];
        let newHideFields = new Set<PropertyKey>(oldHideFields);
        if (
          (typeof value === "object" || typeof value === "function")
          && value
          && "getSnapshotSerializerOptions" in value
        ) {
          const snapshotSerializerOptions = (value.getSnapshotSerializerOptions as any)();
          addAll(newHideFields, snapshotSerializerOptions?.hideFields ?? []);
        }
        if (value instanceof Headers) {
          addAll(newHideFields, hideHeaders);
        }
        if (newHideFields.size !== oldHideFields.length) {
          return nicify(value, {
            ...options,
            hideFields: [...newHideFields],
          });
        }

        // Strip fields
        if (
          (typeof parentValue === "object" || typeof parentValue === "function")
          && parentValue
          && options.keyInParent
          && "getSnapshotSerializerOptions" in parentValue
        ) {
          const parentSnapshotSerializerOptions = (parentValue.getSnapshotSerializerOptions as any)();
          if (parentSnapshotSerializerOptions?.stripFields?.includes(options.keyInParent)) {
            return `<stripped field '${options.keyInParent.toString()}'>`;
          }
        }
        const allStripFields = [...stripFields, ...typeof value === "string" ? stripFieldsIfString : []];
        if (typedIncludes(allStripFields, options?.keyInParent)) {
          return `<stripped field '${options.keyInParent}'>`;
        }

        // Otherwise, use default serialization
        return null;
      },
    });
  },
  test(val) {
    return true;
  },
};
export default snapshotSerializer;
