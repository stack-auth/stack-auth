/// <reference types="vite/client" />

import { StackClientApp } from "@hexclave/react";
import { useNavigate } from "react-router-dom";

export const hexclaveClientApp = new StackClientApp({
  projectId: import.meta.env.VITE_HEXCLAVE_PROJECT_ID || import.meta.env.VITE_STACK_PROJECT_ID,
  publishableClientKey: import.meta.env.VITE_HEXCLAVE_PUBLISHABLE_CLIENT_KEY || import.meta.env.VITE_STACK_PUBLISHABLE_CLIENT_KEY,
  baseUrl: import.meta.env.VITE_HEXCLAVE_API_URL || import.meta.env.VITE_STACK_API_URL,
  tokenStore: "cookie",
  redirectMethod: {
    useNavigate,
  }
});
