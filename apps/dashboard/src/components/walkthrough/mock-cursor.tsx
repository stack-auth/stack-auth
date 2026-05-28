import { cn } from '@/lib/utils';
import type { WalkthroughPhase } from './walkthrough-steps';

export function MockCursor({
  className,
  phase,
}: {
  className?: string,
  phase?: WalkthroughPhase,
}) {
  return (
    <div className="relative">
      {phase === 'dwelling' && (
        <span
          className={cn(
            "absolute -top-1 -left-1 h-8 w-8 rounded-full",
            "border-2 border-blue-500",
            "animate-[walkthrough-pulse-ring_1.4s_ease-out_infinite]",
          )}
          aria-hidden
        />
      )}
      <svg
        width="28"
        height="28"
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={className}
        style={{ filter: 'drop-shadow(2px 2px 0 rgba(0,0,0,0.85))' }}
      >
        <path
          d="M5 3L19 12L12 13L9 20L5 3Z"
          fill="white"
          stroke="#171717"
          strokeWidth="1.75"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
