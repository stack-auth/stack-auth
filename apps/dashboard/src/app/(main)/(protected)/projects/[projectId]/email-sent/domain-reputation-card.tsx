"use client";

import { DesignButton } from "@/components/design-components/button";
import { DesignCard } from "@/components/design-components/card";
import { SimpleTooltip, Typography } from "@/components/ui";
import { cn } from "@/lib/utils";
import { Gauge } from "@phosphor-icons/react";
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { useEffect, useState } from "react";
import { useAdminApp } from "../use-admin-app";


type ProgressBarProps = {
  value: number,
  max: number,
  color: "black" | "red" | "striped-red" | "yellow",
  label: React.ReactNode,
  boosted?: boolean,
};

function ProgressBar({ value, max, color, label, boosted }: ProgressBarProps) {
  const percentage = max > 0 ? Math.min((value / max) * 100, 100) : 0;

  const colorClasses: Record<string, string> = {
    black: "bg-black dark:bg-white",
    red: "bg-red-500",
    yellow: "bg-yellow-400",
  };

  const isStripedRed = color === "striped-red";

  return (
    <div className="space-y-1.5">
      <div className="h-3 w-full rounded-full bg-gray-300 dark:bg-zinc-600 border border-border overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-300",
            boosted || isStripedRed ? "" : colorClasses[color]
          )}
          style={{
            width: `${percentage}%`,
            ...(boosted ? {
              background: "repeating-linear-gradient(45deg, #3b82f6, #3b82f6 10px, #2563eb 10px, #2563eb 20px)",
              backgroundSize: "28.28px 28.28px",
              animation: "stripe-move 1s linear infinite",
              boxShadow: "0 0 10px rgba(59, 130, 246, 0.5)",
            } : isStripedRed ? {
              background: "repeating-linear-gradient(45deg, #ef4444, #ef4444 4px, #fca5a5 4px, #fca5a5 8px)",
            } : {}),
          }}
        />
      </div>
      <Typography variant="secondary" className="text-xs">
        {label}
      </Typography>
      <style jsx>{`
        @keyframes stripe-move {
          from { background-position: 0 0; }
          to { background-position: 28.28px 0; }
        }
      `}</style>
    </div>
  );
}

function formatTimeRemaining(expiresAt: Date): string {
  const now = new Date();
  const diff = expiresAt.getTime() - now.getTime();

  if (diff <= 0) return "00:00:00";

  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((diff % (1000 * 60)) / 1000);

  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

function BoostCountdownTimer({ expiresAt, onExpire }: { expiresAt: Date, onExpire: () => void }) {
  const [timeRemaining, setTimeRemaining] = useState(formatTimeRemaining(expiresAt));

  useEffect(() => {
    const interval = setInterval(() => {
      const now = new Date();
      if (expiresAt <= now) {
        clearInterval(interval);
        onExpire();
        return;
      }
      setTimeRemaining(formatTimeRemaining(expiresAt));
    }, 1000);

    return () => clearInterval(interval);
  }, [expiresAt, onExpire]);

  // Bright glare effect rotating around the button border
  return (
    <div className="flex justify-center mt-3">
      <div className="boost-timer-wrapper relative rounded-lg">
        <div className="relative z-10 bg-zinc-900 rounded-md px-3 py-2 border border-zinc-700 min-w-[200px] flex items-center justify-center">
          <Typography className="text-slate-200 font-mono text-sm font-bold">
            {timeRemaining}
          </Typography>
        </div>
      </div>
      <style jsx>{`
        .boost-timer-wrapper {
          --border-angle: 0deg;
          position: relative;
          animation: pulse-scale 2s ease-in-out infinite;
        }
        @keyframes pulse-scale {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.05); }
        }
        .boost-timer-wrapper::before,
        .boost-timer-wrapper::after {
          content: '';
          position: absolute;
          inset: -1px;
          border-radius: 9px;
          background: conic-gradient(
            from var(--border-angle),
            transparent 0%,
            transparent 70%,
            #1e3a5f 78%,
            #3b82f6 84%,
            #60a5fa 88%,
            #93c5fd 90%,
            #60a5fa 92%,
            #3b82f6 96%,
            #1e3a5f 100%
          );
          animation: rotate-glow 3s linear infinite;
        }
        .boost-timer-wrapper::after {
          filter: blur(15px);
          opacity: 0.9;
        }
        @property --border-angle {
          syntax: '<angle>';
          initial-value: 0deg;
          inherits: false;
        }
        @keyframes rotate-glow {
          from { --border-angle: 0deg; }
          to { --border-angle: 360deg; }
        }
      `}</style>
    </div>
  );
}

export function DomainReputationCard() {
  const stackAdminApp = useAdminApp();
  const deliveryInfo = stackAdminApp.useEmailDeliveryStats();

  const isBoostActive = deliveryInfo.capacity.is_boost_active;
  const boostExpiresAt = deliveryInfo.capacity.boost_expires_at
    ? new Date(deliveryInfo.capacity.boost_expires_at)
    : null;

  // Calculate hourly capacity from rate_per_second
  const hourlyCapacity = deliveryInfo.capacity.rate_per_second * 3600;
  const baseHourlyCapacity = hourlyCapacity / deliveryInfo.capacity.boost_multiplier;
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

  const handleActivateBoost = async () => {
    await stackAdminApp.activateEmailCapacityBoost();
  };

  // Capacity label with strikethrough when boosted
  const capacityLabel = isBoostActive ? (
    <span>
      {hourlyUsed} of{" "}
      <span className="text-red-500 line-through">{Math.round(baseHourlyCapacity)}</span>
      {" "}
      <span className="text-blue-500 font-medium">{Math.round(hourlyCapacity)}</span>
      /h max
    </span>
  ) : (
    `${hourlyUsed} of ${Math.round(hourlyCapacity)}/h max`
  );

  return (
    <DesignCard
      title="Domain Reputation"
      subtitle="Warming up a domain & email server takes time, so Stack Auth automatically buffers your emails over time."
      icon={Gauge}
      gradient="default"
      glassmorphic
      className="min-h-[400px] w-72"
    >
      <div className="flex flex-col gap-6">
        {/* Email Capacity */}
        <div>
          <Typography className="text-base font-medium mb-2">Email Capacity</Typography>
          <ProgressBar
            value={hourlyUsed}
            max={hourlyCapacity}
            color="black"
            label={capacityLabel}
            boosted={isBoostActive}
          />
          {isBoostActive && boostExpiresAt ? (
            <BoostCountdownTimer
              expiresAt={boostExpiresAt}
              onExpire={() => runAsynchronouslyWithAlert(stackAdminApp.refreshEmailDeliveryStats())}
            />
          ) : (
            <div className="flex justify-center mt-3">
              <DesignButton
                variant="default"
                size="sm"
                className="min-w-[200px]"
                onClick={handleActivateBoost}
              >
                Temporarily increase capacity
              </DesignButton>
            </div>
          )}
        </div>

        {/* Bounce Rate */}
        <div>
          <div className="flex items-center gap-1 mb-2">
            <Typography className="text-base font-medium">Bounce Rate</Typography>
            <SimpleTooltip
              type="info"
              tooltip="Percentage of emails that couldn't be delivered. High bounce rates can hurt your sender reputation and deliverability."
            />
          </div>
          <ProgressBar
            value={bounceRate}
            max={maxBounceRate}
            color="striped-red"
            label={`${bounceRate.toFixed(2)}% of ${maxBounceRate}% max`}
          />
        </div>

        {/* Spam Complaint */}
        <div>
          <div className="flex items-center gap-1 mb-2">
            <Typography className="text-base font-medium">Spam Complaint</Typography>
            <SimpleTooltip
              type="info"
              tooltip="Percentage of recipients who marked your emails as spam. Keep this low to maintain good deliverability."
            />
          </div>
          <ProgressBar
            value={spamRate}
            max={maxSpamRate}
            color="yellow"
            label={`${spamRate.toFixed(2)}% of ${maxSpamRate}% max`}
          />
        </div>
      </div>
    </DesignCard>
  );
}
