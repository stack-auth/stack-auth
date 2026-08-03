// Smoke 5: R2 S3-compatible ops that Marshal depends on — direct PUT, presigned PUT/GET,
// ListObjectsV2 prefix listing, conditional writes (If-None-Match, for the domain registry),
// DeleteObject, public-URL GET. Also uploads the build-context tarball for smoke 06.
// Uses the repo's hoisted @aws-sdk packages.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { log } from "./lib.mjs";

const require = createRequire("/Users/bgodil/source/stack-auth/apps/backend/package.json");
const { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.S3_API_ENDPOINT,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  },
});
const BUCKET = process.env.S3_BUCKET_NAME;

// 1. Direct PUT of the build context tarball (for smoke 06)
const tarball = readFileSync(process.argv[2] ?? new URL("../../../../../../private/tmp/nonexistent", import.meta.url));
await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: "marshal-smoke/ctx.tar.gz", Body: tarball, ContentType: "application/gzip" }));
log(`direct PUT ctx.tar.gz (${tarball.length} bytes) OK`);

// 2. Public URL GET
const pub = await fetch(`${process.env.S3_PUBLIC_URL}/marshal-smoke/ctx.tar.gz`);
log(`public GET -> ${pub.status}, ${(await pub.arrayBuffer()).byteLength} bytes`);

// 3. Presigned PUT (the upload-slot mechanism)
const putUrl = await getSignedUrl(s3, new PutObjectCommand({ Bucket: BUCKET, Key: "marshal-smoke/presign-test.json", ContentType: "application/json" }), { expiresIn: 900 });
const putRes = await fetch(putUrl, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ hello: "marshal" }) });
log(`presigned PUT -> ${putRes.status}`);

// 3b. Presigned PUT with wrong content-type must fail (content-type is signed)
const putResBad = await fetch(putUrl, { method: "PUT", headers: { "content-type": "text/plain" }, body: "x" });
log(`presigned PUT wrong content-type -> ${putResBad.status} (expect 403)`);

// 4. Presigned GET
const getUrl = await getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: "marshal-smoke/presign-test.json" }), { expiresIn: 900 });
const getRes = await fetch(getUrl);
log(`presigned GET -> ${getRes.status}: ${await getRes.text()}`);

// 5. ListObjectsV2 with prefix
const list = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: "marshal-smoke/" }));
log(`ListObjectsV2 prefix=marshal-smoke/ -> ${list.KeyCount} keys:`, (list.Contents ?? []).map((c) => c.Key).join(", "));

// 6. Conditional write: If-None-Match * should fail on existing key, succeed on new key
//    (this is the atomic-claim primitive for the domain registry)
try {
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: "marshal-smoke/presign-test.json", Body: "overwrite", IfNoneMatch: "*" }));
  log("conditional PUT on existing key: SUCCEEDED (BAD — no conditional-write support?)");
} catch (e) {
  log(`conditional PUT on existing key: rejected as expected (${e.name}: ${e.$metadata?.httpStatusCode})`);
}
try {
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: "marshal-smoke/claim-test.json", Body: "claimed", IfNoneMatch: "*" }));
  log("conditional PUT on new key: OK");
} catch (e) {
  log(`conditional PUT on new key: FAILED (${e.name})`);
}

// 7. Cleanup the small test objects (ctx.tar.gz stays for smoke 06)
for (const key of ["marshal-smoke/presign-test.json", "marshal-smoke/claim-test.json"]) {
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}
log("cleanup of test objects OK. ctx.tar.gz remains for smoke 06.");
log("DONE");
