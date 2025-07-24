/*
  Warnings:

  - The values [FACEBOOK] on the enum `ProxiedOAuthProviderType` will be removed. If these variants are still used in the database, this will fail.
*/

-- Update shared facebook project to be a standard oauth provider

-- First, disable all the auth method configs that are shared facebook
UPDATE "AuthMethodConfig"
SET "enabled" = false
WHERE "id" IN (
    SELECT "authMethodConfigId"
    FROM "OAuthProviderConfig"
    WHERE "id" IN (
        SELECT "id"
        FROM "ProxiedOAuthProviderConfig"
        WHERE "type" = 'FACEBOOK'
    )
);

-- Second, create StandardOAuthProviderConfig entries for Facebook providers
INSERT INTO "StandardOAuthProviderConfig" ("projectConfigId", "id", "type", "clientId", "clientSecret", "createdAt", "updatedAt")
SELECT 
    p."projectConfigId",
    p."id",
    'FACEBOOK',
    'client id',
    'client secret',
    NOW(),
    NOW()
FROM "ProxiedOAuthProviderConfig" p
WHERE p."type" = 'FACEBOOK';

-- Then, delete the corresponding ProxiedOAuthProviderConfig entries
DELETE FROM "ProxiedOAuthProviderConfig"
WHERE "type" = 'FACEBOOK';

-- AlterEnum
-- SPLIT_STATEMENT_SENTINEL
CREATE TYPE "ProxiedOAuthProviderType_new" AS ENUM ('GITHUB', 'GOOGLE', 'MICROSOFT', 'SPOTIFY');
ALTER TABLE "ProxiedOAuthProviderConfig" ALTER COLUMN "type" TYPE "ProxiedOAuthProviderType_new" USING ("type"::text::"ProxiedOAuthProviderType_new");
ALTER TYPE "ProxiedOAuthProviderType" RENAME TO "ProxiedOAuthProviderType_old";
ALTER TYPE "ProxiedOAuthProviderType_new" RENAME TO "ProxiedOAuthProviderType";
DROP TYPE "ProxiedOAuthProviderType_old";
