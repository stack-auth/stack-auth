-- SINGLE_STATEMENT_SENTINEL
CREATE FUNCTION enqueue_tenant_sync(p_tenant_id uuid)
RETURNS void AS $$
BEGIN
  INSERT INTO "OutgoingRequest" ("id", "createdAt", "qstashOptions", "fulfilledAt")
  SELECT
    gen_random_uuid(),
    NOW(),
    json_build_object(
      'url',  '/api/latest/internal/external-db-sync/sync-engine',
      'body', json_build_object('tenantId', p_tenant_id)
    ),
    NULL
  WHERE NOT EXISTS (
    SELECT 1
    FROM "OutgoingRequest"
    WHERE "fulfilledAt" IS NULL
      AND ("qstashOptions"->'body'->>'tenantId')::uuid = p_tenant_id
  );
END;
$$ LANGUAGE plpgsql;
-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
CREATE FUNCTION backfill_null_sequence_ids()
RETURNS void AS $$
DECLARE
  v_tenancy_id uuid;
BEGIN
  FOR v_tenancy_id IN
    WITH rows_to_update AS (
      SELECT "tenancyId", "projectUserId"
      FROM "ProjectUser"
      WHERE "shouldUpdateSequenceId" = TRUE
      OR "sequenceId" IS NULL
      LIMIT 1000
      FOR UPDATE SKIP LOCKED
    ),
    updated_rows AS (
      UPDATE "ProjectUser" pu
      SET "sequenceId" = nextval('global_seq_id'),
          "shouldUpdateSequenceId" = FALSE
      FROM rows_to_update r
      WHERE pu."tenancyId"     = r."tenancyId"
        AND pu."projectUserId" = r."projectUserId"
      RETURNING pu."tenancyId"
    )
    SELECT DISTINCT "tenancyId" FROM updated_rows
  LOOP
    PERFORM enqueue_tenant_sync(v_tenancy_id);
  END LOOP;

  FOR v_tenancy_id IN
    WITH rows_to_update AS (
      SELECT "tenancyId", "projectUserId", "id"
      FROM "ContactChannel"
      WHERE "shouldUpdateSequenceId" = TRUE
      OR "sequenceId" IS NULL
      LIMIT 1000
      FOR UPDATE SKIP LOCKED
    ),
    updated_rows AS (
      UPDATE "ContactChannel" cc
      SET "sequenceId" = nextval('global_seq_id'),
          "shouldUpdateSequenceId" = FALSE
      FROM rows_to_update r
      WHERE cc."tenancyId"     = r."tenancyId"
        AND cc."projectUserId" = r."projectUserId"
        AND cc."id"            = r."id"
      RETURNING cc."tenancyId"
    )
    SELECT DISTINCT "tenancyId" FROM updated_rows
  LOOP
    PERFORM enqueue_tenant_sync(v_tenancy_id);
  END LOOP;

  FOR v_tenancy_id IN
    WITH rows_to_update AS (
      SELECT "id", "tenancyId"
      FROM "DeletedRow"
      WHERE "shouldUpdateSequenceId" = TRUE
      OR "sequenceId" IS NULL
      LIMIT 1000
      FOR UPDATE SKIP LOCKED
    ),
    updated_rows AS (
      UPDATE "DeletedRow" dr
      SET "sequenceId" = nextval('global_seq_id'),
          "shouldUpdateSequenceId" = FALSE
      FROM rows_to_update r
      WHERE dr."id" = r."id"
      RETURNING dr."tenancyId"
    )
    SELECT DISTINCT "tenancyId" FROM updated_rows
  LOOP
    PERFORM enqueue_tenant_sync(v_tenancy_id);
  END LOOP;

END;
$$ LANGUAGE plpgsql;

