import { MAX_UPLOAD_BYTES, UPLOAD_EXPIRY_MS } from "@/lib/deployments";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { createPresignedUploadUrl } from "@/s3";
import { adaptSchema, serverOrHigherAuthTypeSchema, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

const DEPLOYMENT_SOURCE_CONTENT_TYPE = "application/gzip";

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Create deployment source upload",
    description: "Creates a short-lived upload slot for a deployment source tarball. PUT the gzipped tarball directly to the returned private object-storage URL with the required content type, then reference the upload id in the deploy request.",
    tags: ["Deployments"],
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
    // the deployment-source-uploads/ lifecycle rule because an abandoned CLI
    // never makes another authenticated request we could use for cleanup.
    await prisma.deploymentSourceUpload.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    const uploadId = crypto.randomUUID();
    const objectKey = `deployment-source-uploads/${auth.tenancy.id}/${uploadId}.tar.gz`;
    const uploadUrl = await createPresignedUploadUrl({
      key: objectKey,
      expiresInSeconds: Math.ceil(UPLOAD_EXPIRY_MS / 1000),
      contentType: DEPLOYMENT_SOURCE_CONTENT_TYPE,
      private: true,
    });
    const upload = await prisma.deploymentSourceUpload.create({
      data: {
        id: uploadId,
        tenancyId: auth.tenancy.id,
        objectKey,
        expiresAt: new Date(Date.now() + UPLOAD_EXPIRY_MS),
      },
    });
    return {
      statusCode: 201,
      bodyType: "json",
      body: {
        id: upload.id,
        upload_url: uploadUrl,
        content_type: DEPLOYMENT_SOURCE_CONTENT_TYPE,
        expires_at_millis: upload.expiresAt.getTime(),
        max_bytes: MAX_UPLOAD_BYTES,
      },
    };
  },
});
