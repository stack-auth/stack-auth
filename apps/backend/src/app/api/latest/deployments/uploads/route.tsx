import { MAX_UPLOAD_BYTES, UPLOAD_EXPIRY_MS } from "@/lib/deployments";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, serverOrHigherAuthTypeSchema, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { urlString } from "@hexclave/shared/dist/utils/urls";

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Create deployment source upload",
    description: "Creates a short-lived upload slot for a deployment source tarball. PUT the gzipped tarball (application/octet-stream) to the returned upload path, then reference the upload id in the deploy request.",
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
      upload_path: yupString().defined(),
      expires_at_millis: yupNumber().defined(),
      max_bytes: yupNumber().defined(),
    }).defined(),
  }),
  handler: async ({ auth }) => {
    const prisma = await getPrismaClientForTenancy(auth.tenancy);
    // Opportunistic cleanup: uploads are single-use and short-lived, so any
    // expired leftovers (crashed CLI, abandoned deploys) get dropped here
    // instead of needing a background job.
    await prisma.deploymentSourceUpload.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    const upload = await prisma.deploymentSourceUpload.create({
      data: {
        tenancyId: auth.tenancy.id,
        expiresAt: new Date(Date.now() + UPLOAD_EXPIRY_MS),
      },
    });
    return {
      statusCode: 201,
      bodyType: "json",
      body: {
        id: upload.id,
        upload_path: urlString`/api/latest/deployments/uploads/${upload.id}`,
        expires_at_millis: upload.expiresAt.getTime(),
        max_bytes: MAX_UPLOAD_BYTES,
      },
    };
  },
});
