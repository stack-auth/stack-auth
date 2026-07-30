import { type Tenancy } from "@/lib/tenancies";
import { getPrismaClientForTenancy, getPrismaSchemaForTenancy, sqlQuoteIdent } from "@/prisma-client";
import { type Prisma } from "@/generated/prisma/client";
import {
  getTvBuiltInProfile,
  TvProfileConfigurationSchema,
  TvProfilePlaylistSchema,
  TvInterruptionPreferencesSchema,
  type TvInterruptionPreferences,
  type TvProfileConfiguration,
  type TvBuiltInProfileResource,
  type TvProfileResource,
  type TvSavedProfileResource,
} from "@hexclave/shared/dist/interface/admin-tv-mode";
import { yupBoolean, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { generateUuid } from "@hexclave/shared/dist/utils/uuids";

type TvProfileDatabaseRow = Prisma.TvPresentationProfileGetPayload<{}>;

export class TvProfileVersionConflictError extends Error {
  override name = "TvProfileVersionConflictError";
}

export class TvProfileNameConflictError extends Error {
  override name = "TvProfileNameConflictError";
}

export class TvBuiltInProfileMutationError extends Error {
  override name = "TvBuiltInProfileMutationError";
}

export function normalizeTvProfileName(displayName: string): string {
  return displayName.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

const LegacyTvInterruptionPreferencesSchema = yupObject({
  incidentLevels: yupObject({
    critical: yupString().oneOf(["persistent-takeover", "disabled"]).defined(),
    high: yupString().oneOf(["temporary-takeover", "banner", "disabled"]).defined(),
    medium: yupString().oneOf(["banner", "disabled"]).defined(),
  }).noUnknown().defined(),
  incidentTypes: yupObject({
    emailDeliveryDegradation: yupBoolean().defined(),
  }).noUnknown().defined(),
  celebrations: yupObject({
    userMilestone: yupBoolean().defined(),
    revenueMilestone: yupBoolean().defined(),
  }).noUnknown().defined(),
}).noUnknown().defined();

export async function normalizeTvInterruptionPreferences(
  input: unknown,
): Promise<TvInterruptionPreferences> {
  if (await TvInterruptionPreferencesSchema.isValid(input, { strict: true })) {
    return await TvInterruptionPreferencesSchema.validate(input, { strict: true });
  }
  const legacy = await LegacyTvInterruptionPreferencesSchema.validate(input, { strict: true });
  const anyIncidentLevelEnabled = Object.values(legacy.incidentLevels).some((level) => level !== "disabled");
  return {
    incidentTypes: {
      emailDeliveryDegradation: legacy.incidentTypes.emailDeliveryDegradation && anyIncidentLevelEnabled,
    },
    celebrations: legacy.celebrations,
    timing: {
      celebration: { takeoverSeconds: 60, animationSeconds: 3600, highlightSeconds: 21600 },
      incident: { takeoverSeconds: 60, resolvedHighlightSeconds: 3600 },
      criticalIncident: { resolvedHighlightSeconds: 21600 },
    },
  };
}

async function validateConfiguration(configuration: TvProfileConfiguration): Promise<TvProfileConfiguration> {
  return await TvProfileConfigurationSchema.validate(configuration, { strict: true });
}

async function rowToResource(row: TvProfileDatabaseRow): Promise<TvSavedProfileResource> {
  const configuration = await validateConfiguration({
    displayName: row.displayName,
    description: row.description,
    mode: "general",
    defaultDurationSeconds: row.defaultDurationSeconds,
    playlist: await TvProfilePlaylistSchema.validate(row.playlist, { strict: true }),
    interruptionPreferences: await normalizeTvInterruptionPreferences(row.interruptionPreferences),
    financialVisibility: row.financialVisibility === "EXACT" ? "exact" : "redacted",
  });
  return {
    id: row.id,
    origin: "saved",
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    configuration,
  };
}

async function profileTableIsReady(tenancy: Tenancy): Promise<boolean> {
  const schema = await getPrismaSchemaForTenancy(tenancy);
  const prisma = await getPrismaClientForTenancy(tenancy);
  // Migration readiness gates authoritative configuration writes, so checking a
  // replica here could incorrectly report that an already-migrated primary is unavailable.
  const rows = await prisma.$queryRaw<Array<{ relation_name: string | null }>>`
    SELECT to_regclass(${`${schema}."TvPresentationProfile"`})::text AS relation_name
  `;
  return rows.at(0)?.relation_name != null;
}

async function querySavedProfileRows(tenancy: Tenancy, profileId?: string): Promise<TvProfileDatabaseRow[]> {
  if (!(await profileTableIsReady(tenancy))) return [];
  const prisma = await getPrismaClientForTenancy(tenancy);
  if (profileId == null) {
    return await prisma.tvPresentationProfile.findMany({
      where: { tenancyId: tenancy.id },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    });
  }
  const row = await prisma.tvPresentationProfile.findFirst({
    where: {
      tenancyId: tenancy.id,
      id: profileId,
    },
  });
  return row == null ? [] : [row];
}

export async function listTvProfiles(tenancy: Tenancy): Promise<{
  persistenceReady: boolean,
  savedProfiles: TvSavedProfileResource[],
  templates: TvBuiltInProfileResource[],
}> {
  const persistenceReady = await profileTableIsReady(tenancy);
  const rows = persistenceReady ? await querySavedProfileRows(tenancy) : [];
  return {
    persistenceReady,
    savedProfiles: await Promise.all(rows.map(rowToResource)),
    templates: ["company-pulse", "engineering-office"].map((id) => {
      const template = getTvBuiltInProfile(id);
      if (template == null) throw new Error(`Missing TV built-in profile "${id}"`);
      return template;
    }),
  };
}

export async function resolveTvProfile(
  tenancy: Tenancy,
  profileId: string,
): Promise<TvProfileResource | null> {
  const builtIn = getTvBuiltInProfile(profileId);
  if (builtIn != null) return builtIn;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(profileId)) {
    return null;
  }
  const row = (await querySavedProfileRows(tenancy, profileId)).at(0);
  return row == null ? null : await rowToResource(row);
}

export async function createTvProfile(
  tenancy: Tenancy,
  configurationInput: TvProfileConfiguration,
): Promise<TvSavedProfileResource | null> {
  if (!(await profileTableIsReady(tenancy))) return null;
  const configuration = await validateConfiguration(configurationInput);
  const schema = await getPrismaSchemaForTenancy(tenancy);
  const prisma = await getPrismaClientForTenancy(tenancy);
  const id = generateUuid();
  const rows = await prisma.$queryRaw<TvProfileDatabaseRow[]>`
    INSERT INTO ${sqlQuoteIdent(schema)}."TvPresentationProfile" (
      "id", "tenancyId", "displayName", "normalizedDisplayName", "description", "mode",
      "defaultDurationSeconds", "playlist", "interruptionPreferences", "financialVisibility", "updatedAt"
    )
    VALUES (
      ${id}::UUID, ${tenancy.id}::UUID, ${configuration.displayName},
      ${normalizeTvProfileName(configuration.displayName)}, ${configuration.description}, 'GENERAL'::${sqlQuoteIdent(schema)}."TvPresentationMode",
      ${configuration.defaultDurationSeconds}, ${JSON.stringify(configuration.playlist)}::JSONB,
      ${JSON.stringify(configuration.interruptionPreferences)}::JSONB,
      ${configuration.financialVisibility === "exact" ? "EXACT" : "REDACTED"}::${sqlQuoteIdent(schema)}."TvFinancialVisibility",
      CURRENT_TIMESTAMP
    )
    ON CONFLICT ("tenancyId", "normalizedDisplayName") DO NOTHING
    RETURNING "id", "displayName", "description", "mode", "defaultDurationSeconds",
      "playlist", "interruptionPreferences", "financialVisibility", "version", "createdAt", "updatedAt"
  `;
  const row = rows.at(0);
  if (row == null) throw new TvProfileNameConflictError();
  return await rowToResource(row);
}

export async function updateTvProfile(
  tenancy: Tenancy,
  profileId: string,
  expectedVersion: number,
  configurationInput: TvProfileConfiguration,
): Promise<TvSavedProfileResource | null> {
  if (getTvBuiltInProfile(profileId) != null) throw new TvBuiltInProfileMutationError();
  if (!(await profileTableIsReady(tenancy))) return null;
  const configuration = await validateConfiguration(configurationInput);
  const schema = await getPrismaSchemaForTenancy(tenancy);
  const prisma = await getPrismaClientForTenancy(tenancy);
  const rows = await prisma.$queryRaw<TvProfileDatabaseRow[]>`
    UPDATE ${sqlQuoteIdent(schema)}."TvPresentationProfile"
    SET "displayName" = ${configuration.displayName},
      "normalizedDisplayName" = ${normalizeTvProfileName(configuration.displayName)},
      "description" = ${configuration.description},
      "defaultDurationSeconds" = ${configuration.defaultDurationSeconds},
      "playlist" = ${JSON.stringify(configuration.playlist)}::JSONB,
      "interruptionPreferences" = ${JSON.stringify(configuration.interruptionPreferences)}::JSONB,
      "financialVisibility" = ${configuration.financialVisibility === "exact" ? "EXACT" : "REDACTED"}::${sqlQuoteIdent(schema)}."TvFinancialVisibility",
      "version" = "version" + 1,
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE "tenancyId" = ${tenancy.id}::UUID
      AND "id" = ${profileId}::UUID
      AND "version" = ${expectedVersion}
      AND NOT EXISTS (
        SELECT 1
        FROM ${sqlQuoteIdent(schema)}."TvPresentationProfile" AS conflicting_profile
        WHERE conflicting_profile."tenancyId" = ${tenancy.id}::UUID
          AND conflicting_profile."normalizedDisplayName" = ${normalizeTvProfileName(configuration.displayName)}
          AND conflicting_profile."id" <> ${profileId}::UUID
      )
    RETURNING "id", "displayName", "description", "mode", "defaultDurationSeconds",
      "playlist", "interruptionPreferences", "financialVisibility", "version", "createdAt", "updatedAt"
  `;
  const row = rows.at(0);
  if (row != null) return await rowToResource(row);
  const current = (await querySavedProfileRows(tenancy, profileId)).at(0);
  if (current == null) return null;
  if (current.version === expectedVersion) throw new TvProfileNameConflictError();
  throw new TvProfileVersionConflictError();
}

export async function deleteTvProfile(
  tenancy: Tenancy,
  profileId: string,
  expectedVersion: number,
): Promise<boolean | null> {
  if (getTvBuiltInProfile(profileId) != null) throw new TvBuiltInProfileMutationError();
  if (!(await profileTableIsReady(tenancy))) return null;
  const schema = await getPrismaSchemaForTenancy(tenancy);
  const prisma = await getPrismaClientForTenancy(tenancy);
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    DELETE FROM ${sqlQuoteIdent(schema)}."TvPresentationProfile"
    WHERE "tenancyId" = ${tenancy.id}::UUID
      AND "id" = ${profileId}::UUID
      AND "version" = ${expectedVersion}
    RETURNING "id"
  `;
  if (rows.length > 0) return true;
  const current = (await querySavedProfileRows(tenancy, profileId)).at(0);
  if (current == null) return false;
  throw new TvProfileVersionConflictError();
}
