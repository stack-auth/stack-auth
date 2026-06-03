import { StackServerApp } from "@hexclave/next";
import { stackClientApp } from "./client";

export const stackServerApp = new StackServerApp({
  inheritsFrom: stackClientApp,
});
