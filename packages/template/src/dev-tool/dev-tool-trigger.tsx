"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";

// IF_PLATFORM react-like

const STORAGE_KEY = "stack-devtool-trigger-position";
const DRAG_THRESHOLD = 5;

type Position = { left: number; top: number };

function getDefaultPosition(): Position {
  if (typeof window === "undefined") return { left: 0, top: 0 };
  return {
    left: window.innerWidth - 76 - 16,
    top: window.innerHeight - 36 - 16,
  };
}

function loadPosition(): Position | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw == null) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed.left === "number" && typeof parsed.top === "number") {
      return parsed as Position;
    }
  } catch {
    // corrupted data
  }
  return null;
}

function savePosition(pos: Position) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pos));
  } catch {
    // storage full or unavailable
  }
}

function clampToViewport(pos: Position, elWidth: number, elHeight: number): Position {
  return {
    left: Math.max(0, Math.min(pos.left, window.innerWidth - elWidth)),
    top: Math.max(0, Math.min(pos.top, window.innerHeight - elHeight)),
  };
}

export function DevToolTrigger({ onClick }: { onClick: () => void }) {
  const [position, setPosition] = useState<Position>(
    () => loadPosition() ?? getDefaultPosition()
  );
  const positionRef = useRef(position);
  positionRef.current = position;

  const buttonRef = useRef<HTMLButtonElement>(null);
  const dragState = useRef<{
    startX: number;
    startY: number;
    startLeft: number;
    startTop: number;
    didDrag: boolean;
  } | null>(null);

  useEffect(() => {
    const stored = loadPosition();
    if (stored != null && buttonRef.current != null) {
      const rect = buttonRef.current.getBoundingClientRect();
      setPosition(clampToViewport(stored, rect.width, rect.height));
    }
  }, []);

  useEffect(() => {
    const handleResize = () => {
      if (buttonRef.current == null) return;
      const rect = buttonRef.current.getBoundingClientRect();
      setPosition((prev) => {
        const clamped = clampToViewport(prev, rect.width, rect.height);
        if (clamped.left !== prev.left || clamped.top !== prev.top) {
          savePosition(clamped);
          return clamped;
        }
        return prev;
      });
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const pos = positionRef.current;
    dragState.current = {
      startX: e.clientX,
      startY: e.clientY,
      startLeft: pos.left,
      startTop: pos.top,
      didDrag: false,
    };
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    const ds = dragState.current;
    if (ds == null) return;

    const dx = e.clientX - ds.startX;
    const dy = e.clientY - ds.startY;

    if (!ds.didDrag && Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return;
    ds.didDrag = true;

    const el = buttonRef.current;
    if (el == null) return;
    const rect = el.getBoundingClientRect();
    const newPos = clampToViewport(
      { left: ds.startLeft + dx, top: ds.startTop + dy },
      rect.width,
      rect.height,
    );
    setPosition(newPos);
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    const ds = dragState.current;
    dragState.current = null;

    if (ds == null) return;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);

    if (ds.didDrag) {
      savePosition(positionRef.current);
    } else {
      onClick();
    }
  }, [onClick]);

  return (
    <button
      ref={buttonRef}
      className="sdt-trigger"
      style={{ left: position.left, top: position.top }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      aria-label="Toggle Stack Auth Dev Tools"
      title="Stack Auth Dev Tools"
    >
      <span className="sdt-trigger-logo">
        <svg width="14" height="17" viewBox="0 0 131 156" fill="currentColor">
          <path d="M124.447 28.6459L70.1382 1.75616C67.3472 0.374284 64.0715 0.372197 61.279 1.75051L0.740967 31.6281V87.6369L65.7101 119.91L117.56 93.675V112.414L65.7101 138.44L0.740967 106.584V119.655C0.740967 122.359 2.28151 124.827 4.71097 126.015L62.282 154.161C65.0966 155.538 68.3938 155.515 71.1888 154.099L130.47 124.074V79.7105C130.47 74.8003 125.34 71.5769 120.915 73.7077L79.4531 93.675V75.9771L130.47 50.1589V38.3485C130.47 34.2325 128.137 30.4724 124.447 28.6459Z" />
        </svg>
      </span>
      <span className="sdt-trigger-text">DEV</span>
    </button>
  );
}

// END_PLATFORM
