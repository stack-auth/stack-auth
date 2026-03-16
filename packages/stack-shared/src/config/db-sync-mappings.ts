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
      clickhouse: `
        CREATE TABLE IF NOT EXISTS analytics_internal.users (
          project_id String,
          branch_id String,
          id UUID,
          display_name Nullable(String),
          profile_image_url Nullable(String),
          primary_email Nullable(String),
          primary_email_verified UInt8,
          signed_up_at DateTime64(3, 'UTC'),
          client_metadata String,
          client_read_only_metadata String,
          server_metadata String,
          is_anonymous UInt8,
          restricted_by_admin UInt8,
          restricted_by_admin_reason Nullable(String),
          restricted_by_admin_private_details Nullable(String),
          sync_sequence_id Int64,
          sync_is_deleted UInt8,
          sync_created_at DateTime64(3, 'UTC') DEFAULT now64(3)
        )
        ENGINE ReplacingMergeTree(sync_sequence_id)
        PARTITION BY toYYYYMM(signed_up_at)
        ORDER BY (project_id, branch_id, id);

        CREATE TABLE IF NOT EXISTS analytics_internal._stack_sync_metadata (
          tenancy_id UUID,
          mapping_name String,
          last_synced_sequence_id Int64,
          updated_at DateTime64(3, 'UTC') DEFAULT now64(3)
        )
        ENGINE ReplacingMergeTree(updated_at)
        ORDER BY (tenancy_id, mapping_name);
      `.trim(),
    },
    internalDbFetchQueries: {
      clickhouse: `
        SELECT *
        FROM (
          SELECT
            "Tenancy"."projectId" AS "project_id",
            "Tenancy"."branchId" AS "branch_id",
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
            "ProjectUser"."restrictedByAdmin" AS "restricted_by_admin",
            "ProjectUser"."restrictedByAdminReason" AS "restricted_by_admin_reason",
            "ProjectUser"."restrictedByAdminPrivateDetails" AS "restricted_by_admin_private_details",
            "ProjectUser"."sequenceId" AS "sync_sequence_id",
            "ProjectUser"."tenancyId" AS "tenancyId",
            false AS "sync_is_deleted"
          FROM "ProjectUser"
          JOIN "Tenancy" ON "Tenancy"."id" = "ProjectUser"."tenancyId"
          WHERE "ProjectUser"."tenancyId" = $1::uuid

          UNION ALL

          SELECT
            "Tenancy"."projectId" AS "project_id",
            "Tenancy"."branchId" AS "branch_id",
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
            false AS "restricted_by_admin",
            NULL::text AS "restricted_by_admin_reason",
            NULL::text AS "restricted_by_admin_private_details",
            "DeletedRow"."sequenceId" AS "sync_sequence_id",
            "DeletedRow"."tenancyId" AS "tenancyId",
            true AS "sync_is_deleted"
          FROM "DeletedRow"
          JOIN "Tenancy" ON "Tenancy"."id" = "DeletedRow"."tenancyId"
          WHERE
            "DeletedRow"."tenancyId" = $1::uuid
            AND "DeletedRow"."tableName" = 'ProjectUser'
        ) AS "_src"
        WHERE "sync_sequence_id" IS NOT NULL
          AND "sync_sequence_id" > $2::bigint
        ORDER BY "sync_sequence_id" ASC
        LIMIT 1000
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
  "contact_channels": {
    sourceTables: { "ContactChannel": "ContactChannel" },
    targetTable: "contact_channels",
    targetTableSchemas: {
      postgres: `
        CREATE TABLE IF NOT EXISTS "contact_channels" (
          "id" uuid PRIMARY KEY NOT NULL,
          "user_id" uuid NOT NULL,
          "type" text NOT NULL,
          "value" text NOT NULL,
          "is_primary" boolean NOT NULL DEFAULT false,
          "is_verified" boolean NOT NULL DEFAULT false,
          "used_for_auth" boolean NOT NULL DEFAULT false,
          "created_at" timestamp without time zone NOT NULL
        );
        REVOKE ALL ON "contact_channels" FROM PUBLIC;
        GRANT SELECT ON "contact_channels" TO PUBLIC;

        CREATE TABLE IF NOT EXISTS "_stack_sync_metadata" (
          "mapping_name" text PRIMARY KEY NOT NULL,
          "last_synced_sequence_id" bigint NOT NULL DEFAULT -1,
          "updated_at" timestamp without time zone NOT NULL DEFAULT now()
        );
      `.trim(),
      clickhouse: `
        CREATE TABLE IF NOT EXISTS analytics_internal.contact_channels (
          project_id String,
          branch_id String,
          id UUID,
          user_id UUID,
          type LowCardinality(String),
          value String,
          is_primary UInt8,
          is_verified UInt8,
          used_for_auth UInt8,
          created_at DateTime64(3, 'UTC'),
          sync_sequence_id Int64,
          sync_is_deleted UInt8,
          sync_created_at DateTime64(3, 'UTC') DEFAULT now64(3)
        )
        ENGINE ReplacingMergeTree(sync_sequence_id)
        PARTITION BY toYYYYMM(created_at)
        ORDER BY (project_id, branch_id, id);
      `.trim(),
    },
    internalDbFetchQueries: {
      clickhouse: `
        SELECT *
        FROM (
          SELECT
            "Tenancy"."projectId" AS "project_id",
            "Tenancy"."branchId" AS "branch_id",
            "ContactChannel"."id" AS "id",
            "ContactChannel"."projectUserId" AS "user_id",
            "ContactChannel"."type"::text AS "type",
            "ContactChannel"."value" AS "value",
            CASE WHEN "ContactChannel"."isPrimary" = 'TRUE' THEN true ELSE false END AS "is_primary",
            "ContactChannel"."isVerified" AS "is_verified",
            CASE WHEN "ContactChannel"."usedForAuth" = 'TRUE' THEN true ELSE false END AS "used_for_auth",
            "ContactChannel"."createdAt" AS "created_at",
            "ContactChannel"."sequenceId" AS "sync_sequence_id",
            "ContactChannel"."tenancyId" AS "tenancyId",
            false AS "sync_is_deleted"
          FROM "ContactChannel"
          JOIN "Tenancy" ON "Tenancy"."id" = "ContactChannel"."tenancyId"
          WHERE "ContactChannel"."tenancyId" = $1::uuid

          UNION ALL

          SELECT
            "Tenancy"."projectId" AS "project_id",
            "Tenancy"."branchId" AS "branch_id",
            ("DeletedRow"."primaryKey"->>'id')::uuid AS "id",
            ("DeletedRow"."primaryKey"->>'projectUserId')::uuid AS "user_id",
            NULL::text AS "type",
            NULL::text AS "value",
            false AS "is_primary",
            false AS "is_verified",
            false AS "used_for_auth",
            "DeletedRow"."deletedAt"::timestamp without time zone AS "created_at",
            "DeletedRow"."sequenceId" AS "sync_sequence_id",
            "DeletedRow"."tenancyId" AS "tenancyId",
            true AS "sync_is_deleted"
          FROM "DeletedRow"
          JOIN "Tenancy" ON "Tenancy"."id" = "DeletedRow"."tenancyId"
          WHERE
            "DeletedRow"."tenancyId" = $1::uuid
            AND "DeletedRow"."tableName" = 'ContactChannel'
        ) AS "_src"
        WHERE "sync_sequence_id" IS NOT NULL
          AND "sync_sequence_id" > $2::bigint
        ORDER BY "sync_sequence_id" ASC
        LIMIT 1000
      `.trim(),
    },
    internalDbFetchQuery: `
      SELECT *
      FROM (
        SELECT
          "ContactChannel"."id" AS "id",
          "ContactChannel"."projectUserId" AS "user_id",
          "ContactChannel"."type"::text AS "type",
          "ContactChannel"."value" AS "value",
          CASE WHEN "ContactChannel"."isPrimary" = 'TRUE' THEN true ELSE false END AS "is_primary",
          "ContactChannel"."isVerified" AS "is_verified",
          CASE WHEN "ContactChannel"."usedForAuth" = 'TRUE' THEN true ELSE false END AS "used_for_auth",
          "ContactChannel"."createdAt" AS "created_at",
          "ContactChannel"."sequenceId" AS "sequence_id",
          "ContactChannel"."tenancyId",
          false AS "is_deleted"
        FROM "ContactChannel"
        WHERE "ContactChannel"."tenancyId" = $1::uuid

        UNION ALL

        SELECT
          ("DeletedRow"."primaryKey"->>'id')::uuid AS "id",
          ("DeletedRow"."primaryKey"->>'projectUserId')::uuid AS "user_id",
          NULL::text AS "type",
          NULL::text AS "value",
          false AS "is_primary",
          false AS "is_verified",
          false AS "used_for_auth",
          "DeletedRow"."deletedAt"::timestamp without time zone AS "created_at",
          "DeletedRow"."sequenceId" AS "sequence_id",
          "DeletedRow"."tenancyId",
          true AS "is_deleted"
        FROM "DeletedRow"
        WHERE
          "DeletedRow"."tenancyId" = $1::uuid
          AND "DeletedRow"."tableName" = 'ContactChannel'
      ) AS "_src"
      WHERE "sequence_id" IS NOT NULL
        AND "sequence_id" > $2::bigint
      ORDER BY "sequence_id" ASC
      LIMIT 1000
    `.trim(),
    externalDbUpdateQueries: {
      postgres: `
        WITH params AS (
          SELECT
            $1::uuid AS "id",
            $2::uuid AS "user_id",
            $3::text AS "type",
            $4::text AS "value",
            $5::boolean AS "is_primary",
            $6::boolean AS "is_verified",
            $7::boolean AS "used_for_auth",
            $8::timestamp without time zone AS "created_at",
            $9::bigint AS "sequence_id",
            $10::boolean AS "is_deleted",
            $11::text AS "mapping_name"
        ),
        deleted AS (
          DELETE FROM "contact_channels" c
          USING params p
          WHERE p."is_deleted" = true AND c."id" = p."id"
          RETURNING 1
        ),
        upserted AS (
          INSERT INTO "contact_channels" (
            "id",
            "user_id",
            "type",
            "value",
            "is_primary",
            "is_verified",
            "used_for_auth",
            "created_at"
          )
          SELECT
            p."id",
            p."user_id",
            p."type",
            p."value",
            p."is_primary",
            p."is_verified",
            p."used_for_auth",
            p."created_at"
          FROM params p
          WHERE p."is_deleted" = false
          ON CONFLICT ("id") DO UPDATE SET
            "user_id" = EXCLUDED."user_id",
            "type" = EXCLUDED."type",
            "value" = EXCLUDED."value",
            "is_primary" = EXCLUDED."is_primary",
            "is_verified" = EXCLUDED."is_verified",
            "used_for_auth" = EXCLUDED."used_for_auth",
            "created_at" = EXCLUDED."created_at"
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
  "teams": {
    sourceTables: { "Team": "Team" },
    targetTable: "teams",
    targetTableSchemas: {
      postgres: `
        CREATE TABLE IF NOT EXISTS "teams" (
          "id" uuid PRIMARY KEY NOT NULL,
          "display_name" text NOT NULL,
          "profile_image_url" text,
          "created_at" timestamp without time zone NOT NULL,
          "client_metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
          "client_read_only_metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
          "server_metadata" jsonb NOT NULL DEFAULT '{}'::jsonb
        );
        REVOKE ALL ON "teams" FROM PUBLIC;
        GRANT SELECT ON "teams" TO PUBLIC;

        CREATE TABLE IF NOT EXISTS "_stack_sync_metadata" (
          "mapping_name" text PRIMARY KEY NOT NULL,
          "last_synced_sequence_id" bigint NOT NULL DEFAULT -1,
          "updated_at" timestamp without time zone NOT NULL DEFAULT now()
        );
      `.trim(),
      clickhouse: `
        CREATE TABLE IF NOT EXISTS analytics_internal.teams (
          project_id String,
          branch_id String,
          id UUID,
          display_name String,
          profile_image_url Nullable(String),
          created_at DateTime64(3, 'UTC'),
          client_metadata String,
          client_read_only_metadata String,
          server_metadata String,
          sync_sequence_id Int64,
          sync_is_deleted UInt8,
          sync_created_at DateTime64(3, 'UTC') DEFAULT now64(3)
        )
        ENGINE ReplacingMergeTree(sync_sequence_id)
        PARTITION BY toYYYYMM(created_at)
        ORDER BY (project_id, branch_id, id);
      `.trim(),
    },
    internalDbFetchQueries: {
      clickhouse: `
        SELECT *
        FROM (
          SELECT
            "Tenancy"."projectId" AS "project_id",
            "Tenancy"."branchId" AS "branch_id",
            "Team"."teamId" AS "id",
            "Team"."displayName" AS "display_name",
            "Team"."profileImageUrl" AS "profile_image_url",
            "Team"."createdAt" AS "created_at",
            COALESCE("Team"."clientMetadata", '{}'::jsonb) AS "client_metadata",
            COALESCE("Team"."clientReadOnlyMetadata", '{}'::jsonb) AS "client_read_only_metadata",
            COALESCE("Team"."serverMetadata", '{}'::jsonb) AS "server_metadata",
            "Team"."sequenceId" AS "sync_sequence_id",
            "Team"."tenancyId" AS "tenancyId",
            false AS "sync_is_deleted"
          FROM "Team"
          JOIN "Tenancy" ON "Tenancy"."id" = "Team"."tenancyId"
          WHERE "Team"."tenancyId" = $1::uuid

          UNION ALL

          SELECT
            "Tenancy"."projectId" AS "project_id",
            "Tenancy"."branchId" AS "branch_id",
            ("DeletedRow"."primaryKey"->>'teamId')::uuid AS "id",
            NULL::text AS "display_name",
            NULL::text AS "profile_image_url",
            "DeletedRow"."deletedAt"::timestamp without time zone AS "created_at",
            '{}'::jsonb AS "client_metadata",
            '{}'::jsonb AS "client_read_only_metadata",
            '{}'::jsonb AS "server_metadata",
            "DeletedRow"."sequenceId" AS "sync_sequence_id",
            "DeletedRow"."tenancyId" AS "tenancyId",
            true AS "sync_is_deleted"
          FROM "DeletedRow"
          JOIN "Tenancy" ON "Tenancy"."id" = "DeletedRow"."tenancyId"
          WHERE
            "DeletedRow"."tenancyId" = $1::uuid
            AND "DeletedRow"."tableName" = 'Team'
        ) AS "_src"
        WHERE "sync_sequence_id" IS NOT NULL
          AND "sync_sequence_id" > $2::bigint
        ORDER BY "sync_sequence_id" ASC
        LIMIT 1000
      `.trim(),
    },
    internalDbFetchQuery: `
      SELECT *
      FROM (
        SELECT
          "Team"."teamId" AS "id",
          "Team"."displayName" AS "display_name",
          "Team"."profileImageUrl" AS "profile_image_url",
          "Team"."createdAt" AS "created_at",
          COALESCE("Team"."clientMetadata", '{}'::jsonb) AS "client_metadata",
          COALESCE("Team"."clientReadOnlyMetadata", '{}'::jsonb) AS "client_read_only_metadata",
          COALESCE("Team"."serverMetadata", '{}'::jsonb) AS "server_metadata",
          "Team"."sequenceId" AS "sequence_id",
          "Team"."tenancyId",
          false AS "is_deleted"
        FROM "Team"
        WHERE "Team"."tenancyId" = $1::uuid

        UNION ALL

        SELECT
          ("DeletedRow"."primaryKey"->>'teamId')::uuid AS "id",
          NULL::text AS "display_name",
          NULL::text AS "profile_image_url",
          "DeletedRow"."deletedAt"::timestamp without time zone AS "created_at",
          '{}'::jsonb AS "client_metadata",
          '{}'::jsonb AS "client_read_only_metadata",
          '{}'::jsonb AS "server_metadata",
          "DeletedRow"."sequenceId" AS "sequence_id",
          "DeletedRow"."tenancyId",
          true AS "is_deleted"
        FROM "DeletedRow"
        WHERE
          "DeletedRow"."tenancyId" = $1::uuid
          AND "DeletedRow"."tableName" = 'Team'
      ) AS "_src"
      WHERE "sequence_id" IS NOT NULL
        AND "sequence_id" > $2::bigint
      ORDER BY "sequence_id" ASC
      LIMIT 1000
    `.trim(),
    externalDbUpdateQueries: {
      postgres: `
        WITH params AS (
          SELECT
            $1::uuid AS "id",
            $2::text AS "display_name",
            $3::text AS "profile_image_url",
            $4::timestamp without time zone AS "created_at",
            $5::jsonb AS "client_metadata",
            $6::jsonb AS "client_read_only_metadata",
            $7::jsonb AS "server_metadata",
            $8::bigint AS "sequence_id",
            $9::boolean AS "is_deleted",
            $10::text AS "mapping_name"
        ),
        deleted AS (
          DELETE FROM "teams" t
          USING params p
          WHERE p."is_deleted" = true AND t."id" = p."id"
          RETURNING 1
        ),
        upserted AS (
          INSERT INTO "teams" (
            "id",
            "display_name",
            "profile_image_url",
            "created_at",
            "client_metadata",
            "client_read_only_metadata",
            "server_metadata"
          )
          SELECT
            p."id",
            p."display_name",
            p."profile_image_url",
            p."created_at",
            p."client_metadata",
            p."client_read_only_metadata",
            p."server_metadata"
          FROM params p
          WHERE p."is_deleted" = false
          ON CONFLICT ("id") DO UPDATE SET
            "display_name" = EXCLUDED."display_name",
            "profile_image_url" = EXCLUDED."profile_image_url",
            "created_at" = EXCLUDED."created_at",
            "client_metadata" = EXCLUDED."client_metadata",
            "client_read_only_metadata" = EXCLUDED."client_read_only_metadata",
            "server_metadata" = EXCLUDED."server_metadata"
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
  "team_members": {
    sourceTables: { "TeamMember": "TeamMember" },
    targetTable: "team_members",
    targetTableSchemas: {
      postgres: `
        CREATE TABLE IF NOT EXISTS "team_members" (
          "team_id" uuid NOT NULL,
          "user_id" uuid NOT NULL,
          "display_name" text,
          "profile_image_url" text,
          "created_at" timestamp without time zone NOT NULL,
          PRIMARY KEY ("team_id", "user_id")
        );
        REVOKE ALL ON "team_members" FROM PUBLIC;
        GRANT SELECT ON "team_members" TO PUBLIC;

        CREATE TABLE IF NOT EXISTS "_stack_sync_metadata" (
          "mapping_name" text PRIMARY KEY NOT NULL,
          "last_synced_sequence_id" bigint NOT NULL DEFAULT -1,
          "updated_at" timestamp without time zone NOT NULL DEFAULT now()
        );
      `.trim(),
      clickhouse: `
        CREATE TABLE IF NOT EXISTS analytics_internal.team_members (
          project_id String,
          branch_id String,
          team_id UUID,
          user_id UUID,
          display_name Nullable(String),
          profile_image_url Nullable(String),
          created_at DateTime64(3, 'UTC'),
          sync_sequence_id Int64,
          sync_is_deleted UInt8,
          sync_created_at DateTime64(3, 'UTC') DEFAULT now64(3)
        )
        ENGINE ReplacingMergeTree(sync_sequence_id)
        PARTITION BY toYYYYMM(created_at)
        ORDER BY (project_id, branch_id, team_id, user_id);
      `.trim(),
    },
    internalDbFetchQueries: {
      clickhouse: `
        SELECT *
        FROM (
          SELECT
            "Tenancy"."projectId" AS "project_id",
            "Tenancy"."branchId" AS "branch_id",
            "TeamMember"."teamId" AS "team_id",
            "TeamMember"."projectUserId" AS "user_id",
            "TeamMember"."displayName" AS "display_name",
            "TeamMember"."profileImageUrl" AS "profile_image_url",
            "TeamMember"."createdAt" AS "created_at",
            "TeamMember"."sequenceId" AS "sync_sequence_id",
            "TeamMember"."tenancyId" AS "tenancyId",
            false AS "sync_is_deleted"
          FROM "TeamMember"
          JOIN "Tenancy" ON "Tenancy"."id" = "TeamMember"."tenancyId"
          WHERE "TeamMember"."tenancyId" = $1::uuid

          UNION ALL

          SELECT
            "Tenancy"."projectId" AS "project_id",
            "Tenancy"."branchId" AS "branch_id",
            ("DeletedRow"."primaryKey"->>'teamId')::uuid AS "team_id",
            ("DeletedRow"."primaryKey"->>'projectUserId')::uuid AS "user_id",
            NULL::text AS "display_name",
            NULL::text AS "profile_image_url",
            "DeletedRow"."deletedAt"::timestamp without time zone AS "created_at",
            "DeletedRow"."sequenceId" AS "sync_sequence_id",
            "DeletedRow"."tenancyId" AS "tenancyId",
            true AS "sync_is_deleted"
          FROM "DeletedRow"
          JOIN "Tenancy" ON "Tenancy"."id" = "DeletedRow"."tenancyId"
          WHERE
            "DeletedRow"."tenancyId" = $1::uuid
            AND "DeletedRow"."tableName" = 'TeamMember'
        ) AS "_src"
        WHERE "sync_sequence_id" IS NOT NULL
          AND "sync_sequence_id" > $2::bigint
        ORDER BY "sync_sequence_id" ASC
        LIMIT 1000
      `.trim(),
    },
    internalDbFetchQuery: `
      SELECT *
      FROM (
        SELECT
          "TeamMember"."teamId" AS "team_id",
          "TeamMember"."projectUserId" AS "user_id",
          "TeamMember"."displayName" AS "display_name",
          "TeamMember"."profileImageUrl" AS "profile_image_url",
          "TeamMember"."createdAt" AS "created_at",
          "TeamMember"."sequenceId" AS "sequence_id",
          "TeamMember"."tenancyId",
          false AS "is_deleted"
        FROM "TeamMember"
        WHERE "TeamMember"."tenancyId" = $1::uuid

        UNION ALL

        SELECT
          ("DeletedRow"."primaryKey"->>'teamId')::uuid AS "team_id",
          ("DeletedRow"."primaryKey"->>'projectUserId')::uuid AS "user_id",
          NULL::text AS "display_name",
          NULL::text AS "profile_image_url",
          "DeletedRow"."deletedAt"::timestamp without time zone AS "created_at",
          "DeletedRow"."sequenceId" AS "sequence_id",
          "DeletedRow"."tenancyId",
          true AS "is_deleted"
        FROM "DeletedRow"
        WHERE
          "DeletedRow"."tenancyId" = $1::uuid
          AND "DeletedRow"."tableName" = 'TeamMember'
      ) AS "_src"
      WHERE "sequence_id" IS NOT NULL
        AND "sequence_id" > $2::bigint
      ORDER BY "sequence_id" ASC
      LIMIT 1000
    `.trim(),
    externalDbUpdateQueries: {
      postgres: `
        WITH params AS (
          SELECT
            $1::uuid AS "team_id",
            $2::uuid AS "user_id",
            $3::text AS "display_name",
            $4::text AS "profile_image_url",
            $5::timestamp without time zone AS "created_at",
            $6::bigint AS "sequence_id",
            $7::boolean AS "is_deleted",
            $8::text AS "mapping_name"
        ),
        deleted AS (
          DELETE FROM "team_members" tm
          USING params p
          WHERE p."is_deleted" = true AND tm."team_id" = p."team_id" AND tm."user_id" = p."user_id"
          RETURNING 1
        ),
        upserted AS (
          INSERT INTO "team_members" (
            "team_id",
            "user_id",
            "display_name",
            "profile_image_url",
            "created_at"
          )
          SELECT
            p."team_id",
            p."user_id",
            p."display_name",
            p."profile_image_url",
            p."created_at"
          FROM params p
          WHERE p."is_deleted" = false
          ON CONFLICT ("team_id", "user_id") DO UPDATE SET
            "display_name" = EXCLUDED."display_name",
            "profile_image_url" = EXCLUDED."profile_image_url",
            "created_at" = EXCLUDED."created_at"
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
  "email_outboxes": {
    sourceTables: { "EmailOutbox": "EmailOutbox" },
    targetTable: "email_outboxes",
    targetTableSchemas: {
      postgres: `
        CREATE TABLE IF NOT EXISTS "email_outboxes" (
          "id" uuid PRIMARY KEY NOT NULL,
          "status" text NOT NULL,
          "simple_status" text NOT NULL,
          "created_with" text NOT NULL,
          "email_draft_id" text,
          "email_programmatic_call_template_id" text,
          "theme_id" text,
          "is_high_priority" boolean NOT NULL DEFAULT false,
          "rendered_is_transactional" boolean,
          "rendered_subject" text,
          "rendered_notification_category_id" text,
          "started_rendering_at" timestamp without time zone,
          "finished_rendering_at" timestamp without time zone,
          "render_error" text,
          "scheduled_at" timestamp without time zone NOT NULL,
          "created_at" timestamp without time zone NOT NULL,
          "started_sending_at" timestamp without time zone,
          "finished_sending_at" timestamp without time zone,
          "server_error" text,
          "sent_at" timestamp without time zone,
          "delivered_at" timestamp without time zone,
          "opened_at" timestamp without time zone,
          "clicked_at" timestamp without time zone,
          "unsubscribed_at" timestamp without time zone,
          "marked_as_spam_at" timestamp without time zone,
          "bounced_at" timestamp without time zone,
          "delivery_delayed_at" timestamp without time zone,
          "can_have_delivery_info" boolean,
          "skipped_reason" text,
          "skipped_details" jsonb,
          "send_retries" integer NOT NULL DEFAULT 0,
          "is_paused" boolean NOT NULL DEFAULT false
        );
        REVOKE ALL ON "email_outboxes" FROM PUBLIC;
        GRANT SELECT ON "email_outboxes" TO PUBLIC;

        CREATE TABLE IF NOT EXISTS "_stack_sync_metadata" (
          "mapping_name" text PRIMARY KEY NOT NULL,
          "last_synced_sequence_id" bigint NOT NULL DEFAULT -1,
          "updated_at" timestamp without time zone NOT NULL DEFAULT now()
        );
      `.trim(),
      clickhouse: `
        CREATE TABLE IF NOT EXISTS analytics_internal.email_outboxes (
          project_id String,
          branch_id String,
          id UUID,
          status LowCardinality(String),
          simple_status LowCardinality(String),
          created_with LowCardinality(String),
          email_draft_id Nullable(String),
          email_programmatic_call_template_id Nullable(String),
          theme_id Nullable(String),
          is_high_priority UInt8,
          rendered_is_transactional Nullable(UInt8),
          rendered_subject Nullable(String),
          rendered_notification_category_id Nullable(String),
          started_rendering_at Nullable(DateTime64(3, 'UTC')),
          finished_rendering_at Nullable(DateTime64(3, 'UTC')),
          render_error Nullable(String),
          scheduled_at DateTime64(3, 'UTC'),
          created_at DateTime64(3, 'UTC'),
          started_sending_at Nullable(DateTime64(3, 'UTC')),
          finished_sending_at Nullable(DateTime64(3, 'UTC')),
          server_error Nullable(String),
          sent_at Nullable(DateTime64(3, 'UTC')),
          delivered_at Nullable(DateTime64(3, 'UTC')),
          opened_at Nullable(DateTime64(3, 'UTC')),
          clicked_at Nullable(DateTime64(3, 'UTC')),
          unsubscribed_at Nullable(DateTime64(3, 'UTC')),
          marked_as_spam_at Nullable(DateTime64(3, 'UTC')),
          bounced_at Nullable(DateTime64(3, 'UTC')),
          delivery_delayed_at Nullable(DateTime64(3, 'UTC')),
          can_have_delivery_info Nullable(UInt8),
          skipped_reason LowCardinality(Nullable(String)),
          skipped_details Nullable(String),
          send_retries Int32,
          is_paused UInt8,
          sync_sequence_id Int64,
          sync_is_deleted UInt8,
          sync_created_at DateTime64(3, 'UTC') DEFAULT now64(3)
        )
        ENGINE ReplacingMergeTree(sync_sequence_id)
        PARTITION BY toYYYYMM(created_at)
        ORDER BY (project_id, branch_id, id);
      `.trim(),
    },
    internalDbFetchQueries: {
      clickhouse: `
        SELECT
          "Tenancy"."projectId" AS "project_id",
          "Tenancy"."branchId" AS "branch_id",
          "EmailOutbox"."id" AS "id",
          "EmailOutbox"."status"::text AS "status",
          "EmailOutbox"."simpleStatus"::text AS "simple_status",
          "EmailOutbox"."createdWith"::text AS "created_with",
          "EmailOutbox"."emailDraftId" AS "email_draft_id",
          "EmailOutbox"."emailProgrammaticCallTemplateId" AS "email_programmatic_call_template_id",
          "EmailOutbox"."themeId" AS "theme_id",
          "EmailOutbox"."isHighPriority" AS "is_high_priority",
          "EmailOutbox"."renderedIsTransactional" AS "rendered_is_transactional",
          "EmailOutbox"."renderedSubject" AS "rendered_subject",
          "EmailOutbox"."renderedNotificationCategoryId" AS "rendered_notification_category_id",
          "EmailOutbox"."startedRenderingAt" AS "started_rendering_at",
          "EmailOutbox"."finishedRenderingAt" AS "finished_rendering_at",
          "EmailOutbox"."renderErrorExternalMessage" AS "render_error",
          "EmailOutbox"."scheduledAt" AS "scheduled_at",
          "EmailOutbox"."createdAt" AS "created_at",
          "EmailOutbox"."startedSendingAt" AS "started_sending_at",
          "EmailOutbox"."finishedSendingAt" AS "finished_sending_at",
          "EmailOutbox"."sendServerErrorExternalMessage" AS "server_error",
          "EmailOutbox"."sentAt" AS "sent_at",
          "EmailOutbox"."deliveredAt" AS "delivered_at",
          "EmailOutbox"."openedAt" AS "opened_at",
          "EmailOutbox"."clickedAt" AS "clicked_at",
          "EmailOutbox"."unsubscribedAt" AS "unsubscribed_at",
          "EmailOutbox"."markedAsSpamAt" AS "marked_as_spam_at",
          "EmailOutbox"."bouncedAt" AS "bounced_at",
          "EmailOutbox"."deliveryDelayedAt" AS "delivery_delayed_at",
          "EmailOutbox"."canHaveDeliveryInfo" AS "can_have_delivery_info",
          "EmailOutbox"."skippedReason"::text AS "skipped_reason",
          "EmailOutbox"."skippedDetails" AS "skipped_details",
          "EmailOutbox"."sendRetries" AS "send_retries",
          "EmailOutbox"."isPaused" AS "is_paused",
          "EmailOutbox"."sequenceId" AS "sync_sequence_id",
          "EmailOutbox"."tenancyId" AS "tenancyId",
          false AS "sync_is_deleted"
        FROM "EmailOutbox"
        JOIN "Tenancy" ON "Tenancy"."id" = "EmailOutbox"."tenancyId"
        WHERE "EmailOutbox"."tenancyId" = $1::uuid
          AND "EmailOutbox"."sequenceId" IS NOT NULL
          AND "EmailOutbox"."sequenceId" > $2::bigint
        ORDER BY "EmailOutbox"."sequenceId" ASC
        LIMIT 1000
      `.trim(),
    },
    internalDbFetchQuery: `
      SELECT
        "EmailOutbox"."id" AS "id",
        "EmailOutbox"."status"::text AS "status",
        "EmailOutbox"."simpleStatus"::text AS "simple_status",
        "EmailOutbox"."createdWith"::text AS "created_with",
        "EmailOutbox"."emailDraftId" AS "email_draft_id",
        "EmailOutbox"."emailProgrammaticCallTemplateId" AS "email_programmatic_call_template_id",
        "EmailOutbox"."themeId" AS "theme_id",
        "EmailOutbox"."isHighPriority" AS "is_high_priority",
        "EmailOutbox"."renderedIsTransactional" AS "rendered_is_transactional",
        "EmailOutbox"."renderedSubject" AS "rendered_subject",
        "EmailOutbox"."renderedNotificationCategoryId" AS "rendered_notification_category_id",
        "EmailOutbox"."startedRenderingAt" AS "started_rendering_at",
        "EmailOutbox"."finishedRenderingAt" AS "finished_rendering_at",
        "EmailOutbox"."renderErrorExternalMessage" AS "render_error",
        "EmailOutbox"."scheduledAt" AS "scheduled_at",
        "EmailOutbox"."createdAt" AS "created_at",
        "EmailOutbox"."startedSendingAt" AS "started_sending_at",
        "EmailOutbox"."finishedSendingAt" AS "finished_sending_at",
        "EmailOutbox"."sendServerErrorExternalMessage" AS "server_error",
        "EmailOutbox"."sentAt" AS "sent_at",
        "EmailOutbox"."deliveredAt" AS "delivered_at",
        "EmailOutbox"."openedAt" AS "opened_at",
        "EmailOutbox"."clickedAt" AS "clicked_at",
        "EmailOutbox"."unsubscribedAt" AS "unsubscribed_at",
        "EmailOutbox"."markedAsSpamAt" AS "marked_as_spam_at",
        "EmailOutbox"."bouncedAt" AS "bounced_at",
        "EmailOutbox"."deliveryDelayedAt" AS "delivery_delayed_at",
        "EmailOutbox"."canHaveDeliveryInfo" AS "can_have_delivery_info",
        "EmailOutbox"."skippedReason"::text AS "skipped_reason",
        "EmailOutbox"."skippedDetails" AS "skipped_details",
        "EmailOutbox"."sendRetries" AS "send_retries",
        "EmailOutbox"."isPaused" AS "is_paused",
        "EmailOutbox"."sequenceId" AS "sequence_id",
        "EmailOutbox"."tenancyId",
        false AS "is_deleted"
      FROM "EmailOutbox"
      WHERE "EmailOutbox"."tenancyId" = $1::uuid
        AND "EmailOutbox"."sequenceId" IS NOT NULL
        AND "EmailOutbox"."sequenceId" > $2::bigint
      ORDER BY "EmailOutbox"."sequenceId" ASC
      LIMIT 1000
    `.trim(),
    externalDbUpdateQueries: {
      postgres: `
        WITH params AS (
          SELECT
            $1::uuid AS "id",
            $2::text AS "status",
            $3::text AS "simple_status",
            $4::text AS "created_with",
            $5::text AS "email_draft_id",
            $6::text AS "email_programmatic_call_template_id",
            $7::text AS "theme_id",
            $8::boolean AS "is_high_priority",
            $9::boolean AS "rendered_is_transactional",
            $10::text AS "rendered_subject",
            $11::text AS "rendered_notification_category_id",
            $12::timestamp without time zone AS "started_rendering_at",
            $13::timestamp without time zone AS "finished_rendering_at",
            $14::text AS "render_error",
            $15::timestamp without time zone AS "scheduled_at",
            $16::timestamp without time zone AS "created_at",
            $17::timestamp without time zone AS "started_sending_at",
            $18::timestamp without time zone AS "finished_sending_at",
            $19::text AS "server_error",
            $20::timestamp without time zone AS "sent_at",
            $21::timestamp without time zone AS "delivered_at",
            $22::timestamp without time zone AS "opened_at",
            $23::timestamp without time zone AS "clicked_at",
            $24::timestamp without time zone AS "unsubscribed_at",
            $25::timestamp without time zone AS "marked_as_spam_at",
            $26::timestamp without time zone AS "bounced_at",
            $27::timestamp without time zone AS "delivery_delayed_at",
            $28::boolean AS "can_have_delivery_info",
            $29::text AS "skipped_reason",
            $30::jsonb AS "skipped_details",
            $31::integer AS "send_retries",
            $32::boolean AS "is_paused",
            $33::bigint AS "sequence_id",
            $34::boolean AS "is_deleted",
            $35::text AS "mapping_name"
        ),
        deleted AS (
          DELETE FROM "email_outboxes" eo
          USING params p
          WHERE p."is_deleted" = true AND eo."id" = p."id"
          RETURNING 1
        ),
        upserted AS (
          INSERT INTO "email_outboxes" (
            "id",
            "status",
            "simple_status",
            "created_with",
            "email_draft_id",
            "email_programmatic_call_template_id",
            "theme_id",
            "is_high_priority",
            "rendered_is_transactional",
            "rendered_subject",
            "rendered_notification_category_id",
            "started_rendering_at",
            "finished_rendering_at",
            "render_error",
            "scheduled_at",
            "created_at",
            "started_sending_at",
            "finished_sending_at",
            "server_error",
            "sent_at",
            "delivered_at",
            "opened_at",
            "clicked_at",
            "unsubscribed_at",
            "marked_as_spam_at",
            "bounced_at",
            "delivery_delayed_at",
            "can_have_delivery_info",
            "skipped_reason",
            "skipped_details",
            "send_retries",
            "is_paused"
          )
          SELECT
            p."id",
            p."status",
            p."simple_status",
            p."created_with",
            p."email_draft_id",
            p."email_programmatic_call_template_id",
            p."theme_id",
            p."is_high_priority",
            p."rendered_is_transactional",
            p."rendered_subject",
            p."rendered_notification_category_id",
            p."started_rendering_at",
            p."finished_rendering_at",
            p."render_error",
            p."scheduled_at",
            p."created_at",
            p."started_sending_at",
            p."finished_sending_at",
            p."server_error",
            p."sent_at",
            p."delivered_at",
            p."opened_at",
            p."clicked_at",
            p."unsubscribed_at",
            p."marked_as_spam_at",
            p."bounced_at",
            p."delivery_delayed_at",
            p."can_have_delivery_info",
            p."skipped_reason",
            p."skipped_details",
            p."send_retries",
            p."is_paused"
          FROM params p
          WHERE p."is_deleted" = false
          ON CONFLICT ("id") DO UPDATE SET
            "status" = EXCLUDED."status",
            "simple_status" = EXCLUDED."simple_status",
            "created_with" = EXCLUDED."created_with",
            "email_draft_id" = EXCLUDED."email_draft_id",
            "email_programmatic_call_template_id" = EXCLUDED."email_programmatic_call_template_id",
            "theme_id" = EXCLUDED."theme_id",
            "is_high_priority" = EXCLUDED."is_high_priority",
            "rendered_is_transactional" = EXCLUDED."rendered_is_transactional",
            "rendered_subject" = EXCLUDED."rendered_subject",
            "rendered_notification_category_id" = EXCLUDED."rendered_notification_category_id",
            "started_rendering_at" = EXCLUDED."started_rendering_at",
            "finished_rendering_at" = EXCLUDED."finished_rendering_at",
            "render_error" = EXCLUDED."render_error",
            "scheduled_at" = EXCLUDED."scheduled_at",
            "created_at" = EXCLUDED."created_at",
            "started_sending_at" = EXCLUDED."started_sending_at",
            "finished_sending_at" = EXCLUDED."finished_sending_at",
            "server_error" = EXCLUDED."server_error",
            "sent_at" = EXCLUDED."sent_at",
            "delivered_at" = EXCLUDED."delivered_at",
            "opened_at" = EXCLUDED."opened_at",
            "clicked_at" = EXCLUDED."clicked_at",
            "unsubscribed_at" = EXCLUDED."unsubscribed_at",
            "marked_as_spam_at" = EXCLUDED."marked_as_spam_at",
            "bounced_at" = EXCLUDED."bounced_at",
            "delivery_delayed_at" = EXCLUDED."delivery_delayed_at",
            "can_have_delivery_info" = EXCLUDED."can_have_delivery_info",
            "skipped_reason" = EXCLUDED."skipped_reason",
            "skipped_details" = EXCLUDED."skipped_details",
            "send_retries" = EXCLUDED."send_retries",
            "is_paused" = EXCLUDED."is_paused"
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
  "session_replays": {
    sourceTables: { "SessionReplay": "SessionReplay" },
    targetTable: "session_replays",
    targetTableSchemas: {
      postgres: `
        CREATE TABLE IF NOT EXISTS "session_replays" (
          "id" uuid PRIMARY KEY NOT NULL,
          "user_id" uuid NOT NULL,
          "refresh_token_id" text NOT NULL,
          "started_at" timestamp without time zone NOT NULL,
          "last_event_at" timestamp without time zone NOT NULL,
          "created_at" timestamp without time zone NOT NULL
        );
        REVOKE ALL ON "session_replays" FROM PUBLIC;
        GRANT SELECT ON "session_replays" TO PUBLIC;

        CREATE TABLE IF NOT EXISTS "_stack_sync_metadata" (
          "mapping_name" text PRIMARY KEY NOT NULL,
          "last_synced_sequence_id" bigint NOT NULL DEFAULT -1,
          "updated_at" timestamp without time zone NOT NULL DEFAULT now()
        );
      `.trim(),
      clickhouse: `
        CREATE TABLE IF NOT EXISTS analytics_internal.session_replays (
          project_id String,
          branch_id String,
          id UUID,
          user_id UUID,
          refresh_token_id String,
          started_at DateTime64(3, 'UTC'),
          last_event_at DateTime64(3, 'UTC'),
          created_at DateTime64(3, 'UTC'),
          sync_sequence_id Int64,
          sync_is_deleted UInt8,
          sync_created_at DateTime64(3, 'UTC') DEFAULT now64(3)
        )
        ENGINE ReplacingMergeTree(sync_sequence_id)
        PARTITION BY toYYYYMM(started_at)
        ORDER BY (project_id, branch_id, id);
      `.trim(),
    },
    internalDbFetchQueries: {
      clickhouse: `
        SELECT
          "Tenancy"."projectId" AS "project_id",
          "Tenancy"."branchId" AS "branch_id",
          "SessionReplay"."id" AS "id",
          "SessionReplay"."projectUserId" AS "user_id",
          "SessionReplay"."refreshTokenId" AS "refresh_token_id",
          "SessionReplay"."startedAt" AS "started_at",
          "SessionReplay"."lastEventAt" AS "last_event_at",
          "SessionReplay"."createdAt" AS "created_at",
          "SessionReplay"."sequenceId" AS "sync_sequence_id",
          "SessionReplay"."tenancyId" AS "tenancyId",
          false AS "sync_is_deleted"
        FROM "SessionReplay"
        JOIN "Tenancy" ON "Tenancy"."id" = "SessionReplay"."tenancyId"
        WHERE "SessionReplay"."tenancyId" = $1::uuid
          AND "SessionReplay"."sequenceId" IS NOT NULL
          AND "SessionReplay"."sequenceId" > $2::bigint
        ORDER BY "SessionReplay"."sequenceId" ASC
        LIMIT 1000
      `.trim(),
    },
    internalDbFetchQuery: `
      SELECT
        "SessionReplay"."id" AS "id",
        "SessionReplay"."projectUserId" AS "user_id",
        "SessionReplay"."refreshTokenId" AS "refresh_token_id",
        "SessionReplay"."startedAt" AS "started_at",
        "SessionReplay"."lastEventAt" AS "last_event_at",
        "SessionReplay"."createdAt" AS "created_at",
        "SessionReplay"."sequenceId" AS "sequence_id",
        "SessionReplay"."tenancyId",
        false AS "is_deleted"
      FROM "SessionReplay"
      WHERE "SessionReplay"."tenancyId" = $1::uuid
        AND "SessionReplay"."sequenceId" IS NOT NULL
        AND "SessionReplay"."sequenceId" > $2::bigint
      ORDER BY "SessionReplay"."sequenceId" ASC
      LIMIT 1000
    `.trim(),
    externalDbUpdateQueries: {
      postgres: `
        WITH params AS (
          SELECT
            $1::uuid AS "id",
            $2::uuid AS "user_id",
            $3::text AS "refresh_token_id",
            $4::timestamp without time zone AS "started_at",
            $5::timestamp without time zone AS "last_event_at",
            $6::timestamp without time zone AS "created_at",
            $7::bigint AS "sequence_id",
            $8::boolean AS "is_deleted",
            $9::text AS "mapping_name"
        ),
        deleted AS (
          DELETE FROM "session_replays" sr
          USING params p
          WHERE p."is_deleted" = true AND sr."id" = p."id"
          RETURNING 1
        ),
        upserted AS (
          INSERT INTO "session_replays" (
            "id",
            "user_id",
            "refresh_token_id",
            "started_at",
            "last_event_at",
            "created_at"
          )
          SELECT
            p."id",
            p."user_id",
            p."refresh_token_id",
            p."started_at",
            p."last_event_at",
            p."created_at"
          FROM params p
          WHERE p."is_deleted" = false
          ON CONFLICT ("id") DO UPDATE SET
            "user_id" = EXCLUDED."user_id",
            "refresh_token_id" = EXCLUDED."refresh_token_id",
            "started_at" = EXCLUDED."started_at",
            "last_event_at" = EXCLUDED."last_event_at",
            "created_at" = EXCLUDED."created_at"
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
