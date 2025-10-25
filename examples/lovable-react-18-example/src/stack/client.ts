import { StackClientApp } from "@stackframe/react";
import { useNavigate } from "react-router-dom";

export const stackClientApp = new StackClientApp({ 
  tokenStore: "cookie", 
  projectId: 'INSERT_PROJECT_ID', 
  publishableClientKey: 'INSERT_YOUR_PUBLISHABLE_CLIENT_KEY_HERE',
  redirectMethod: {
    useNavigate,
  }, 
}); 
