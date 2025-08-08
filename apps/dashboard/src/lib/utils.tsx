import { getPublicEnvVar } from "@/lib/env";
import { clsx, type ClassValue } from "clsx";
import { redirect } from "next/navigation";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function redirectToProjectIfEmulator() {
  const isEmulator = getPublicEnvVar("NEXT_PUBLIC_STACK_EMULATOR_ENABLED") === 'true';
  const projectId = getPublicEnvVar("NEXT_PUBLIC_STACK_EMULATOR_PROJECT_ID");

  if (isEmulator && projectId) {
    redirect(`/projects/${projectId}`);
  }
}

export function devFeaturesEnabledForProject(projectId: string) {
  const allowedProjectIds = JSON.parse(getPublicEnvVar("NEXT_PUBLIC_STACK_ENABLE_DEVELOPMENT_FEATURES_PROJECT_IDS") || "[]");
  return allowedProjectIds.includes(projectId) || projectId === "internal";
}
