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
  "team_member_profiles": {
    sourceTables: { "TeamMember": "TeamMember", "ProjectUser": "ProjectUser" },
    targetTable: "team_member_profiles",
    targetTableSchemas: {
      postgres: `
        CREATE TABLE IF NOT EXISTS "team_member_profiles" (
          "team_id" uuid NOT NULL,
          "user_id" uuid NOT NULL,
          "display_name" text,
          "profile_image_url" text,
          "user" jsonb NOT NULL DEFAULT '{}'::jsonb,
          "created_at" timestamp without time zone NOT NULL,
          PRIMARY KEY ("team_id", "user_id")
        );
        REVOKE ALL ON "team_member_profiles" FROM PUBLIC;
        GRANT SELECT ON "team_member_profiles" TO PUBLIC;

        CREATE TABLE IF NOT EXISTS "_stack_sync_metadata" (
          "mapping_name" text PRIMARY KEY NOT NULL,
          "last_synced_sequence_id" bigint NOT NULL DEFAULT -1,
          "updated_at" timestamp without time zone NOT NULL DEFAULT now()
        );
      `.trim(),
      clickhouse: `
        CREATE TABLE IF NOT EXISTS analytics_internal.team_member_profiles (
          project_id String,
          branch_id String,
          team_id UUID,
          user_id UUID,
          display_name Nullable(String),
          profile_image_url Nullable(String),
          user JSON,
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
            jsonb_build_object(
              'id', "ProjectUser"."projectUserId",
              'display_name', "ProjectUser"."displayName",
              'primary_email', (
                SELECT "ContactChannel"."value"
                FROM "ContactChannel"
                WHERE "ContactChannel"."projectUserId" = "ProjectUser"."projectUserId"
                  AND "ContactChannel"."tenancyId" = "ProjectUser"."tenancyId"
                  AND "ContactChannel"."type" = 'EMAIL'
                  AND "ContactChannel"."isPrimary" = 'TRUE'
                LIMIT 1
              ),
              'primary_email_verified', COALESCE(
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
              ),
              'profile_image_url', "ProjectUser"."profileImageUrl",
              'signed_up_at_millis', EXTRACT(EPOCH FROM "ProjectUser"."createdAt") * 1000,
              'client_metadata', COALESCE("ProjectUser"."clientMetadata", '{}'::jsonb),
              'client_read_only_metadata', COALESCE("ProjectUser"."clientReadOnlyMetadata", '{}'::jsonb),
              'server_metadata', COALESCE("ProjectUser"."serverMetadata", '{}'::jsonb),
              'is_anonymous', "ProjectUser"."isAnonymous",
              'last_active_at_millis', CASE WHEN "ProjectUser"."lastActiveAt" IS NOT NULL THEN EXTRACT(EPOCH FROM "ProjectUser"."lastActiveAt") * 1000 ELSE NULL END
            ) AS "user",
            "TeamMember"."createdAt" AS "created_at",
            "TeamMember"."sequenceId" AS "sync_sequence_id",
            "TeamMember"."tenancyId" AS "tenancyId",
            false AS "sync_is_deleted"
          FROM "TeamMember"
          JOIN "Tenancy" ON "Tenancy"."id" = "TeamMember"."tenancyId"
          JOIN "ProjectUser" ON "ProjectUser"."projectUserId" = "TeamMember"."projectUserId"
            AND "ProjectUser"."tenancyId" = "TeamMember"."tenancyId"
          WHERE "TeamMember"."tenancyId" = $1::uuid

          UNION ALL

          SELECT
            "Tenancy"."projectId" AS "project_id",
            "Tenancy"."branchId" AS "branch_id",
            ("DeletedRow"."primaryKey"->>'teamId')::uuid AS "team_id",
            ("DeletedRow"."primaryKey"->>'projectUserId')::uuid AS "user_id",
            NULL::text AS "display_name",
            NULL::text AS "profile_image_url",
            '{}'::jsonb AS "user",
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
          jsonb_build_object(
            'id', "ProjectUser"."projectUserId",
            'display_name', "ProjectUser"."displayName",
            'primary_email', (
              SELECT "ContactChannel"."value"
              FROM "ContactChannel"
              WHERE "ContactChannel"."projectUserId" = "ProjectUser"."projectUserId"
                AND "ContactChannel"."tenancyId" = "ProjectUser"."tenancyId"
                AND "ContactChannel"."type" = 'EMAIL'
                AND "ContactChannel"."isPrimary" = 'TRUE'
              LIMIT 1
            ),
            'primary_email_verified', COALESCE(
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
            ),
            'profile_image_url', "ProjectUser"."profileImageUrl",
            'signed_up_at_millis', EXTRACT(EPOCH FROM "ProjectUser"."createdAt") * 1000,
            'client_metadata', COALESCE("ProjectUser"."clientMetadata", '{}'::jsonb),
            'client_read_only_metadata', COALESCE("ProjectUser"."clientReadOnlyMetadata", '{}'::jsonb),
            'server_metadata', COALESCE("ProjectUser"."serverMetadata", '{}'::jsonb),
            'is_anonymous', "ProjectUser"."isAnonymous",
            'last_active_at_millis', CASE WHEN "ProjectUser"."lastActiveAt" IS NOT NULL THEN EXTRACT(EPOCH FROM "ProjectUser"."createdAt") * 1000 ELSE NULL END
          ) AS "user",
          "TeamMember"."createdAt" AS "created_at",
          "TeamMember"."sequenceId" AS "sequence_id",
          "TeamMember"."tenancyId",
          false AS "is_deleted"
        FROM "TeamMember"
        JOIN "ProjectUser" ON "ProjectUser"."projectUserId" = "TeamMember"."projectUserId"
          AND "ProjectUser"."tenancyId" = "TeamMember"."tenancyId"
        WHERE "TeamMember"."tenancyId" = $1::uuid

        UNION ALL

        SELECT
          ("DeletedRow"."primaryKey"->>'teamId')::uuid AS "team_id",
          ("DeletedRow"."primaryKey"->>'projectUserId')::uuid AS "user_id",
          NULL::text AS "display_name",
          NULL::text AS "profile_image_url",
          '{}'::jsonb AS "user",
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
            $5::jsonb AS "user",
            $6::timestamp without time zone AS "created_at",
            $7::bigint AS "sequence_id",
            $8::boolean AS "is_deleted",
            $9::text AS "mapping_name"
        ),
        deleted AS (
          DELETE FROM "team_member_profiles" tm
          USING params p
          WHERE p."is_deleted" = true AND tm."team_id" = p."team_id" AND tm."user_id" = p."user_id"
          RETURNING 1
        ),
        upserted AS (
          INSERT INTO "team_member_profiles" (
            "team_id",
            "user_id",
            "display_name",
            "profile_image_url",
            "user",
            "created_at"
          )
          SELECT
            p."team_id",
            p."user_id",
            p."display_name",
            p."profile_image_url",
            p."user",
            p."created_at"
          FROM params p
          WHERE p."is_deleted" = false
          ON CONFLICT ("team_id", "user_id") DO UPDATE SET
            "display_name" = EXCLUDED."display_name",
            "profile_image_url" = EXCLUDED."profile_image_url",
            "user" = EXCLUDED."user",
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
