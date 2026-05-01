#!/usr/bin/env node

function printHelp(): void {
  console.log(`Stack Auth migration utilities

This package is primarily intended to be used from migration scripts.

Example:
  import { createBetterAuthStackPersistence } from "@stackframe/migrations";

  const persistence = createBetterAuthStackPersistence();
  // Point Better Auth migration writes at persistence.adapter, then:
  await persistence.flushToStackAuth({ apiUrl, projectId, secretServerKey });
`);
}

printHelp();
