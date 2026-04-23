"use client";

import { Switch, Typography } from "@/components/ui";
import { useUpdateConfig } from "@/lib/config-update";
import { cn } from "@/lib/utils";
import { DesignBadge, DesignCard } from "@/components/design-components";
import { FlaskIcon } from "@phosphor-icons/react";
import { useAdminApp } from "../../use-admin-app";

export function TestModeToggle() {
  const adminApp = useAdminApp();
  const project = adminApp.useProject();
  const paymentsConfig = project.useConfig().payments;
  const updateConfig = useUpdateConfig();

  const handleToggle = async (enabled: boolean) => {
    await updateConfig({
      adminApp,
      configUpdate: { "payments.testMode": enabled },
      pushable: false,
    });
  };

  const isOn = paymentsConfig.testMode;

  const testModeBadges = [
    "No credit card required",
    "Products granted instantly",
    "No Stripe transactions",
  ];

  return (
    <DesignCard
      title="Test Mode"
      subtitle="Switch between test and live payment environments."
      icon={FlaskIcon}
      gradient={isOn ? "blue" : "default"}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <div className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1 transition-colors duration-150 hover:transition-none",
            isOn
              ? "bg-blue-500/10 text-blue-600 dark:bg-blue-400/10 dark:text-blue-400 ring-blue-500/20"
              : "bg-foreground/[0.05] text-muted-foreground ring-foreground/[0.08]"
          )}>
            <FlaskIcon className="h-4 w-4" weight="duotone" />
          </div>
          <div className="space-y-1 min-w-0">
            <Typography className="text-sm font-medium text-foreground">
              {isOn ? "Test mode is active" : "Test mode is disabled"}
            </Typography>
            <Typography variant="secondary" className="text-xs">
              {isOn
                ? "All checkouts are bypassed and no real payments are processed."
                : "Checkouts will process real payments through Stripe."
              }
            </Typography>
          </div>
        </div>
        <Switch checked={isOn} onCheckedChange={handleToggle} />
      </div>

      {isOn && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {testModeBadges.map((label) => (
            <DesignBadge key={label} label={label} color="blue" size="sm" />
          ))}
        </div>
      )}
    </DesignCard>
  );
}
