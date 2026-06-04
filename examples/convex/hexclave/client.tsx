import { StackClientApp } from "@hexclave/next";

export const hexclaveClientApp = new StackClientApp({
  tokenStore: "nextjs-cookie",
});
