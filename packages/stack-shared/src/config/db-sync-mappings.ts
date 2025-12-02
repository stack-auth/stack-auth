export const DEFAULT_DB_SYNC_MAPPINGS = {
  "users": {
    sourceTables: { "ProjectUser": "ProjectUser" },
    targetTable: "users",
    targetTableSchemas: {
      postgres: `
        CREATE TABLE IF NOT EXISTS "users" (
          "id" uuid PRIMARY KEY NOT NULL,
          "display_name" text,
          "profile_image_url" text,
          "primary_email" text,
          "primary_email_verified" boolean NOT NULL DEFAULT false,
          "signed_up_at" timestamp without time zone NOT NULL,
          "client_metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
          "client_read_only_metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
          "server_metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
          "is_anonymous" boolean NOT NULL DEFAULT false
        );
        REVOKE ALL ON "users" FROM PUBLIC;
        GRANT SELECT ON "users" TO PUBLIC;

        CREATE TABLE IF NOT EXISTS "_stack_sync_metadata" (
          "mapping_name" text PRIMARY KEY NOT NULL,
          "last_synced_sequence_id" bigint NOT NULL DEFAULT -1,
          "updated_at" timestamp without time zone NOT NULL DEFAULT now()
        );
      `.trim(),
    },
    internalDbFetchQuery: `
      SELECT *
      FROM (
        SELECT
          "ProjectUser"."projectUserId" AS "id",
          "ProjectUser"."displayName" AS "display_name",
          "ProjectUser"."profileImageUrl" AS "profile_image_url",
          (
            SELECT "ContactChannel"."value"
            FROM "ContactChannel"
            WHERE "ContactChannel"."projectUserId" = "ProjectUser"."projectUserId"
              AND "ContactChannel"."tenancyId" = "ProjectUser"."tenancyId"
              AND "ContactChannel"."type" = 'EMAIL'
              AND "ContactChannel"."isPrimary" = 'TRUE'
            LIMIT 1
          ) AS "primary_email",
          COALESCE(
            (
              SELECT "ContactChannel"."isVerified"
              FROM "ContactChannel"
              WHERE "ContactChannel"."projectUserId" = "ProjectUser"."projectUserId"
                AND "ContactChannel"."tenancyId" = "ProjectUser"."tenancyId"
                AND "ContactChannel"."type" = 'EMAIL'
                AND "ContactChannel"."isPrimary" = 'TRUE'
              LIMIT 1
            ),
            false
          ) AS "primary_email_verified",
          "ProjectUser"."createdAt" AS "signed_up_at",
          COALESCE("ProjectUser"."clientMetadata", '{}'::jsonb) AS "client_metadata",
          COALESCE("ProjectUser"."clientReadOnlyMetadata", '{}'::jsonb) AS "client_read_only_metadata",
          COALESCE("ProjectUser"."serverMetadata", '{}'::jsonb) AS "server_metadata",
          "ProjectUser"."isAnonymous" AS "is_anonymous",
          "ProjectUser"."sequenceId" AS "sequence_id",
          "ProjectUser"."tenancyId",
          false AS "is_deleted"
        FROM "ProjectUser"
        WHERE "ProjectUser"."tenancyId" = $1::uuid

        UNION ALL

        SELECT
          ("DeletedRow"."primaryKey"->>'projectUserId')::uuid AS "id",
          NULL::text AS "display_name",
          NULL::text AS "profile_image_url",
          NULL::text AS "primary_email",
          false AS "primary_email_verified",
          "DeletedRow"."deletedAt"::timestamp without time zone AS "signed_up_at",
          '{}'::jsonb AS "client_metadata",
          '{}'::jsonb AS "client_read_only_metadata",
          '{}'::jsonb AS "server_metadata",
          false AS "is_anonymous",
          "DeletedRow"."sequenceId" AS "sequence_id",
          "DeletedRow"."tenancyId",
          true AS "is_deleted"
        FROM "DeletedRow"
        WHERE
          "DeletedRow"."tenancyId" = $1::uuid
          AND "DeletedRow"."tableName" = 'ProjectUser'
      ) AS "_src"
      WHERE "sequence_id" IS NOT NULL
        AND "sequence_id" > $2::bigint
      ORDER BY "sequence_id" ASC
      LIMIT 1000
    `.trim(),
    // Last parameter = mapping_name (for metadata tracking)
    externalDbUpdateQueries: {
      postgres: `
        WITH params AS (
          SELECT
            $1::uuid AS "id",
            $2::text AS "display_name",
            $3::text AS "profile_image_url",
            $4::text AS "primary_email",
            $5::boolean AS "primary_email_verified",
            $6::timestamp without time zone AS "signed_up_at",
            $7::jsonb AS "client_metadata",
            $8::jsonb AS "client_read_only_metadata",
            $9::jsonb AS "server_metadata",
            $10::boolean AS "is_anonymous",
            $11::bigint AS "sequence_id",
            $12::boolean AS "is_deleted",
            $13::text AS "mapping_name"
        ),
        deleted AS (
          DELETE FROM "users" u
          USING params p
          WHERE p."is_deleted" = true AND u."id" = p."id"
          RETURNING 1
        ),
        upserted AS (
          INSERT INTO "users" (
            "id",
            "display_name",
            "profile_image_url",
            "primary_email",
            "primary_email_verified",
            "signed_up_at",
            "client_metadata",
            "client_read_only_metadata",
            "server_metadata",
            "is_anonymous"
          )
          SELECT
            p."id",
            p."display_name",
            p."profile_image_url",
            p."primary_email",
            p."primary_email_verified",
            p."signed_up_at",
            p."client_metadata",
            p."client_read_only_metadata",
            p."server_metadata",
            p."is_anonymous"
          FROM params p
          WHERE p."is_deleted" = false
          ON CONFLICT ("id") DO UPDATE SET
            "display_name" = EXCLUDED."display_name",
            "profile_image_url" = EXCLUDED."profile_image_url",
            "primary_email" = EXCLUDED."primary_email",
            "primary_email_verified" = EXCLUDED."primary_email_verified",
            "signed_up_at" = EXCLUDED."signed_up_at",
            "client_metadata" = EXCLUDED."client_metadata",
            "client_read_only_metadata" = EXCLUDED."client_read_only_metadata",
            "server_metadata" = EXCLUDED."server_metadata",
            "is_anonymous" = EXCLUDED."is_anonymous"
          RETURNING 1
        )
        INSERT INTO "_stack_sync_metadata" ("mapping_name", "last_synced_sequence_id", "updated_at")
        SELECT p."mapping_name", p."sequence_id", now() FROM params p
        ON CONFLICT ("mapping_name") DO UPDATE SET
          "last_synced_sequence_id" = GREATEST("_stack_sync_metadata"."last_synced_sequence_id", EXCLUDED."last_synced_sequence_id"),
          "updated_at" = now();
      `.trim(),
    },
  },
} as const;
