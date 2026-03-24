-- Backward-compat: old code that doesn't know about `signedUpAt` omits it from
-- INSERT.  Adding a DEFAULT lets Postgres fill it automatically.
--
-- CURRENT_TIMESTAMP is correct here: `createdAt` also defaults to
-- CURRENT_TIMESTAMP, so within the same transaction both columns receive the
-- same value.  Old code never computes risk scores, so the negligible edge
-- case of an explicitly-backdated `createdAt` is harmless.
ALTER TABLE "ProjectUser" ALTER COLUMN "signedUpAt" SET DEFAULT CURRENT_TIMESTAMP;
