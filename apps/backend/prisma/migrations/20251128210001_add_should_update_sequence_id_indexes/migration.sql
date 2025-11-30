CREATE INDEX "ProjectUser_shouldUpdateSequenceId_idx" ON "ProjectUser"("shouldUpdateSequenceId") WHERE "shouldUpdateSequenceId" = TRUE;

-- SPLIT_STATEMENT_SENTINEL
CREATE INDEX "ContactChannel_shouldUpdateSequenceId_idx" ON "ContactChannel"("shouldUpdateSequenceId") WHERE "shouldUpdateSequenceId" = TRUE;

-- SPLIT_STATEMENT_SENTINEL
CREATE INDEX "DeletedRow_shouldUpdateSequenceId_idx" ON "DeletedRow"("shouldUpdateSequenceId") WHERE "shouldUpdateSequenceId" = TRUE;

