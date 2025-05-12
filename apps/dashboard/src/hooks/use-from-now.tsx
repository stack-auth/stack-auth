import { useEffect, useState } from "react";
import { fromNowDetailed } from "@stackframe/stack-shared/dist/utils/dates";

export function useFromNow(date: Date): string {
  const [invalidationCounter, setInvalidationCounter] = useState(0);

  const detailed = fromNowDetailed(date);

  useEffect(() => {
    // setTimeout breaks at ~25 days due to an integer overflow, also it breaks if the number is Infinity
    // so, only update the date if it's within the next 20 days
    // https://stackoverflow.com/questions/3468607/why-does-settimeout-break-for-large-millisecond-delay-values
    if (detailed.secondsUntilChange < 20 * 24 * 60 * 60) {
      const timeout = setTimeout(() => {
        setInvalidationCounter(invalidationCounter + 1);
      }, Math.round(detailed.secondsUntilChange * 1000));
      return () => clearTimeout(timeout);
    }
  }, [invalidationCounter, detailed.secondsUntilChange]);

  return detailed.result;
}
