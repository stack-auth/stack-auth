import { MAX_UPLOAD_BYTES } from "@/lib/deployments";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, serverOrHigherAuthTypeSchema, yupBoolean, yupMixed, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { StatusError } from "@hexclave/shared/dist/utils/errors";

export const PUT = createSmartRouteHandler({
  metadata: {
    summary: "Upload deployment source tarball",
    description: "Uploads the gzipped source tarball (application/octet-stream) into a previously created upload slot. Single use: an upload slot can be filled exactly once.",
    tags: ["Deployments"],
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: serverOrHigherAuthTypeSchema,
      tenancy: adaptSchema.defined(),
    }).defined(),
    params: yupObject({
      upload_id: yupString().uuid().defined(),
    }).defined(),
    // application/octet-stream bodies arrive as a raw byte buffer.
    body: yupMixed<Uint8Array>().defined(),
    method: yupString().oneOf(["PUT"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      success: yupBoolean().oneOf([true]).defined(),
      byte_length: yupNumber().defined(),
    }).defined(),
  }),
  handler: async ({ auth, params, body }) => {
    let bytes: Uint8Array;
    if (body instanceof Uint8Array) {
      bytes = body;
    } else if ((body as unknown) instanceof ArrayBuffer) {
      bytes = new Uint8Array(body as unknown as ArrayBuffer);
    } else {
      throw new StatusError(400, "The upload body must be sent as application/octet-stream.");
    }
    if (bytes.length === 0) {
      throw new StatusError(400, "The uploaded tarball is empty.");
    }
    if (bytes.length > MAX_UPLOAD_BYTES) {
      throw new StatusError(StatusError.PayloadTooLarge, `The uploaded tarball is too large (max ${MAX_UPLOAD_BYTES} bytes).`);
    }
    const prisma = await getPrismaClientForTenancy(auth.tenancy);
    const upload = await prisma.deploymentSourceUpload.findUnique({
      where: {
        tenancyId_id: {
          tenancyId: auth.tenancy.id,
          id: params.upload_id,
        },
      },
    });
    if (upload == null || upload.expiresAt < new Date()) {
      throw new StatusError(404, "Upload not found or expired. Create a new upload slot and try again.");
    }
    if (upload.data != null) {
      throw new StatusError(400, "This upload slot has already been used. Create a new upload slot and try again.");
    }
    await prisma.deploymentSourceUpload.update({
      where: {
        tenancyId_id: {
          tenancyId: auth.tenancy.id,
          id: params.upload_id,
        },
      },
      data: { data: Buffer.from(bytes) },
    });
    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        success: true,
        byte_length: bytes.length,
      },
    };
  },
});
