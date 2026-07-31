-- The validated check lets PostgreSQL avoid a table scan while holding the
-- ACCESS EXCLUSIVE lock required to update column metadata.
ALTER TABLE "ContactChannel" ALTER COLUMN "contactId" SET NOT NULL;
ALTER TABLE "ContactChannel" DROP CONSTRAINT "ContactChannel_contactId_not_null";
