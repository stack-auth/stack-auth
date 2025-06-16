import { StackServerApp } from '@stackframe/stack';
import "server-only";

// Need to create a mock stackServerApp instance with fake credentials so that real components do not work
// within the docs.
export const stackServerApp = new StackServerApp({
  tokenStore: "nextjs-cookie",
}); 
