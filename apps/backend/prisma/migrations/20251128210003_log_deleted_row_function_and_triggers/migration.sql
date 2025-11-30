-- SINGLE_STATEMENT_SENTINEL
CREATE FUNCTION log_deleted_row()
RETURNS TRIGGER AS $function$
DECLARE
  row_data jsonb;
  pk jsonb := '{}'::jsonb;
  col record;
BEGIN
  row_data := to_jsonb(OLD);

  FOR col IN
    SELECT a.attname
    FROM pg_index i
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
    WHERE i.indrelid = TG_RELID
      AND i.indisprimary
  LOOP
    pk := pk || jsonb_build_object(col.attname, row_data -> col.attname);
  END LOOP;
  
  INSERT INTO "DeletedRow" (
    "id",
    "tenancyId",
    "tableName",
    "primaryKey",
    "data",
    "deletedAt",
    "shouldUpdateSequenceId"
  )
  VALUES (
    gen_random_uuid(), 
    OLD."tenancyId", 
    TG_TABLE_NAME, 
    pk,
    row_data, 
    NOW(),
    TRUE
  );
  
  RETURN OLD;
END;
$function$ LANGUAGE plpgsql;

-- SPLIT_STATEMENT_SENTINEL
CREATE TRIGGER log_deleted_row_project_user
BEFORE DELETE ON "ProjectUser"
FOR EACH ROW
EXECUTE FUNCTION log_deleted_row();

-- SPLIT_STATEMENT_SENTINEL
CREATE TRIGGER log_deleted_row_contact_channel
BEFORE DELETE ON "ContactChannel"
FOR EACH ROW
EXECUTE FUNCTION log_deleted_row();

