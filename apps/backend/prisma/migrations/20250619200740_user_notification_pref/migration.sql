-- CreateTable
CREATE TABLE "UserNotificationPreference" (
    "id" UUID NOT NULL,
    "tenancyId" UUID NOT NULL,
    "projectUserId" UUID NOT NULL,
    "notificationCategoryId" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL,

    CONSTRAINT "UserNotificationPreference_pkey" PRIMARY KEY ("tenancyId","id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserNotificationPreference_tenancyId_projectUserId_notifica_key" ON "UserNotificationPreference"("tenancyId", "projectUserId", "notificationCategoryId");

-- AddForeignKey
ALTER TABLE "UserNotificationPreference" ADD CONSTRAINT "UserNotificationPreference_tenancyId_fkey" FOREIGN KEY ("tenancyId") REFERENCES "Tenancy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserNotificationPreference" ADD CONSTRAINT "UserNotificationPreference_tenancyId_projectUserId_fkey" FOREIGN KEY ("tenancyId", "projectUserId") REFERENCES "ProjectUser"("tenancyId", "projectUserId") ON DELETE CASCADE ON UPDATE CASCADE;
