-- Make columns NOT NULL with default NOW() for new rows
ALTER TABLE "ProjectUser" ALTER COLUMN "lastActiveAt" SET NOT NULL;
ALTER TABLE "ProjectUser" ALTER COLUMN "lastActiveAt" SET DEFAULT NOW();

ALTER TABLE "ProjectUserRefreshToken" ALTER COLUMN "lastActiveAt" SET NOT NULL;
ALTER TABLE "ProjectUserRefreshToken" ALTER COLUMN "lastActiveAt" SET DEFAULT NOW();

