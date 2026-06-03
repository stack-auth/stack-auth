import { StackServerApp } from "@hexclave/next";
import { hexclaveClientApp } from "./client";

export const hexclaveServerApp = new StackServerApp({
  inheritsFrom: hexclaveClientApp,
});
