import { getPublicEnvVar } from "@/lib/env";
import { parseJson } from "@stackframe/stack-shared/dist/utils/json";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function devFeaturesEnabledForProject(projectId: string) {
  if (projectId === "internal") {
    return true;
  }
  const allowedProjectIds = parseJson(getPublicEnvVar("NEXT_PUBLIC_STACK_ENABLE_DEVELOPMENT_FEATURES_PROJECT_IDS") || "[]");
  if (allowedProjectIds.status !== "ok" || !Array.isArray(allowedProjectIds.data)) {
    return false;
  }
  return allowedProjectIds.data.includes(projectId);
}
