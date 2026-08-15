import { createProductionErrorAttachmentService, ErrorAttachmentNotFoundError } from "@/lib/attachments";
import { validateErrorAttachmentScope } from "@/lib/attachments/attachment-contract";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import type { SmartResponse } from "@/route-handlers/smart-response";
import { KnownErrors } from "@hexclave/shared";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupMixed, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { StatusError } from "@hexclave/shared/dist/utils/errors";

export const GET = createSmartRouteHandler({
  metadata: {
    summary: "Download an error attachment",
    description: "Returns one authenticated private attachment as bounded base64 bytes with immutable metadata.",
    tags: ["Analytics Events"],
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({ type: clientOrHigherAuthTypeSchema, tenancy: adaptSchema.defined() }).defined(),
    params: yupObject({ attachment_id: yupString().uuid().defined() }).defined(),
    method: yupString().oneOf(["GET"]).defined(),
  }).defined(),
  response: yupMixed<SmartResponse>().defined(),
  async handler({ auth, params }) {
    if (!auth.tenancy.config.apps.installed.observability?.enabled) throw new KnownErrors.ObservabilityNotEnabled();
    const service = await createProductionErrorAttachmentService(auth.tenancy);
    try {
      const result = await service.download(
        validateErrorAttachmentScope({ tenantId: auth.tenancy.id, projectId: auth.tenancy.project.id, branchId: auth.tenancy.branchId }),
        params.attachment_id,
      );
      return {
        statusCode: 200,
        bodyType: "binary",
        body: result.bytes,
        headers: {
          "content-type": [result.attachment.contentType],
          "content-length": [String(result.attachment.byteLength)],
          "content-disposition": [`attachment; filename*=UTF-8''${encodeURIComponent(result.attachment.filename)}`],
          "x-hexclave-attachment-id": [result.attachment.id],
          "x-hexclave-attachment-sha256": [result.attachment.sha256],
        },
      } as const;
    } catch (error) {
      // Match the not-found case by type, not by message text: the service also
      // throws ErrorAttachmentNotFoundError("Attachment bytes are not available")
      // when the metadata row exists but the backing object is gone, and every
      // absent-attachment case must be the same 404. Anything else (storage
      // outage, integrity mismatch) is an internal fault — rethrow so the
      // generic 500 handler logs it without reflecting details to the caller.
      if (error instanceof ErrorAttachmentNotFoundError) throw new StatusError(StatusError.NotFound, "Attachment not found");
      throw error;
    }
  },
});
