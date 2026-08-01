import "server-only";

import { StackServerApp } from "@hexclave/next";

export const hexclaveServerApp = new StackServerApp({
  tokenStore: "nextjs-cookie",
  urls: {
    signIn: { type: "hosted" },
    signUp: { type: "custom", url: "/auth/sign-up", version: 0 },
    default: {
      "type": "hosted",
    },
  },
  // Product analytics + session replays (also enabled in hexclave.config.ts via
  // apps.installed.analytics). Capture defaults on with a persistent token store;
  // the explicit options below name this deployable and keep the demo as the
  // customer-facing reference for the constructor knobs.
  analytics: {
    enabled: true,
    replays: {
      enabled: true,
      captureKeystrokes: true,
      maskAllInputs: true,
    },
  },
  observability: {
    enabled: true,
  },
  telemetry: {
    resource: {
      service: { name: "example-demo" },
    },
  },
});
