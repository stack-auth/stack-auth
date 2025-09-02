import { useLayoutEffect } from "react";
import { useRefState } from "../utils/react";

export function useHover<T extends HTMLElement>(
  ref: React.RefObject<T>,
  options: {
    onMouseEnter?: () => void,
    onMouseLeave?: () => void,
  } = {},
): boolean {
  // Internal counter: mouseenter++ / mouseleave-- (isHovering = counter > 0)
  const counter = useRefState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let incr = 0;
    let prevInside = false;

    const contains = (r: DOMRect, x: number, y: number) =>
      x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;

    const enter = () => {
      incr++;
      counter.set(c => c + 1);
      if (counter.current === 1) {
        options.onMouseEnter?.();
      }
    };

    const leave = () => {
      incr--;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          counter.set(c => c - 1);
          if (counter.current === 0) {
            options.onMouseLeave?.();
          }
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
      if (inside && !prevInside) {
        enter();
      } else if (!inside && prevInside) {
        leave();
      }
      prevInside = inside;
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
      counter.set(c => c - incr);
    };
  }, []);

  return counter.current > 0;
}
