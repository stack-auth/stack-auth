-- Issue.assignedTeamId / IssueOwner.ownerTeamId / IssueSubscription.subjectTeamId
-- are the Hexclave project owner team, which lives on the internal project.
-- A composite FK to this tenancy's Team table either rejects that id or
-- (worse) accepts a customer-app team with a colliding UUID.
--
-- 20260731000000_add_issues no longer creates these constraints. This file
-- drops them on databases that already applied the earlier shape. Catalog-only
-- and IF EXISTS, so a fresh install is a no-op.
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE "Issue" DROP CONSTRAINT IF EXISTS "Issue_assigned_team_fkey";
ALTER TABLE "IssueOwner" DROP CONSTRAINT IF EXISTS "IssueOwner_team_fkey";
ALTER TABLE "IssueSubscription" DROP CONSTRAINT IF EXISTS "IssueSubscription_team_fkey";
