"use client";

import { Typography } from "@/components/ui";
import { cn } from "@/lib/utils";
import { DesignBadge, DesignButton, DesignCard } from "@/components/design-components";
import { ArrowRightIcon, CheckCircleIcon, PlugsConnectedIcon, WarningCircleIcon, XCircleIcon } from "@phosphor-icons/react";
import { wait } from "@stackframe/stack-shared/dist/utils/promises";
import { useAdminApp } from "../../use-admin-app";

type StatusVariant = "success" | "warning" | "error";

const statusBadgeColor: Record<StatusVariant, "green" | "orange" | "red"> = {
  success: "green",
  warning: "orange",
  error: "red",
};

const statusIconClasses: Record<StatusVariant, string> = {
  success: "bg-emerald-500/10 text-emerald-600 dark:bg-emerald-400/10 dark:text-emerald-400 ring-1 ring-emerald-500/20",
  warning: "bg-amber-500/10 text-amber-600 dark:bg-amber-400/10 dark:text-amber-400 ring-1 ring-amber-500/20",
  error: "bg-red-500/10 text-red-600 dark:bg-red-400/10 dark:text-red-400 ring-1 ring-red-500/20",
};

function StatusRow({
  variant,
  icon: Icon,
  title,
  description,
  badges,
  action,
}: {
  variant: StatusVariant,
  icon: React.ElementType,
  title: string,
  description: string,
  badges?: string[],
  action?: React.ReactNode,
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex items-start gap-3 min-w-0">
        <div className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
          statusIconClasses[variant]
        )}>
          <Icon className="h-4 w-4" weight="duotone" />
        </div>
        <div className="space-y-1 min-w-0">
          <Typography className="text-sm font-medium text-foreground">{title}</Typography>
          <Typography variant="secondary" className="text-xs">
            {description}
          </Typography>
          {badges && badges.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {badges.map((label) => (
                <DesignBadge key={label} label={label} color={statusBadgeColor[variant]} size="sm" />
              ))}
            </div>
          )}
        </div>
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  );
}

export function StripeConnectionCheck() {
  const adminApp = useAdminApp();
  const stripeAccountInfo = adminApp.useStripeAccountInfo();

  const setupPayments = async () => {
    const { url } = await adminApp.setupPayments();
    window.location.href = url;
    await wait(2000);
  };

  if (!stripeAccountInfo) {
    return (
      <DesignCard
        title="Stripe Connection"
        subtitle="Connect your Stripe account to accept payments."
        icon={PlugsConnectedIcon}
        gradient="default"
      >
        <StatusRow
          variant="error"
          icon={XCircleIcon}
          title="Not connected"
          description="Set up Stripe to start accepting payments."
          action={
            <DesignButton onClick={setupPayments} size="sm" className="gap-1.5">
              <span>Connect Stripe</span>
              <ArrowRightIcon className="h-3.5 w-3.5" />
            </DesignButton>
          }
        />
      </DesignCard>
    );
  }

  if (!stripeAccountInfo.details_submitted) {
    const missingCapabilities = [
      ...(!stripeAccountInfo.charges_enabled ? ["Charge customers"] : []),
      ...(!stripeAccountInfo.payouts_enabled ? ["Receive payouts"] : []),
    ];

    return (
      <DesignCard
        title="Stripe Connection"
        subtitle="Your Stripe account connection status."
        icon={PlugsConnectedIcon}
        gradient="orange"
      >
        <StatusRow
          variant="warning"
          icon={WarningCircleIcon}
          title="Setup incomplete"
          description="Complete onboarding to unlock full capabilities."
          badges={missingCapabilities}
          action={
            <DesignButton onClick={setupPayments} size="sm" variant="outline" className="gap-1.5">
              <span>Continue setup</span>
              <ArrowRightIcon className="h-3.5 w-3.5" />
            </DesignButton>
          }
        />
      </DesignCard>
    );
  }

  const enabledCapabilities = [
    ...(stripeAccountInfo.charges_enabled ? ["Charges enabled"] : []),
    ...(stripeAccountInfo.payouts_enabled ? ["Payouts enabled"] : []),
  ];

  return (
    <DesignCard
      title="Stripe Connection"
      subtitle="Your Stripe account connection status."
      icon={PlugsConnectedIcon}
      gradient="green"
    >
      <StatusRow
        variant="success"
        icon={CheckCircleIcon}
        title="Connected"
        description="Your Stripe account is fully set up and ready to accept payments."
        badges={enabledCapabilities}
      />
    </DesignCard>
  );
}
