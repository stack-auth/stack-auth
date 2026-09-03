import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Same `cn` as the dashboard and the observability reference: later classes win over earlier ones. */
export function cn(...classes: ClassValue[]): string {
  return twMerge(clsx(classes));
}
