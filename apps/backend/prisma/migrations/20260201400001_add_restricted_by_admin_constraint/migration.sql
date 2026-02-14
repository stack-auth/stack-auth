-- Add restrictedByAdminPrivateDetails column
ALTER TABLE "ProjectUser" ADD COLUMN "restrictedByAdminPrivateDetails" TEXT;

-- Add constraint: When restrictedByAdmin is false, both reason and private details must be null
-- When restrictedByAdmin is true, reason and private details are optional
ALTER TABLE "ProjectUser" ADD CONSTRAINT "ProjectUser_restricted_by_admin_consistency"
  CHECK (
    ("restrictedByAdmin" = true) OR
    ("restrictedByAdmin" = false AND "restrictedByAdminReason" IS NULL AND "restrictedByAdminPrivateDetails" IS NULL)
  );
