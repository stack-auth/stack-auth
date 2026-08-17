import { marshalNamespaceForTenancy } from "@/lib/deployments";
import { getMarshalClientOrThrow, sanitizeMarshalError } from "@/lib/deployments/marshal-client";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, serverOrHigherAuthTypeSchema, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

const DEPLOYMENT_SOURCE_CONTENT_TYPE = "application/gzip";

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Create deployment source upload",
    description: "Creates a short-lived upload slot for a deployment source tarball. PUT the gzipped tarball directly to the returned object-storage URL with the required content type, then reference the upload id in the deploy request.",
    tags: ["Deploy"],
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: serverOrHigherAuthTypeSchema,
      tenancy: adaptSchema.defined(),
    }).defined(),
    method: yupString().oneOf(["POST"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([201]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      id: yupString().defined(),
      upload_url: yupString().defined(),
      content_type: yupString().oneOf([DEPLOYMENT_SOURCE_CONTENT_TYPE]).defined(),
      expires_at_millis: yupNumber().defined(),
      max_bytes: yupNumber().defined(),
    }).defined(),
  }),
  handler: async ({ auth }) => {
    const prisma = await getPrismaClientForTenancy(auth.tenancy);
    // Opportunistically drop expired references. Their objects are covered by
    // the Marshal bucket's uploads/ lifecycle rule because an abandoned CLI
    // never makes another authenticated request we could use for cleanup.
    await prisma.deploymentSourceUpload.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    // The slot lives in Marshal's bucket (its builders pull the tarball from
    // there); the backend row is what makes it consumable exactly once.
    const client = getMarshalClientOrThrow();
    let slot;
    try {
      slot = await client.createUpload(marshalNamespaceForTenancy(auth.tenancy));
    } catch (e) {
      sanitizeMarshalError(e, "Creating the upload slot failed");
    }
    const upload = await prisma.deploymentSourceUpload.create({
      data: {
        tenancyId: auth.tenancy.id,
        marshalUploadId: slot.id,
        expiresAt: new Date(slot.expires_at_millis),
      },
    });
    return {
      statusCode: 201,
      bodyType: "json",
      body: {
        id: upload.id,
        upload_url: slot.upload_url,
        content_type: DEPLOYMENT_SOURCE_CONTENT_TYPE,
        expires_at_millis: slot.expires_at_millis,
        max_bytes: slot.max_bytes,
      },
    };
  },
});
