export const DEFAULT_DB_SYNC_MAPPINGS = {
  "PartialUsers": {
    sourceTables: ["ContactChannel", "ProjectUser"],
    targetTable: "PartialUsers",
    targetTablePrimaryKey: ["id"],
    targetTableSchema: `
   CREATE TABLE IF NOT EXISTS "PartialUsers" (
        "id" uuid PRIMARY KEY,
        "createdAt" timestamp with time zone,
        "updatedAt" timestamp with time zone,
        "type" text,
        "isPrimary" boolean,
        "isVerified" boolean,
        "value" text,
        "sequenceId" bigint,
        "userUpdatedAt" timestamp with time zone,
        "profileImageUrl" text,
        "displayName" text,
        "userCreatedAt" timestamp with time zone,
        "isAnonymous" boolean
      );
      CREATE INDEX ON "PartialUsers" ("sequenceId");
      REVOKE ALL ON "PartialUsers" FROM PUBLIC;
      GRANT SELECT ON "PartialUsers" TO PUBLIC;
    `.trim(),
    internalDbFetchQuery: `
  SELECT *
      FROM (
        SELECT
          "ContactChannel"."id",
          "ContactChannel"."createdAt",
          "ContactChannel"."updatedAt",
          "ContactChannel"."type"::text AS "type",
          CASE WHEN "ContactChannel"."isPrimary" = 'TRUE' THEN true ELSE false END AS "isPrimary",
          "ContactChannel"."isVerified",
          "ContactChannel"."value",
          GREATEST("ContactChannel"."sequenceId", "ProjectUser"."sequenceId") AS "sequenceId",
          "ProjectUser"."updatedAt" AS "userUpdatedAt",
          "ProjectUser"."profileImageUrl",
          "ProjectUser"."displayName",
          "ProjectUser"."createdAt" AS "userCreatedAt",
          "ProjectUser"."isAnonymous",
          "ContactChannel"."tenancyId",
          false AS "isDeleted"
        FROM "ContactChannel"
        JOIN "ProjectUser"
          ON "ContactChannel"."projectUserId" = "ProjectUser"."projectUserId"
         AND "ContactChannel"."tenancyId" = "ProjectUser"."tenancyId"
        WHERE "ContactChannel"."tenancyId" = $1::uuid
        
        UNION ALL
        SELECT
          ("DeletedRow"."primaryKey"->>'id')::uuid           AS "id",
          NULL::timestamptz                                  AS "createdAt",
          "DeletedRow"."deletedAt"                           AS "updatedAt",
          NULL::text                                         AS "type",
          NULL::boolean                                      AS "isPrimary",
          NULL::boolean                                      AS "isVerified",
          NULL::text                                         AS "value",
          "DeletedRow"."sequenceId"                          AS "sequenceId",
          NULL::timestamptz                                  AS "userUpdatedAt",
          NULL::text                                         AS "profileImageUrl",
          NULL::text                                         AS "displayName",
          NULL::timestamptz                                  AS "userCreatedAt",
          NULL::boolean                                      AS "isAnonymous",
          "DeletedRow"."tenancyId",
          true                                               AS "isDeleted"
        FROM "DeletedRow"
        WHERE
          "DeletedRow"."tenancyId" = $1::uuid
          AND "DeletedRow"."tableName" = 'ContactChannel'
      ) AS "_src"
      WHERE "sequenceId" IS NOT NULL
      ORDER BY "sequenceId" ASC
      LIMIT 1000
    `.trim(),
    externalDbUpdateQuery: `
           WITH existing AS (
        SELECT "sequenceId" AS "oldSeq"
        FROM "PartialUsers"
        WHERE "id" = $1::uuid
      ),
      decision AS (
        SELECT
          $1::uuid        AS "id",
          $2::timestamptz AS "createdAt",
          $3::timestamptz AS "updatedAt",
          $4::text        AS "type",
          $5::boolean     AS "isPrimary",
          $6::boolean     AS "isVerified",
          $7::text        AS "value",
          $8::bigint      AS "newSeq",
          $9::timestamptz AS "userUpdatedAt",
          $10::text       AS "profileImageUrl",
          $11::text       AS "displayName",
          $12::timestamptz AS "userCreatedAt",
          $13::boolean    AS "isAnonymous",
          $14::boolean    AS "isDeleted",
          (SELECT "oldSeq" FROM existing) AS "oldSeq"
      ),
      deleted AS (
        DELETE FROM "PartialUsers" p
        USING decision d
        WHERE
          d."isDeleted" = true
                AND (
        d."oldSeq" IS NULL
        OR d."newSeq" >= d."oldSeq"
      )
          AND p."id" = d."id"
        RETURNING 1
      )
      INSERT INTO "PartialUsers" (
        "id",
        "createdAt",
        "updatedAt",
        "type",
        "isPrimary",
        "isVerified",
        "value",
        "sequenceId",
        "userUpdatedAt",
        "profileImageUrl",
        "displayName",
        "userCreatedAt",
        "isAnonymous"
      )
      SELECT
        d."id",
        d."createdAt",
        d."updatedAt",
        d."type",
        d."isPrimary",
        d."isVerified",
        d."value",
        d."newSeq"        AS "sequenceId",
        d."userUpdatedAt",
        d."profileImageUrl",
        d."displayName",
        d."userCreatedAt",
        d."isAnonymous"
      FROM decision d
      WHERE
  d."isDeleted" = false
    AND (
      d."oldSeq" IS NULL
      OR d."newSeq" > d."oldSeq"
    )
      ON CONFLICT ("id") DO UPDATE SET
        "createdAt"       = EXCLUDED."createdAt",
        "updatedAt"       = EXCLUDED."updatedAt",
        "type"            = EXCLUDED."type",
        "isPrimary"       = EXCLUDED."isPrimary",
        "isVerified"      = EXCLUDED."isVerified",
        "value"           = EXCLUDED."value",
        "sequenceId"      = EXCLUDED."sequenceId",
        "userUpdatedAt"   = EXCLUDED."userUpdatedAt",
        "profileImageUrl" = EXCLUDED."profileImageUrl",
        "displayName"     = EXCLUDED."displayName",
        "userCreatedAt"   = EXCLUDED."userCreatedAt",
        "isAnonymous"     = EXCLUDED."isAnonymous"
      WHERE
        EXCLUDED."sequenceId" > "PartialUsers"."sequenceId";
    `.trim(),
  },
} as const;
