export function easeOutCubic(progress: number): number {
  return 1 - Math.pow(1 - progress, 3);
}

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
