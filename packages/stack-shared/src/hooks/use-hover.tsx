import { useLayoutEffect, useRef, useState } from "react";

export function useHover<T extends HTMLElement>(
  ref: React.RefObject<T>
): boolean {
  // Internal counter: mouseenter++ / mouseleave-- (isHovering = counter > 0)
  const [counter, setCounter] = useState(0);
  const prevInside = useRef(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let incr = 0;

    const contains = (r: DOMRect, x: number, y: number) =>
      x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;

    // Liang–Barsky line-vs-rect intersection
    const segIntersectsRect = (
      p0: { x: number, y: number },
      p1: { x: number, y: number },
      r: DOMRect
    ) => {
      const inside = (p: { x: number, y: number }) => contains(r, p.x, p.y);
      if (inside(p0) || inside(p1)) return true;

      let t0 = 0,
        t1 = 1;
      const dx = p1.x - p0.x;
      const dy = p1.y - p0.y;
      const clip = (p: number, q: number) => {
        if (p === 0) return q >= 0;
        const t = q / p;
        if (p < 0) {
          if (t > t1) return false;
          if (t > t0) t0 = t;
        } else {
          if (t < t0) return false;
          if (t < t1) t1 = t;
        }
        return true;
      };

      return (
        clip(-dx, p0.x - r.left) &&
        clip(dx, r.right - p0.x) &&
        clip(-dy, p0.y - r.top) &&
        clip(dy, r.bottom - p0.y) &&
        t0 <= t1
      );
    };

    const enter = () => {
      console.log("enter");
      incr++;
      setCounter(prev => prev + 1);
    };

    const leave = () => {
      console.log("leave");
      incr--;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setCounter(prev => prev - 1);
        });
      });
    };

    const topMatchesTarget = (x: number, y: number) => {
      const top = document.elementFromPoint(x, y);
      return !!(top && (top === el || el.contains(top)));
    };

    const processPoint = (x: number, y: number) => {
      const rect = el.getBoundingClientRect();

      // True “hoverability”: inside rect AND not occluded by others
      const inside = contains(rect, x, y) && topMatchesTarget(x, y);

      if (inside && !prevInside.current) {
        enter();
      } else if (!inside && prevInside.current) {
        leave();
      }
      prevInside.current = inside;
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return; // keep it hover-only
      // Use coalesced points when available
      const batch = e.getCoalescedEvents();
      if (batch.length) {
        for (let eventIndex = 0; eventIndex < batch.length - 1; eventIndex++) {
          const e1 = batch[eventIndex];
          const e2 = batch[eventIndex + 1];
          const steps = 10;
          for (let i = 0; i <= steps; i++) {
            processPoint(e1.clientX + (e2.clientX - e1.clientX) * i / steps, e1.clientY + (e2.clientY - e1.clientY) * i / steps);
          }
        }
      } else {
        processPoint(e.clientX, e.clientY);
      }
    };

    window.addEventListener("pointermove", onMove, { passive: true });

    return () => {
      window.removeEventListener("pointermove", onMove);
      setCounter(c => c - incr);
    };
  }, []);

  return counter > 0;
}
