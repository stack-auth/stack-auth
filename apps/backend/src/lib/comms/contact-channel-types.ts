import { ContactChannelType } from "@/generated/prisma/client";
import {
  contactChannelTypeValues,
  contactChannelWriteSchema,
  type ContactChannelTypeValue,
  type ContactChannelWrite,
  type PushEnvironment,
  type PushProvider,
} from "@hexclave/shared/dist/interface/comms";
import { HexclaveAssertionError, StatusError, throwErr } from "@hexclave/shared/dist/utils/errors";
import { normalizeEmail } from "../emails";

export type ContactChannelPrismaType = (typeof ContactChannelType)[keyof typeof ContactChannelType];

export type NormalizedContactChannel = {
  type: ContactChannelTypeValue,
  prismaType: ContactChannelPrismaType,
  value: string,
  identityScope: string,
  data: Map<string, unknown> | null,
};

const apiTypeToPrisma = new Map<ContactChannelTypeValue, ContactChannelPrismaType>([
  ["email", ContactChannelType.EMAIL],
  ["phone", ContactChannelType.PHONE],
  ["discord", ContactChannelType.DISCORD],
  ["slack", ContactChannelType.SLACK],
  ["push", ContactChannelType.PUSH],
]);

const prismaTypeToApi = new Map<ContactChannelPrismaType, ContactChannelTypeValue>([
  [ContactChannelType.EMAIL, "email"],
  [ContactChannelType.PHONE, "phone"],
  [ContactChannelType.DISCORD, "discord"],
  [ContactChannelType.SLACK, "slack"],
  [ContactChannelType.PUSH, "push"],
]);

export function contactChannelTypeToApi(type: ContactChannelPrismaType): ContactChannelTypeValue {
  return prismaTypeToApi.get(type) ?? throwErr(`Unknown ContactChannelType Prisma value: ${type}`);
}

export function contactChannelTypeToPrisma(type: ContactChannelTypeValue): ContactChannelPrismaType {
  return apiTypeToPrisma.get(type) ?? throwErr(`Unknown ContactChannelType API value: ${type}`);
}

export function isContactChannelTypeValue(value: string): value is ContactChannelTypeValue {
  switch (value) {
    case "email":
    case "phone":
    case "discord":
    case "slack":
    case "push": {
      return true;
    }
    default: {
      return false;
    }
  }
}

function mapFromRecord(record: Record<string, unknown> | null | undefined): Map<string, unknown> | null {
  if (record == null) return null;
  return new Map(Object.entries(record));
}

function recordFromMap(map: Map<string, unknown> | null): Record<string, unknown> | null {
  if (map == null) return null;
  return Object.fromEntries(map.entries());
}

function normalizePhoneValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "") {
    throw new StatusError(StatusError.BadRequest, "Phone number must not be empty.");
  }
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) {
    throw new StatusError(StatusError.BadRequest, "Phone number must contain between 7 and 15 digits.");
  }
  return hasPlus || digits.length > 10 ? `+${digits}` : digits;
}

function formatPhoneDisplayValue(value: string, extension: string | null): string {
  const base = value.startsWith("+") && value.length > 5
    ? value.replace(/^\+(\d{1,3})(\d+)$/, (_, country: string, rest: string) => `+${country} ${rest}`)
    : value;
  return extension == null || extension === "" ? base : `${base} ext. ${extension}`;
}

function pushIdentityScope(provider: PushProvider, appId: string, environment: PushEnvironment): string {
  return `${provider}:${appId}:${environment}`;
}

function parsePushIdentityScope(identityScope: string): {
  provider: PushProvider,
  appId: string,
  environment: PushEnvironment,
} {
  const parts = identityScope.split(":");
  if (parts.length !== 3) {
    throw new HexclaveAssertionError("Invalid push identityScope; expected provider:appId:environment", { identityScope });
  }
  const [provider, appId, environment] = parts;
  if (provider !== "apns" && provider !== "fcm") {
    throw new HexclaveAssertionError("Invalid push provider in identityScope", { identityScope, provider });
  }
  if (environment !== "development" && environment !== "production") {
    throw new HexclaveAssertionError("Invalid push environment in identityScope", { identityScope, environment });
  }
  if (appId === "") {
    throw new HexclaveAssertionError("Push identityScope appId must not be empty", { identityScope });
  }
  return { provider, appId, environment };
}

/**
 * Per-type normalization: produces the canonical value, identity scope, and
 * type-specific data blob stored on ContactChannel.
 *
 * identityScope is "" for email/discord/phone; workspaceId for slack;
 * `provider:appId:environment` for push.
 */
export function normalizeContactChannel(
  type: ContactChannelTypeValue,
  value: string,
  data?: Record<string, unknown> | null,
): NormalizedContactChannel {
  const dataMap = mapFromRecord(data);

  switch (type) {
    case "email": {
      return {
        type,
        prismaType: ContactChannelType.EMAIL,
        value: normalizeEmail(value),
        identityScope: "",
        data: null,
      };
    }
    case "phone": {
      const extensionRaw = dataMap?.get("extension");
      const extension = extensionRaw == null ? null : String(extensionRaw);
      return {
        type,
        prismaType: ContactChannelType.PHONE,
        value: normalizePhoneValue(value),
        identityScope: "",
        data: extension == null ? null : new Map([["extension", extension]]),
      };
    }
    case "discord": {
      const trimmed = value.trim();
      if (trimmed === "") {
        throw new StatusError(StatusError.BadRequest, "Discord user id must not be empty.");
      }
      return {
        type,
        prismaType: ContactChannelType.DISCORD,
        value: trimmed,
        identityScope: "",
        data: null,
      };
    }
    case "slack": {
      const workspaceIdRaw = dataMap?.get("workspaceId") ?? dataMap?.get("workspace_id");
      if (typeof workspaceIdRaw !== "string" || workspaceIdRaw.trim() === "") {
        throw new StatusError(StatusError.BadRequest, "Slack channels require workspace_id.");
      }
      const workspaceId = workspaceIdRaw.trim();
      const trimmed = value.trim();
      if (trimmed === "") {
        throw new StatusError(StatusError.BadRequest, "Slack user id must not be empty.");
      }
      return {
        type,
        prismaType: ContactChannelType.SLACK,
        value: trimmed,
        identityScope: workspaceId,
        data: new Map([["workspaceId", workspaceId]]),
      };
    }
    case "push": {
      const providerRaw = dataMap?.get("provider");
      const appIdRaw = dataMap?.get("appId") ?? dataMap?.get("app_id");
      const environmentRaw = dataMap?.get("environment");
      if (providerRaw !== "apns" && providerRaw !== "fcm") {
        throw new StatusError(StatusError.BadRequest, "Push channels require provider apns|fcm.");
      }
      if (typeof appIdRaw !== "string" || appIdRaw.trim() === "") {
        throw new StatusError(StatusError.BadRequest, "Push channels require app_id.");
      }
      if (environmentRaw !== "development" && environmentRaw !== "production") {
        throw new StatusError(StatusError.BadRequest, "Push channels require environment development|production.");
      }
      const trimmed = value.trim();
      if (trimmed === "") {
        throw new StatusError(StatusError.BadRequest, "Push token must not be empty.");
      }
      const provider = providerRaw;
      const appId = appIdRaw.trim();
      const environment = environmentRaw;
      return {
        type,
        prismaType: ContactChannelType.PUSH,
        value: trimmed,
        identityScope: pushIdentityScope(provider, appId, environment),
        data: new Map([
          ["provider", provider],
          ["appId", appId],
          ["environment", environment],
        ]),
      };
    }
    default: {
      throw new HexclaveAssertionError(`Unhandled contact channel type: ${type satisfies never}`);
    }
  }
}

export function normalizeContactChannelWrite(input: ContactChannelWrite): NormalizedContactChannel {
  switch (input.type) {
    case "email": {
      return normalizeContactChannel("email", input.value);
    }
    case "phone": {
      return normalizeContactChannel("phone", input.value, { extension: input.extension ?? null });
    }
    case "discord": {
      return normalizeContactChannel("discord", input.value);
    }
    case "slack": {
      return normalizeContactChannel("slack", input.value, { workspaceId: input.workspace_id });
    }
    case "push": {
      return normalizeContactChannel("push", input.value, {
        provider: input.provider,
        appId: input.app_id,
        environment: input.environment,
      });
    }
    default: {
      throw new HexclaveAssertionError(`Unhandled contact channel write type: ${input satisfies never}`);
    }
  }
}

export function parseContactChannelWrite(input: unknown): ContactChannelWrite {
  return contactChannelWriteSchema.validateSync(input, { strict: true });
}

export function formatDisplayValue(
  type: ContactChannelTypeValue | ContactChannelPrismaType,
  value: string,
  data?: Record<string, unknown> | Map<string, unknown> | null,
): string {
  const apiType = typeof type === "string" && isContactChannelTypeValue(type)
    ? type
    : contactChannelTypeToApi(type);
  const dataMap = data instanceof Map ? data : mapFromRecord(data);

  switch (apiType) {
    case "email":
    case "discord": {
      return value;
    }
    case "phone": {
      const extensionRaw = dataMap?.get("extension");
      const extension = extensionRaw == null ? null : String(extensionRaw);
      return formatPhoneDisplayValue(value, extension);
    }
    case "slack": {
      const workspaceId = dataMap?.get("workspaceId") ?? dataMap?.get("workspace_id");
      return typeof workspaceId === "string" && workspaceId !== ""
        ? `${value} (${workspaceId})`
        : value;
    }
    case "push": {
      const provider = dataMap?.get("provider");
      const environment = dataMap?.get("environment");
      const suffix = typeof provider === "string" && typeof environment === "string"
        ? ` (${provider}/${environment})`
        : "";
      if (value.length <= 12) return `${value}${suffix}`;
      return `${value.slice(0, 6)}…${value.slice(-4)}${suffix}`;
    }
    default: {
      throw new HexclaveAssertionError(`Unhandled contact channel type for display: ${apiType satisfies never}`);
    }
  }
}

export function contactChannelDataToJson(data: Map<string, unknown> | null): Record<string, unknown> | null {
  return recordFromMap(data);
}

export function contactChannelDataFromJson(data: unknown): Map<string, unknown> | null {
  if (data == null) return null;
  if (typeof data !== "object" || Array.isArray(data)) {
    throw new HexclaveAssertionError("ContactChannel.data must be a JSON object or null", { data });
  }
  return new Map(Object.entries(data));
}

/**
 * Rebuilds type-specific API fields from stored identityScope + data.
 * Prefer data when present; fall back to identityScope for slack/push.
 */
export function typeSpecificFieldsFromStored(options: {
  type: ContactChannelPrismaType,
  identityScope: string,
  data: unknown,
}): Record<string, unknown> {
  const apiType = contactChannelTypeToApi(options.type);
  const dataMap = contactChannelDataFromJson(options.data);

  switch (apiType) {
    case "email":
    case "discord": {
      return {};
    }
    case "phone": {
      const extensionRaw = dataMap?.get("extension");
      return { extension: extensionRaw == null ? null : String(extensionRaw) };
    }
    case "slack": {
      const fromData = dataMap?.get("workspaceId") ?? dataMap?.get("workspace_id");
      const workspaceId = typeof fromData === "string" && fromData !== ""
        ? fromData
        : options.identityScope;
      if (workspaceId === "") {
        throw new HexclaveAssertionError("Slack ContactChannel is missing workspace identity", options);
      }
      return { workspace_id: workspaceId };
    }
    case "push": {
      const providerFromData = dataMap?.get("provider");
      const appIdFromData = dataMap?.get("appId") ?? dataMap?.get("app_id");
      const environmentFromData = dataMap?.get("environment");
      if (
        (providerFromData === "apns" || providerFromData === "fcm")
        && typeof appIdFromData === "string"
        && (environmentFromData === "development" || environmentFromData === "production")
      ) {
        return {
          provider: providerFromData,
          app_id: appIdFromData,
          environment: environmentFromData,
        };
      }
      const parsed = parsePushIdentityScope(options.identityScope);
      return {
        provider: parsed.provider,
        app_id: parsed.appId,
        environment: parsed.environment,
      };
    }
    default: {
      throw new HexclaveAssertionError(`Unhandled contact channel type: ${apiType satisfies never}`);
    }
  }
}
