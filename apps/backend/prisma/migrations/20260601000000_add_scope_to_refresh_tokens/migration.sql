-- AlterTable
-- Adding a nullable column with no default is a metadata-only change in Postgres (no table
-- rewrite), so this is safe even on a ProjectUserRefreshToken table with many millions of rows.
ALTER TABLE "ProjectUserRefreshToken" ADD COLUMN "scope" TEXT;
