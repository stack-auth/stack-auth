"use client";

import { Button, Typography } from "@/components/ui";
import { cn } from "@/lib/utils";
import { useAdminApp } from "../use-admin-app";

type ProgressBarProps = {
  value: number,
  max: number,
  color: "black" | "red" | "yellow",
  label: string,
};

function ProgressBar({ value, max, color, label }: ProgressBarProps) {
  const percentage = max > 0 ? Math.min((value / max) * 100, 100) : 0;

  const colorClasses = {
    black: "bg-black dark:bg-white",
    red: "bg-red-500",
    yellow: "bg-yellow-400",
  };

  return (
    <div className="space-y-1.5">
      <div className="h-3 w-full rounded-full bg-gray-300 dark:bg-zinc-600 border border-border overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all duration-300", colorClasses[color])}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <Typography variant="secondary" className="text-xs">
        {label}
      </Typography>
    </div>
  );
}

export function DomainReputationCard() {
  const stackAdminApp = useAdminApp();
  const deliveryInfo = stackAdminApp.useEmailDeliveryStats();

  // Calculate hourly capacity from rate_per_second
  const hourlyCapacity = deliveryInfo.capacity.rate_per_second * 3600;
  const hourlyUsed = deliveryInfo.stats.hour.sent;

  // Bounce rate (typically 5% max is considered acceptable)
  const totalSent = deliveryInfo.stats.hour.sent;
  const bounceCount = deliveryInfo.stats.hour.bounced;
  const bounceRate = totalSent > 0 ? (bounceCount / totalSent) * 100 : 0;
  const maxBounceRate = 5; // 5% max acceptable

  // Spam complaint rate (typically 0.1% max is considered acceptable)
  const spamCount = deliveryInfo.stats.hour.marked_as_spam;
  const spamRate = totalSent > 0 ? (spamCount / totalSent) * 100 : 0;
  const maxSpamRate = 0.1; // 0.1% max acceptable

  return (
    <div className="rounded-3xl border border-border p-6 min-h-[400px] w-72 flex flex-col">
      <Typography type="h3" className="font-semibold">
        Domain Reputation
      </Typography>
      <Typography variant="secondary" className="text-base mt-2">
        Warming up a domain & email server takes time, so Stack Auth automatically buffers your emails over time.
      </Typography>

      <div className="flex-1 flex flex-col justify-center gap-6 mt-6">
        {/* Email Capacity */}
        <div>
          <Typography className="text-base font-medium mb-2">Email Capacity</Typography>
          <ProgressBar
            value={hourlyUsed}
            max={hourlyCapacity}
            color="black"
            label={`${hourlyUsed} of ${Math.round(hourlyCapacity)}/h max`}
          />
          <Typography variant="secondary" className="text-xs mt-2">
            Send more emails to increase the email capacity available to you.
          </Typography>
          {/* TODO: Implement route to temporarily increase email capacity for ~1 hour */}
          <div className="flex justify-center mt-3">
            <Button
              className="bg-black hover:bg-zinc-700 text-zinc-400 font-medium px-4 py-2 text-sm transition-colors"
              onClick={() => {
                // TODO: Implement temporary capacity increase
              }}
            >
              Temporarily increase capacity
            </Button>
          </div>
        </div>

        {/* Bounce Rate */}
        <div>
          <Typography className="text-base font-medium mb-2">Bounce Rate</Typography>
          <ProgressBar
            value={bounceRate}
            max={maxBounceRate}
            color="red"
            label={`${bounceRate.toFixed(2)}% of ${maxBounceRate}% max`}
          />
        </div>

        {/* Spam Complaint */}
        <div>
          <Typography className="text-base font-medium mb-2">Spam Complaint</Typography>
          <ProgressBar
            value={spamRate}
            max={maxSpamRate}
            color="yellow"
            label={`${spamRate.toFixed(2)}% of ${maxSpamRate}% max`}
          />
        </div>
      </div>
    </div>
  );
}
