"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Blast = {
  id: number,
  x: number,
  y: number,
  size: number,
  hue: number,
};

const BLAST_LIFETIME_MS = 720;
const MAX_ACTIVE_BLASTS = 18;

/** Minimum rapid clicks in the time window to count as a rage click */
const RAGE_CLICK_THRESHOLD = 3;
/** Time window (ms) in which clicks must occur to be considered rage clicking */
const RAGE_CLICK_WINDOW_MS = 600;
/** Max distance (px) between clicks to still count as same-spot rage clicking */
const RAGE_CLICK_RADIUS_PX = 60;

type RecentClick = {
  time: number,
  x: number,
  y: number,
};

export function CursorBlastEffect() {
  const [blasts, setBlasts] = useState<Blast[]>([]);
  const [mounted, setMounted] = useState(false);
  const idCounterRef = useRef(0);
  const timeoutIdsRef = useRef<Map<number, number>>(new Map());
  const recentClicksRef = useRef<RecentClick[]>([]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const removeBlast = (id: number) => {
      setBlasts((prev) => prev.filter((blast) => blast.id !== id));
      const timeoutId = timeoutIdsRef.current.get(id);
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
        timeoutIdsRef.current.delete(id);
      }
    };

    const spawnBlast = (x: number, y: number) => {
      const nextId = idCounterRef.current;
      idCounterRef.current += 1;

      const nextBlast: Blast = {
        id: nextId,
        x,
        y,
        size: 44 + Math.random() * 20,
        hue: 185 + Math.random() * 35,
      };

      setBlasts((prev) => {
        const next = [...prev, nextBlast];
        if (next.length <= MAX_ACTIVE_BLASTS) {
          return next;
        }
        return next.slice(next.length - MAX_ACTIVE_BLASTS);
      });

      const timeoutId = window.setTimeout(() => removeBlast(nextId), BLAST_LIFETIME_MS);
      timeoutIdsRef.current.set(nextId, timeoutId);
    };

    const onClick = (event: MouseEvent) => {
      const now = performance.now();
      const x = event.clientX;
      const y = event.clientY;

      // Prune clicks outside the time window
      recentClicksRef.current = recentClicksRef.current.filter(
        (click) => now - click.time < RAGE_CLICK_WINDOW_MS,
      );

      recentClicksRef.current.push({ time: now, x, y });

      // Count how many recent clicks are within the radius of the current click
      const nearbyCount = recentClicksRef.current.filter((click) => {
        const dx = click.x - x;
        const dy = click.y - y;
        return Math.sqrt(dx * dx + dy * dy) <= RAGE_CLICK_RADIUS_PX;
      }).length;

      if (nearbyCount >= RAGE_CLICK_THRESHOLD) {
        spawnBlast(x, y);
      }
    };

    window.addEventListener("click", onClick);
    return () => {
      window.removeEventListener("click", onClick);
      for (const timeoutId of timeoutIdsRef.current.values()) {
        window.clearTimeout(timeoutId);
      }
      timeoutIdsRef.current.clear();
    };
  }, []);

  if (!mounted) {
    return null;
  }

  return createPortal(
    <div
      aria-hidden
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2147483647,
        pointerEvents: "none",
      }}
    >
      {blasts.map((blast) => (
        <div
          key={blast.id}
          style={{
            position: "absolute",
            left: blast.x,
            top: blast.y,
            width: blast.size,
            height: blast.size,
            transform: "translate(-50%, -50%)",
            willChange: "transform, opacity",
            filter: `hue-rotate(${blast.hue}deg)`,
          }}
        >
          <span className="cursor-blast-ring" />
          <span className="cursor-blast-core" />
          {Array.from({ length: 10 }).map((_, index) => {
            const angle = (360 / 10) * index;
            return (
              <span
                key={`${blast.id}-${index}`}
                className="cursor-blast-shard-wrap"
                style={{
                  transform: `translate(-50%, -50%) rotate(${angle}deg)`,
                  animationDelay: `${index * 16}ms`,
                }}
              >
                <span className="cursor-blast-shard" />
              </span>
            );
          })}
        </div>
      ))}
      <style jsx>{`
        .cursor-blast-ring {
          position: absolute;
          inset: 0;
          border-radius: 999px;
          border: 2px solid hsl(197 98% 67% / 0.9);
          box-shadow:
            0 0 22px hsl(191 100% 72% / 0.6),
            inset 0 0 12px hsl(204 100% 77% / 0.65);
          animation: blast-ring 560ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }

        .cursor-blast-core {
          position: absolute;
          left: 50%;
          top: 50%;
          width: 10px;
          height: 10px;
          border-radius: 999px;
          transform: translate(-50%, -50%);
          background: hsl(196 100% 85%);
          box-shadow:
            0 0 26px hsl(193 100% 72% / 0.9),
            0 0 10px hsl(201 100% 85% / 0.9);
          animation: blast-core 420ms ease-out forwards;
        }

        .cursor-blast-shard-wrap {
          position: absolute;
          left: 50%;
          top: 50%;
          width: 0;
          height: 0;
        }

        .cursor-blast-shard {
          position: absolute;
          left: 0;
          top: -1.5px;
          width: 12px;
          height: 3px;
          border-radius: 999px;
          background: linear-gradient(90deg, hsl(190 100% 84%), hsl(197 98% 67%));
          box-shadow: 0 0 12px hsl(195 100% 70% / 0.8);
          animation: blast-shard 680ms cubic-bezier(0.22, 1, 0.36, 1) forwards;
        }

        @keyframes blast-ring {
          0% {
            transform: scale(0.2);
            opacity: 0.95;
          }
          100% {
            transform: scale(1.6);
            opacity: 0;
          }
        }

        @keyframes blast-core {
          0% {
            transform: translate(-50%, -50%) scale(0.5);
            opacity: 1;
          }
          100% {
            transform: translate(-50%, -50%) scale(2.2);
            opacity: 0;
          }
        }

        @keyframes blast-shard {
          0% {
            transform: translateX(0) scaleX(0.7);
            opacity: 1;
          }
          100% {
            transform: translateX(46px) scaleX(1.1);
            opacity: 0;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .cursor-blast-ring,
          .cursor-blast-core,
          .cursor-blast-shard {
            animation-duration: 1ms;
          }
        }
      `}</style>
    </div>,
    document.body,
  );
}
