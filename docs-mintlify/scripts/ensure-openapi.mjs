import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const openApiDir = path.join(__dirname, "..", "openapi");
const required = ["client.json", "server.json", "admin.json", "webhooks.json"];
const missing = required.filter((f) => !fs.existsSync(path.join(openApiDir, f)));

if (missing.length > 0) {
  console.error(
    "docs-mintlify: missing OpenAPI files in openapi/:",
    missing.join(", "),
  );
  console.error(
    "Run from repo root: pnpm run --filter @stackframe/backend codegen-docs",
  );
  process.exit(1);
}
