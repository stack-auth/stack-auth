-- Add 'welcome' to the allowed onboarding status values.
-- Drop the old constraint and add a new one (NOT VALID for speed),
-- then validate in the next migration.
ALTER TABLE "Project"
  DROP CONSTRAINT "Project_onboardingStatus_valid",
  ADD CONSTRAINT "Project_onboardingStatus_valid"
    CHECK (
      "onboardingStatus" IN (
        'config_choice',
        'apps_selection',
        'auth_setup',
        'domain_setup',
        'email_theme_setup',
        'payments_setup',
        'welcome',
        'completed'
      )
    ) NOT VALID;
