-- SINGLE_STATEMENT_SENTINEL
CREATE FUNCTION reset_sequence_id_on_update()
RETURNS TRIGGER AS $$
BEGIN
  NEW."shouldUpdateSequenceId" := TRUE;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- SPLIT_STATEMENT_SENTINEL
CREATE TRIGGER mark_should_update_sequence_id_project_user
BEFORE UPDATE ON "ProjectUser"
FOR EACH ROW
WHEN (OLD."shouldUpdateSequenceId" = FALSE)
EXECUTE FUNCTION reset_sequence_id_on_update();

-- SPLIT_STATEMENT_SENTINEL
CREATE TRIGGER mark_should_update_sequence_id_contact_channel
BEFORE UPDATE ON "ContactChannel"
FOR EACH ROW
WHEN (OLD."shouldUpdateSequenceId" = FALSE)
EXECUTE FUNCTION reset_sequence_id_on_update();

-- SPLIT_STATEMENT_SENTINEL
CREATE TRIGGER mark_should_update_sequence_id_deleted_row
BEFORE UPDATE ON "DeletedRow"
FOR EACH ROW
WHEN (OLD."shouldUpdateSequenceId" = FALSE)
EXECUTE FUNCTION reset_sequence_id_on_update();

