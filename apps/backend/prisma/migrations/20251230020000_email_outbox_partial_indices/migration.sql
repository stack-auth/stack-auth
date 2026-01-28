-- CreateIndex
-- Partial index for emails currently being rendered (finishedRenderingAt is NULL)
-- Indexed by startedRenderingAt to efficiently query in-progress rendering jobs
CREATE INDEX "EmailOutbox_rendering_in_progress_idx"
    ON "EmailOutbox" ("startedRenderingAt")
    WHERE "finishedRenderingAt" IS NULL;

-- CreateIndex
-- Partial index for emails currently being sent (finishedSendingAt is NULL)
-- Indexed by startedSendingAt to efficiently query in-progress sending jobs
CREATE INDEX "EmailOutbox_sending_in_progress_idx"
    ON "EmailOutbox" ("startedSendingAt")
    WHERE "finishedSendingAt" IS NULL;

-- CreateIndex
-- Index for looking up team members by user and selection status
CREATE INDEX "TeamMember_projectUserId_isSelected_idx"
    ON "TeamMember" ("tenancyId", "projectUserId", "isSelected");

-- CreateIndex
-- Index for looking up projects by owner team
CREATE INDEX "Project_ownerTeamId_idx"
    ON "Project" ("ownerTeamId");

