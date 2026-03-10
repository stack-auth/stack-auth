ALTER TABLE "ProjectUser"
  ADD COLUMN "signUpAt" TIMESTAMP(3),
  ADD COLUMN "signUpIp" TEXT,
  ADD COLUMN "signUpIpTrusted" BOOLEAN,
  ADD COLUMN "signUpEmailNormalized" TEXT,
  ADD COLUMN "signUpEmailBase" TEXT;

UPDATE "ProjectUser"
SET "signUpAt" = "createdAt"
WHERE "signUpAt" IS NULL;

CREATE INDEX "ProjectUser_signUpAt_asc"
  ON "ProjectUser"("tenancyId", "signUpAt" ASC);

CREATE INDEX "ProjectUser_signUpAt_desc"
  ON "ProjectUser"("tenancyId", "signUpAt" DESC);

CREATE INDEX "ProjectUser_signUpIp_recent_idx"
  ON "ProjectUser"("tenancyId", "signUpIp", "signUpAt");

CREATE INDEX "ProjectUser_signUpEmailBase_recent_idx"
  ON "ProjectUser"("tenancyId", "signUpEmailBase", "signUpAt");
