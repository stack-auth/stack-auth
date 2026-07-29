import { MAX_SECRETS_PER_PROJECT, MAX_SECRET_VALUE_LENGTH, SECRET_KEY_REGEX, listStoredSecrets } from "@/lib/deployments";
import { globalPrismaClient } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { encryptWithKms } from "@hexclave/shared/dist/helpers/vault/server-side";
import { adaptSchema, serverOrHigherAuthTypeSchema, yupArray, yupBoolean, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { StatusError } from "@hexclave/shared/dist/utils/errors";

// Values for the secrets referenced by `secret()` env vars in the config
// file's `services` export. WRITE-ONLY by design: values can be set,
// overwritten, and deleted, but never read back through any API — the backend
// decrypts them only at deploy time. Keyed by project (not branch): secrets
// are infrastructure credentials that branches share by design.

export const GET = createSmartRouteHandler({
  metadata: {
    summary: "List deployment secrets",
    description: "Lists the keys of the project's stored deployment secrets (never their values — secrets are write-only). Used by the dashboard's secrets page and by `hexclave deploy`'s pre-flight check for missing secrets.",
    tags: ["Deployments"],
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: serverOrHigherAuthTypeSchema,
      tenancy: adaptSchema.defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      items: yupArray(yupObject({
        key: yupString().defined(),
        created_at_millis: yupNumber().defined(),
        updated_at_millis: yupNumber().defined(),
      }).defined()).defined(),
    }).defined(),
  }),
  handler: async ({ auth }) => {
    const secrets = await listStoredSecrets(auth.tenancy.project.id);
    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        items: secrets.map((secret) => ({
          key: secret.key,
          created_at_millis: secret.createdAt.getTime(),
          updated_at_millis: secret.updatedAt.getTime(),
        })),
      },
    };
  },
});

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Set deployment secret",
    description: "Sets (or overwrites) the value of a deployment secret. The value is envelope-encrypted with KMS before it is stored and can never be read back — it is only decrypted server-side at deploy time.",
    tags: ["Deployments"],
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: serverOrHigherAuthTypeSchema,
      tenancy: adaptSchema.defined(),
    }).defined(),
    body: yupObject({
      key: yupString().defined().matches(SECRET_KEY_REGEX, "Secret keys must contain only letters, numbers, underscores, and hyphens"),
      value: yupString().defined(),
    }).defined(),
    method: yupString().oneOf(["POST"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      key: yupString().defined(),
      created: yupBoolean().defined(),
    }).defined(),
  }),
  handler: async ({ auth, body }) => {
    if (body.value.length === 0) {
      throw new StatusError(400, "Secret values must not be empty. To remove a secret, delete it instead.");
    }
    if (body.value.length > MAX_SECRET_VALUE_LENGTH) {
      throw new StatusError(400, `Secret values must be at most ${MAX_SECRET_VALUE_LENGTH} characters.`);
    }
    const projectId = auth.tenancy.project.id;
    const existing = await globalPrismaClient.deploymentSecret.findUnique({
      where: {
        projectId_key: {
          projectId,
          key: body.key,
        },
      },
      select: { id: true },
    });
    // Soft cap, checked only when this would insert a new row (overwrites of
    // existing keys are always allowed). It bounds the per-log-read KMS
    // decryption work in collectLogRedactionSecrets; the check is not atomic
    // with the write, so a burst of concurrent creates can slightly overshoot
    // — fine for a work bound, it is not an exact quota. (Same for `created`
    // below: two concurrent first-time sets may both report created: true,
    // which is response-cosmetic. A create-then-catch-P2002 dance would be
    // exact, but the driver-adapter's P2002 carries no meta.target, so
    // isPrismaUniqueConstraintViolation cannot classify it here.)
    if (existing == null) {
      const count = await globalPrismaClient.deploymentSecret.count({ where: { projectId } });
      if (count >= MAX_SECRETS_PER_PROJECT) {
        throw new StatusError(400, `This project already has ${MAX_SECRETS_PER_PROJECT} deployment secrets (the maximum). Delete unused secrets first.`);
      }
    }
    const encrypted = await encryptWithKms(body.value);
    await globalPrismaClient.deploymentSecret.upsert({
      where: {
        projectId_key: {
          projectId,
          key: body.key,
        },
      },
      update: {
        encrypted,
      },
      create: {
        projectId,
        key: body.key,
        encrypted,
      },
    });
    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        key: body.key,
        created: existing == null,
      },
    };
  },
});
