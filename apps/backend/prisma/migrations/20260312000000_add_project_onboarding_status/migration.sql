-- Add the onboarding status with a safe default for existing projects, and
-- defer full validation to the next migration.
ALTER TABLE "Project"
  ADD COLUMN "onboardingStatus" TEXT NOT NULL DEFAULT 'completed',
  ADD CONSTRAINT "Project_onboardingStatus_valid"
    CHECK (
      "onboardingStatus" IN (
        'config_choice',
        'apps_selection',
        'auth_setup',
        'domain_setup',
        'email_theme_setup',
        'payments_setup',
        'completed'
      )
    ) NOT VALID;
