"use client";

import { Switch, Typography } from "@/components/ui";
import { EnvelopeSimple } from "@phosphor-icons/react";

const DESCRIPTION =
  "Require a verified primary email before users can continue after sign-up.";

const SWITCH_ID = "onboarding-email-verification";

export type OnboardingEmailVerificationSettingProps = {
  isEnabled: boolean,
  isToggling: boolean,
  onCheckedChange: (checked: boolean) => void,
};

/**
 * Settings-strip layout: label + description + switch in one compact row.
 */
export function OnboardingEmailVerificationSetting({
  isEnabled,
  isToggling,
  onCheckedChange,
}: OnboardingEmailVerificationSettingProps) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-foreground/[0.02] p-4 ring-1 ring-foreground/[0.06] sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-foreground/[0.04] ring-1 ring-foreground/[0.06]">
          <EnvelopeSimple className="h-4 w-4 text-muted-foreground" />
        </div>
        <label htmlFor={SWITCH_ID} className="min-w-0 cursor-pointer">
          <Typography className="text-sm font-medium text-foreground">
            Require email verification
          </Typography>
          <Typography variant="secondary" className="text-xs">
            {DESCRIPTION}
          </Typography>
        </label>
      </div>
      <div className="flex shrink-0 justify-end sm:pl-4">
        <Switch
          id={SWITCH_ID}
          checked={isEnabled}
          disabled={isToggling}
          loading={isToggling}
          onCheckedChange={onCheckedChange}
        />
      </div>
    </div>
  );
}
