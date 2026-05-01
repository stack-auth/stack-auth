-- Adds SAML SSO support. Per-connection config (entity ID, IdP cert, ACS URL,
-- attribute mapping, domain) lives in tenancy.config.auth.saml.connections JSON,
-- matching how OAuth provider config is stored. The tables below cover only
-- per-user account records and the in-flight AuthnRequest temp store.

-- CreateTable
CREATE TABLE "ProjectUserSamlAccount" (
    "id" UUID NOT NULL,
    "tenancyId" UUID NOT NULL,
    "projectUserId" UUID NOT NULL,
    "samlConnectionId" TEXT NOT NULL,
    "nameId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "email" TEXT,
    "nameIdFormat" TEXT,
    "allowSignIn" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ProjectUserSamlAccount_pkey" PRIMARY KEY ("tenancyId","id")
);

-- CreateTable
CREATE TABLE "SamlAuthMethod" (
    "tenancyId" UUID NOT NULL,
    "authMethodId" UUID NOT NULL,
    "samlConnectionId" TEXT NOT NULL,
    "nameId" TEXT NOT NULL,
    "projectUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SamlAuthMethod_pkey" PRIMARY KEY ("tenancyId","authMethodId")
);

-- CreateTable
CREATE TABLE "SamlOuterInfo" (
    "id" TEXT NOT NULL,
    "info" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SamlOuterInfo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectUserSamlAccount_tenancyId_projectUserId_idx" ON "ProjectUserSamlAccount"("tenancyId", "projectUserId");

-- CreateIndex
CREATE INDEX "ProjectUserSamlAccount_tenancyId_samlConnectionId_idx" ON "ProjectUserSamlAccount"("tenancyId", "samlConnectionId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectUserSamlAccount_tenancyId_samlConnectionId_nameId_key" ON "ProjectUserSamlAccount"("tenancyId", "samlConnectionId", "nameId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectUserSamlAccount_tenancyId_samlConnectionId_projectUs_key" ON "ProjectUserSamlAccount"("tenancyId", "samlConnectionId", "projectUserId", "nameId");

-- CreateIndex
CREATE UNIQUE INDEX "SamlAuthMethod_tenancyId_projectUserId_samlConnectionId_key" ON "SamlAuthMethod"("tenancyId", "projectUserId", "samlConnectionId");

-- CreateIndex
CREATE UNIQUE INDEX "SamlAuthMethod_tenancyId_samlConnectionId_projectUserId_nam_key" ON "SamlAuthMethod"("tenancyId", "samlConnectionId", "projectUserId", "nameId");

-- AddForeignKey
ALTER TABLE "ProjectUserSamlAccount" ADD CONSTRAINT "ProjectUserSamlAccount_tenancyId_projectUserId_fkey" FOREIGN KEY ("tenancyId", "projectUserId") REFERENCES "ProjectUser"("tenancyId", "projectUserId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SamlAuthMethod" ADD CONSTRAINT "SamlAuthMethod_tenancyId_authMethodId_fkey" FOREIGN KEY ("tenancyId", "authMethodId") REFERENCES "AuthMethod"("tenancyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SamlAuthMethod" ADD CONSTRAINT "SamlAuthMethod_tenancyId_samlConnectionId_projectUserId_na_fkey" FOREIGN KEY ("tenancyId", "samlConnectionId", "projectUserId", "nameId") REFERENCES "ProjectUserSamlAccount"("tenancyId", "samlConnectionId", "projectUserId", "nameId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SamlAuthMethod" ADD CONSTRAINT "SamlAuthMethod_tenancyId_projectUserId_fkey" FOREIGN KEY ("tenancyId", "projectUserId") REFERENCES "ProjectUser"("tenancyId", "projectUserId") ON DELETE CASCADE ON UPDATE CASCADE;
