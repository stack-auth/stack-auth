import { StackClientApp } from "@hexclave/react";
import { useNavigate } from "react-router-dom";

export const hexclaveClientApp = new StackClientApp({ 
  tokenStore: "cookie",
  baseUrl: import.meta.env.VITE_STACK_API_URL,
  projectId: import.meta.env.VITE_STACK_PROJECT_ID, 
  publishableClientKey: import.meta.env.VITE_STACK_PUBLISHABLE_CLIENT_KEY,
  redirectMethod: {
    useNavigate,
  }, 
}); 
