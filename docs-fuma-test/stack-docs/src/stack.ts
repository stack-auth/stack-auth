import { StackServerApp } from '@stackframe/stack';
import "server-only";

// Create a mock stackServerApp instance with fake credentials
// This will still use the real components but won't try to connect to the real Stack Auth service
export const stackServerApp = new StackServerApp({
  tokenStore: "nextjs-cookie",
}); 
