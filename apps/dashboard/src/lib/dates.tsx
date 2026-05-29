import { Interval } from "@hexclave/shared/dist/utils/dates";

export function readableInterval(interval: Interval | "never"): string {
  if (interval === "never") {
    return "Never";
  }
  const [amount, unit] = interval;
  if (amount === 1) {
    return unit;
  }
  return `${amount} ${unit}s`;
}
