// Smoke 99: delete every hxc-smoke-* Fly resource and all marshal-smoke/ bucket objects.
// Safe to run repeatedly. MUST be run at the end of any smoke session (personal org!).
import { createRequire } from "node:module";
import { deleteApp, flyMachines, log } from "./lib.mjs";

const apps = await flyMachines(`/apps?org_slug=${process.env.FLY_ORG_SLUG}`);
for (const app of apps.json.apps ?? []) {
  if (!app.name.startsWith("hxc-smoke-")) continue;
  const r = await deleteApp(app.name);
  log(`delete app ${app.name} -> ${r.status}`);
}
const remaining = await flyMachines(`/apps?org_slug=${process.env.FLY_ORG_SLUG}`);
const leftover = (remaining.json.apps ?? []).filter((a) => a.name.startsWith("hxc-smoke-"));
log(`remaining hxc-smoke apps: ${leftover.length === 0 ? "none" : leftover.map((a) => a.name).join(", ")}`);

const require = createRequire("/Users/bgodil/source/stack-auth/apps/backend/package.json");
const { S3Client, ListObjectsV2Command, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.S3_API_ENDPOINT,
  credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY },
});
const list = await s3.send(new ListObjectsV2Command({ Bucket: process.env.S3_BUCKET_NAME, Prefix: "marshal-smoke/" }));
for (const obj of list.Contents ?? []) {
  await s3.send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET_NAME, Key: obj.Key }));
  log(`deleted s3 object ${obj.Key}`);
}
log("DONE");
