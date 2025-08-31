-- It's very common to query by sessionId, userId, projectId, branchId, and eventStartedAt at the same time.
-- We can use a composite index to speed up the query.
-- Sadly we can't add this to the Prisma schema itself because Prisma does not understand composite indexes of JSONB fields.
-- So we have to add it manually.
-- (This is similar to the older idx_event_userid_projectid_branchid_eventstartedat index, but with sessionId added.)
CREATE INDEX idx_event_sessionid_userid_projectid_branchid_eventstartedat ON "Event" ((data->>'projectId'), (data->>'branchId'), (data->>'userId'), (data->>'sessionId'), "eventStartedAt");
