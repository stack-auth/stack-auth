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

const CONFETTI_COLORS = ["#ff6b6b", "#ffd93d", "#6bcb77", "#4d96ff", "#9b59b6", "#ff85a2", "#00d2d3"];
const PARTICLE_COUNT = 24;

function buildConfettiKeyframes(): string {
  let css = "";
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const angleRad = (i / PARTICLE_COUNT) * 2 * Math.PI;
    const radius = 50 + (i % 5) * 12;
    const dx = Math.cos(angleRad) * radius;
    const dy = Math.sin(angleRad) * (radius * 0.7);
    const spin = (i * 47) % 360;
    css += `
      @keyframes boost-confetti-${i} {
        0% { opacity: 0; transform: translate(-50%, -50%) rotate(0deg); }
        8% { opacity: 0.8; }
        100% { opacity: 0; transform: translate(calc(-50% + ${dx.toFixed(1)}px), calc(-50% + ${dy.toFixed(1)}px)) rotate(${spin}deg); }
      }
    `;
  }
  return css;
}

const confettiKeyframesCSS = buildConfettiKeyframes();

function BoostConfetti() {
  return (
    <>
      {/* eslint-disable-next-line react/no-danger -- static CSS keyframes for confetti particle animations, no user input */}
      <style dangerouslySetInnerHTML={{ __html: confettiKeyframesCSS }} />
      {Array.from({ length: PARTICLE_COUNT }, (_, i) => {
        const color = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
        const size = 3 + (i % 3);
        const isSquare = i % 3 === 0;
        const duration = 2.5 + (i % 4) * 0.5;
        const delay = (i * 0.25) % duration;

        return (
          <div
            key={i}
            className="absolute pointer-events-none"
            style={{
              width: size,
              height: isSquare ? size : size * 0.6,
              backgroundColor: color,
              borderRadius: isSquare ? 1 : size,
              left: "50%",
              top: "50%",
              opacity: 0,
              animation: `boost-confetti-${i} ${duration}s ease-out ${delay}s infinite`,
            }}
          />
        );
      })}
    </>
  );
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

  return (
    <div className="flex justify-center mt-3">
      <div className="boost-timer-wrapper relative rounded-lg">
        <BoostConfetti />
        <div className="relative z-10 rounded-md px-3 py-2 border border-white/10 min-w-[200px] overflow-hidden">
          <div
            className="absolute inset-0 rounded-md"
            style={{
              background: "linear-gradient(135deg, #ff6b6b, #ffd93d, #6bcb77, #4d96ff, #9b59b6, #ff85a2, #ff6b6b)",
            }}
          />
          <div className="absolute inset-0 rounded-md bg-zinc-900/[0.82]" />
          <div className="relative flex flex-col items-center justify-center gap-0.5">
            <span className="text-[9px] font-semibold uppercase tracking-[0.15em] text-white/50">
              Capacity boosted for
            </span>
            <Typography className="text-white font-mono text-sm font-bold drop-shadow-[0_0_4px_rgba(255,255,255,0.3)]">
              {timeRemaining}
            </Typography>
          </div>
        </div>
      </div>
      <style jsx>{`
        .boost-timer-wrapper {
          --border-angle: 0deg;
          position: relative;
          overflow: visible;
        }
        .boost-timer-wrapper::before,
        .boost-timer-wrapper::after {
          content: '';
          position: absolute;
          inset: -2px;
          border-radius: 9px;
          background: conic-gradient(
            from var(--border-angle),
            #ff6b6b,
            #ffd93d,
            #6bcb77,
            #4d96ff,
            #9b59b6,
            #ff85a2,
            #ff6b6b
          );
          animation: rotate-glow 3s linear infinite;
        }
        .boost-timer-wrapper::after {
          filter: blur(12px);
          opacity: 0.7;
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
      gradient="default"
      glassmorphic
      className="w-72"
    >
      <div className="flex items-center gap-2 mb-3">
        <div className="p-1 rounded-md bg-foreground/[0.06] dark:bg-foreground/[0.04]">
          <Gauge className="h-3 w-3 text-foreground/70 dark:text-muted-foreground" />
        </div>
        <span className="text-xs font-semibold text-foreground uppercase tracking-wider">
          Domain Reputation
        </span>
      </div>
      <div className="flex flex-col gap-4">
        {/* Email Capacity */}
        <div>
          <Typography className="text-sm font-medium mb-1">Email Capacity</Typography>
          <Typography variant="secondary" className="text-[11px] mb-1.5">Stack Auth automatically buffers your emails as your domain warms up.</Typography>
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
          <div className="flex items-center gap-1 mb-1.5">
            <Typography className="text-sm font-medium">Bounce Rate</Typography>
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
          <div className="flex items-center gap-1 mb-1.5">
            <Typography className="text-sm font-medium">Spam Complaint</Typography>
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
