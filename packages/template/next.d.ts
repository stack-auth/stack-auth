// Classic (node10) resolution looks for this file when resolving
// `@hexclave/next/next`. Package `"exports"` already covers bundler/Node16+;
// keep this shim so editors that typecheck outside the app tsconfig still work.
export * from "./dist/integrations/next";
