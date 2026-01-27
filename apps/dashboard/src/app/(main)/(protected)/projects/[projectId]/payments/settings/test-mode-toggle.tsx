"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle, Switch, Typography } from "@/components/ui";
import { useUpdateConfig } from "@/lib/config-update";
import { cn } from "@/lib/utils";
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Test Mode</CardTitle>
        <CardDescription>
          Switch between test and live payment environments.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between">
          <div className="flex items-start gap-3">
            <div className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
              paymentsConfig.testMode
                ? "bg-blue-500/15 dark:bg-blue-400/15"
                : "bg-muted"
            )}>
              <FlaskIcon className={cn(
                "h-4 w-4",
                paymentsConfig.testMode
                  ? "text-blue-600 dark:text-blue-400"
                  : "text-muted-foreground"
              )} />
            </div>
            <div className="space-y-1">
              <Typography className="font-medium">
                {paymentsConfig.testMode ? "Test mode is active" : "Test mode is disabled"}
              </Typography>
              <Typography variant="secondary" className="text-sm">
                {paymentsConfig.testMode
                  ? "All checkouts are bypassed and no real payments are processed."
                  : "Checkouts will process real payments through Stripe."
                }
              </Typography>
            </div>
          </div>
          <Switch
            checked={paymentsConfig.testMode}
            onCheckedChange={handleToggle}
          />
        </div>

        {paymentsConfig.testMode && (
          <div className="mt-4 flex flex-wrap gap-2">
            {[
              "No credit card required",
              "Products granted instantly",
              "No Stripe transactions",
            ].map((item) => (
              <span
                key={item}
                className={cn(
                  "inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium",
                  "bg-blue-500/10 dark:bg-blue-400/15",
                  "text-blue-700 dark:text-blue-300",
                  "ring-1 ring-blue-500/20 dark:ring-blue-400/20"
                )}
              >
                {item}
              </span>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
