/*
  Warnings:

  - A unique constraint covering the columns `[tenancyId,projectUserId,configOAuthProviderId]` on the table `OAuthAuthMethod` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "OAuthAuthMethod_tenancyId_projectUserId_configOAuthProvider_key" ON "OAuthAuthMethod"("tenancyId", "projectUserId", "configOAuthProviderId");
