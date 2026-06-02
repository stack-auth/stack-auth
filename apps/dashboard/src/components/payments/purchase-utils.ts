export function shortenedInterval(interval: [number, string]): string {
  if (interval[0] === 1) {
    return interval[1];
  }
  return `${interval[0]} ${interval[1]}s`;
}

export function getPriceLabel(interval: [number, string] | undefined): string {
  if (!interval) {
    return "One-time";
  }
  const [count, unit] = interval;

  if (count === 1) {
    if (unit === "day") {
      return "Daily";
    } else if (unit === "week") {
      return "Weekly";
    } else if (unit === "month") {
      return "Monthly";
    } else if (unit === "year") {
      return "Yearly";
    } else {
      return `Every ${unit}`;
    }
  }

  if (unit === "day") {
    return `Every ${count} days`;
  } else if (unit === "week") {
    return `Once every ${count} weeks`;
  } else if (unit === "month") {
    return `Every ${count} months`;
  } else if (unit === "year") {
    return `Every ${count} years`;
  } else {
    return `Every ${count} ${unit}s`;
  }
}

export function isFreePrice(usd: string | undefined): boolean {
  if (usd == null || usd.trim() === "") {
    return false;
  }

  const usdAmount = Number(usd);
  return Number.isFinite(usdAmount) && usdAmount === 0;
}
