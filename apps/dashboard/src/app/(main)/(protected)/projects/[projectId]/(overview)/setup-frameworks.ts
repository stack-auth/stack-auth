import type { EnvSnippetPreset } from "@/components/env-keys";

export type SetupFrameworkId =
  | "nextjs"
  | "react-router"
  | "tanstack-start"
  | "nuxt"
  | "sveltekit"
  | "nestjs"
  | "express"
  | "hono"
  | "cloudflare-workers";

export type SetupFrameworkGroupId = "react-apps" | "full-stack-js" | "server-edge";

export type SetupFramework = {
  id: SetupFrameworkId,
  name: string,
  packageName: "@stackframe/stack" | "@stackframe/react" | "@stackframe/js",
  groupId: SetupFrameworkGroupId,
  imgSrc: string,
  reverseIfDark: boolean,
  envPreset: EnvSnippetPreset | null,
  usesStackHandler: boolean,
  usesProviders: boolean,
};

export type SetupFrameworkGroup = {
  id: SetupFrameworkGroupId,
  name: string,
  frameworkIds: SetupFrameworkId[],
};

export const setupFrameworks: Record<SetupFrameworkId, SetupFramework> = {
  nextjs: {
    id: "nextjs",
    name: "Next.js",
    packageName: "@stackframe/stack",
    groupId: "react-apps",
    imgSrc: "/next-logo.svg",
    reverseIfDark: true,
    envPreset: "nextjs",
    usesStackHandler: true,
    usesProviders: true,
  },
  "react-router": {
    id: "react-router",
    name: "React Router",
    packageName: "@stackframe/react",
    groupId: "react-apps",
    imgSrc: "/react-router-logo.svg",
    reverseIfDark: true,
    envPreset: "vite",
    usesStackHandler: true,
    usesProviders: true,
  },
  "tanstack-start": {
    id: "tanstack-start",
    name: "TanStack Start",
    packageName: "@stackframe/react",
    groupId: "react-apps",
    imgSrc: "/tanstack-start-logo.svg",
    reverseIfDark: true,
    envPreset: "vite",
    usesStackHandler: true,
    usesProviders: true,
  },
  nuxt: {
    id: "nuxt",
    name: "Nuxt",
    packageName: "@stackframe/js",
    groupId: "full-stack-js",
    imgSrc: "/nuxt-logo.svg",
    reverseIfDark: true,
    envPreset: "nuxt",
    usesStackHandler: false,
    usesProviders: false,
  },
  sveltekit: {
    id: "sveltekit",
    name: "SvelteKit",
    packageName: "@stackframe/js",
    groupId: "full-stack-js",
    imgSrc: "/sveltekit-logo.svg",
    reverseIfDark: true,
    envPreset: "sveltekit",
    usesStackHandler: false,
    usesProviders: false,
  },
  nestjs: {
    id: "nestjs",
    name: "NestJS",
    packageName: "@stackframe/js",
    groupId: "server-edge",
    imgSrc: "/nestjs-logo.svg",
    reverseIfDark: true,
    envPreset: null,
    usesStackHandler: false,
    usesProviders: false,
  },
  express: {
    id: "express",
    name: "Express",
    packageName: "@stackframe/js",
    groupId: "server-edge",
    imgSrc: "/express-logo.svg",
    reverseIfDark: true,
    envPreset: null,
    usesStackHandler: false,
    usesProviders: false,
  },
  hono: {
    id: "hono",
    name: "Hono",
    packageName: "@stackframe/js",
    groupId: "server-edge",
    imgSrc: "/hono-logo.svg",
    reverseIfDark: true,
    envPreset: null,
    usesStackHandler: false,
    usesProviders: false,
  },
  "cloudflare-workers": {
    id: "cloudflare-workers",
    name: "Cloudflare Workers",
    packageName: "@stackframe/js",
    groupId: "server-edge",
    imgSrc: "/cloudflare-workers-logo.svg",
    reverseIfDark: true,
    envPreset: null,
    usesStackHandler: false,
    usesProviders: false,
  },
};

export const setupFrameworkGroups: SetupFrameworkGroup[] = [
  {
    id: "react-apps",
    name: "React apps",
    frameworkIds: ["nextjs", "react-router", "tanstack-start"],
  },
  {
    id: "full-stack-js",
    name: "Full-stack JS",
    frameworkIds: ["nuxt", "sveltekit"],
  },
  {
    id: "server-edge",
    name: "Server / edge",
    frameworkIds: ["nestjs", "express", "hono", "cloudflare-workers"],
  },
];

export function getSetupFramework(id: SetupFrameworkId): SetupFramework {
  return setupFrameworks[id];
}
