-- Remove foreign key constraints from Tenancy model relations

-- Remove foreign key constraint for teams relation
ALTER TABLE "Team" DROP CONSTRAINT "Team_tenancyId_fkey";

-- Remove foreign key constraint for projectUsers relation  
ALTER TABLE "ProjectUser" DROP CONSTRAINT "ProjectUser_tenancyId_fkey";

-- Remove foreign key constraint for authMethods relation
ALTER TABLE "AuthMethod" DROP CONSTRAINT "AuthMethod_tenancyId_fkey";

-- Remove foreign key constraint for contactChannels relation
ALTER TABLE "ContactChannel" DROP CONSTRAINT "ContactChannel_tenancyId_fkey";

-- Remove foreign key constraint for connectedAccounts relation
ALTER TABLE "ConnectedAccount" DROP CONSTRAINT "ConnectedAccount_tenancyId_fkey";

-- Remove foreign key constraint for SentEmail relation
ALTER TABLE "SentEmail" DROP CONSTRAINT "SentEmail_tenancyId_fkey";

-- Remove foreign key constraint for cliAuthAttempts relation
ALTER TABLE "CliAuthAttempt" DROP CONSTRAINT "CliAuthAttempt_tenancyId_fkey";

-- Remove foreign key constraint for projectApiKey relation
ALTER TABLE "ProjectApiKey" DROP CONSTRAINT "ProjectApiKey_tenancyId_fkey";

-- Remove foreign key constraint for projectUsers relation from Project model
ALTER TABLE "ProjectUser" DROP CONSTRAINT "ProjectUser_mirroredProjectId_fkey"; 
