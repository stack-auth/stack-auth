#!/usr/bin/env node
// Cross-platform auth-config injection/restoration for SpacetimeDB publish.
// Injects the allowed token issuers and expected audience (both non-secret)
// into the module source before `spacetime publish`, and restores the
// placeholders afterwards.
//
// The issuer is the INTERNAL TOOL itself: it serves the OIDC discovery
// document + JWKS and mints SpacetimeDB tokens after verifying the caller's
// Stack Auth session (see src/lib/server/spacetimedb-token.ts).
//
// - HEXCLAVE_SPACETIMEDB_ALLOWED_ISSUERS: comma-separated issuer URLs. Defaults
//   to HEXCLAVE_SPACETIMEDB_TOKEN_ISSUER, then the local dev internal tool.
// - HEXCLAVE_SPACETIMEDB_EXPECTED_AUDIENCE: JWT audience. Defaults to
//   "spacetimedb".

import { readFileSync, writeFileSync, existsSync, renameSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";

const TARGET = resolve("spacetimedb/src/index.ts");
const BACKUP = TARGET + ".bak";
const ISSUERS_PLACEHOLDER = "'__SPACETIMEDB_ALLOWED_ISSUERS__'";
const AUDIENCE_PLACEHOLDER = "'__SPACETIMEDB_EXPECTED_AUDIENCE__'";

function defaultDevIssuer() {
  const prefix = process.env.NEXT_PUBLIC_HEXCLAVE_PORT_PREFIX ?? "81";
  return `http://localhost:${prefix}41`;
}

function allowedIssuers() {
  const raw = process.env.HEXCLAVE_SPACETIMEDB_ALLOWED_ISSUERS || process.env.HEXCLAVE_SPACETIMEDB_TOKEN_ISSUER;
  if (!raw) return [defaultDevIssuer()];
  const issuers = raw.split(",").map((s) => s.trim().replace(/\/+$/, "")).filter((s) => s !== "");
  if (issuers.length === 0) {
    console.error(
      "HEXCLAVE_SPACETIMEDB_ALLOWED_ISSUERS (or HEXCLAVE_SPACETIMEDB_TOKEN_ISSUER) is set but contains no issuer URLs after parsing. Refusing to publish a module with an empty trusted-issuer list, as it would reject every token."
    );
    process.exit(1);
  }
  return issuers;
}

function expectedAudience() {
  return process.env.HEXCLAVE_SPACETIMEDB_EXPECTED_AUDIENCE || "spacetimedb";
}

const action = process.argv[2];

if (action === "inject") {
  if (existsSync(BACKUP)) {
    console.error("Refusing to inject: backup already exists. Run restore first.");
    process.exit(1);
  }
  const content = readFileSync(TARGET, "utf8");
  if (!content.includes(ISSUERS_PLACEHOLDER) || !content.includes(AUDIENCE_PLACEHOLDER)) {
    console.error("Auth-config placeholders not found in module source.");
    process.exit(1);
  }
  const issuersLiteral = allowedIssuers().map((issuer) => JSON.stringify(issuer)).join(", ");
  writeFileSync(BACKUP, content, "utf8");
  writeFileSync(
    TARGET,
    content
      .replaceAll(ISSUERS_PLACEHOLDER, issuersLiteral)
      .replaceAll(AUDIENCE_PLACEHOLDER, JSON.stringify(expectedAudience())),
    "utf8",
  );
} else if (action === "restore") {
  if (existsSync(BACKUP)) {
    if (existsSync(TARGET)) {
      unlinkSync(TARGET);
    }
    renameSync(BACKUP, TARGET);
  }
} else {
  console.error("Usage: node scripts/spacetime-auth-config.mjs <inject|restore>");
  process.exit(1);
}
