import { EmailOutbox, EmailOutboxSkippedReason, Prisma } from "@/generated/prisma/client";
import { serializeRecipient } from "@/lib/email-queue-step";
import { EmailOutboxRecipient } from "@/lib/emails";
import { globalPrismaClient } from "@/prisma-client";
import { createCrudHandlers } from "@/route-handlers/crud-handler";
import { KnownErrors } from "@stackframe/stack-shared";
import { emailOutboxCrud, EmailOutboxCrud } from "@stackframe/stack-shared/dist/interface/crud/email-outbox";
import { yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StackAssertionError, StatusError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { createLazyProxy } from "@stackframe/stack-shared/dist/utils/proxies";

/**
 * Converts an API recipient (snake_case: user_id) to the DB format (camelCase: userId).
 * This is necessary because the API uses snake_case for consistency with other endpoints,
 * but the database and worker code use camelCase.
 */
function apiRecipientToDb(apiRecipient: EmailOutboxCrud["Server"]["Update"]["to"]): EmailOutboxRecipient {
  if (!apiRecipient) {
    throw new StackAssertionError("Recipient is required");
  }
  switch (apiRecipient.type) {
    case "user-primary-email": {
      return { type: "user-primary-email", userId: apiRecipient.user_id };
    }
    case "user-custom-emails": {
      return { type: "user-custom-emails", userId: apiRecipient.user_id, emails: apiRecipient.emails };
    }
    case "custom-emails": {
      return { type: "custom-emails", emails: apiRecipient.emails };
    }
    default: {
      throw new StackAssertionError("Unknown recipient type", { apiRecipient });
    }
  }
}

// States that can be edited
const EDITABLE_STATUSES = new Set([
  "PAUSED",
  "PREPARING",
  "RENDERING",
  "RENDER_ERROR",
  "SCHEDULED",
  "QUEUED",
  "SERVER_ERROR",
]);

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- complex discriminated union types require type assertions
function prismaModelToCrud(prismaModel: EmailOutbox): EmailOutboxCrud["Server"]["Read"] {
  const recipient = prismaModel.to as any;
  let to: EmailOutboxCrud["Server"]["Read"]["to"];
  if (recipient?.type === "user-primary-email") {
    to = { type: "user-primary-email", user_id: recipient.userId };
  } else if (recipient?.type === "user-custom-emails") {
    to = { type: "user-custom-emails", user_id: recipient.userId, emails: recipient.emails ?? [] };
  } else {
    to = { type: "custom-emails", emails: recipient?.emails ?? [] };
  }

  // Base fields present on all emails
  const base = {
    id: prismaModel.id,
    created_at_millis: prismaModel.createdAt.getTime(),
    updated_at_millis: prismaModel.updatedAt.getTime(),
    tsx_source: prismaModel.tsxSource,
    theme_id: prismaModel.themeId,
    to,
    variables: (prismaModel.extraRenderVariables ?? {}) as Record<string, any>,
    skip_deliverability_check: prismaModel.shouldSkipDeliverabilityCheck,
    scheduled_at_millis: prismaModel.scheduledAt.getTime(),
    // Default flags (overridden in specific statuses)
    is_paused: false,
    has_rendered: false,
    has_delivered: false,
  };

  const status = prismaModel.status;

  // Rendered fields (available after rendering completes successfully)
  const hasRendered = prismaModel.finishedRenderingAt && !prismaModel.renderErrorExternalMessage;
  const rendered = hasRendered ? {
    started_rendering_at_millis: prismaModel.startedRenderingAt!.getTime(),
    rendered_at_millis: prismaModel.finishedRenderingAt!.getTime(),
    subject: prismaModel.renderedSubject ?? "",
    html: prismaModel.renderedHtml,
    text: prismaModel.renderedText,
    is_transactional: prismaModel.renderedIsTransactional ?? false,
    is_high_priority: prismaModel.isHighPriority,
    notification_category_id: prismaModel.renderedNotificationCategoryId,
    has_rendered: true,
  } : null;

  // Build the response based on status
  // Note: We use 'as any' casts because the EmailOutboxCrud["Server"]["Read"] type
  // is a complex discriminated union that TypeScript has difficulty inferring from
  // the object spread patterns used here.

  switch (status) {
    case "PAUSED": {
      return {
        ...base,
        status: "paused",
        simple_status: "in-progress",
        is_paused: true,
      };
    }
    case "PREPARING": {
      return {
        ...base,
        status: "preparing",
        simple_status: "in-progress",
      };
    }
    case "RENDERING": {
      return {
        ...base,
        status: "rendering",
        simple_status: "in-progress",
        started_rendering_at_millis: prismaModel.startedRenderingAt!.getTime(),
      };
    }
    case "RENDER_ERROR": {
      return {
        ...base,
        status: "render-error",
        simple_status: "error",
        started_rendering_at_millis: prismaModel.startedRenderingAt!.getTime(),
        rendered_at_millis: prismaModel.finishedRenderingAt!.getTime(),
        render_error: prismaModel.renderErrorExternalMessage ?? "Unknown render error",
      };
    }
    case "SCHEDULED": {
      return {
        ...base,
        ...rendered!,
        status: "scheduled",
        simple_status: "in-progress",
      };
    }
    case "QUEUED": {
      return {
        ...base,
        ...rendered!,
        status: "queued",
        simple_status: "in-progress",
      };
    }
    case "SENDING": {
      return {
        ...base,
        ...rendered!,
        status: "sending",
        simple_status: "in-progress",
        started_sending_at_millis: prismaModel.startedSendingAt!.getTime(),
      };
    }
    case "SERVER_ERROR": {
      return {
        ...base,
        ...rendered!,
        status: "server-error",
        simple_status: "error",
        started_sending_at_millis: prismaModel.startedSendingAt!.getTime(),
        error_at_millis: prismaModel.finishedSendingAt!.getTime(),
        server_error: prismaModel.sendServerErrorExternalMessage ?? "Unknown send error",
      };
    }
    case "SKIPPED": {
      // SKIPPED can happen at any time (like PAUSED), so rendering/sending fields are optional
      return {
        ...base,
        // Include rendered fields if available
        ...(rendered ? rendered : {}),
        // Override has_rendered based on whether we actually have rendered content
        has_rendered: !!rendered,
        status: "skipped",
        simple_status: "ok",
        skipped_at_millis: prismaModel.updatedAt.getTime(),
        skipped_reason: prismaModel.skippedReason ?? "UNKNOWN",
        skipped_details: (prismaModel.skippedDetails ?? {}) as Record<string, any>,
        // Optional rendering fields
        started_rendering_at_millis: prismaModel.startedRenderingAt?.getTime(),
        // Note: rendered_at_millis is included in the spread above if rendered
        // Optional sending fields
        started_sending_at_millis: prismaModel.startedSendingAt?.getTime(),
      };
    }
    case "BOUNCED": {
      return {
        ...base,
        ...rendered!,
        status: "bounced",
        simple_status: "error",
        started_sending_at_millis: prismaModel.startedSendingAt!.getTime(),
        bounced_at_millis: prismaModel.bouncedAt!.getTime(),
      };
    }
    case "DELIVERY_DELAYED": {
      return {
        ...base,
        ...rendered!,
        status: "delivery-delayed",
        simple_status: "ok",
        started_sending_at_millis: prismaModel.startedSendingAt!.getTime(),
        delivery_delayed_at_millis: prismaModel.deliveryDelayedAt!.getTime(),
      };
    }
    case "SENT": {
      return {
        ...base,
        ...rendered!,
        status: "sent",
        simple_status: "ok",
        started_sending_at_millis: prismaModel.startedSendingAt!.getTime(),
        delivered_at_millis: prismaModel.canHaveDeliveryInfo ? prismaModel.deliveredAt!.getTime() : prismaModel.finishedSendingAt!.getTime(),
        has_delivered: true,
        can_have_delivery_info: prismaModel.canHaveDeliveryInfo ?? throwErr("Email outbox is in SENT status but canHaveDeliveryInfo is not set", { emailOutboxId: prismaModel.id }),
      };
    }
    case "OPENED": {
      return {
        ...base,
        ...rendered!,
        status: "opened",
        simple_status: "ok",
        started_sending_at_millis: prismaModel.startedSendingAt!.getTime(),
        delivered_at_millis: prismaModel.deliveredAt!.getTime(),
        opened_at_millis: prismaModel.openedAt!.getTime(),
        has_delivered: true,
        can_have_delivery_info: true,
      };
    }
    case "CLICKED": {
      return {
        ...base,
        ...rendered!,
        status: "clicked",
        simple_status: "ok",
        started_sending_at_millis: prismaModel.startedSendingAt!.getTime(),
        delivered_at_millis: prismaModel.deliveredAt!.getTime(),
        clicked_at_millis: prismaModel.clickedAt!.getTime(),
        has_delivered: true,
        can_have_delivery_info: true,
      };
    }
    case "MARKED_AS_SPAM": {
      return {
        ...base,
        ...rendered!,
        status: "marked-as-spam",
        simple_status: "ok",
        started_sending_at_millis: prismaModel.startedSendingAt!.getTime(),
        delivered_at_millis: prismaModel.deliveredAt!.getTime(),
        marked_as_spam_at_millis: prismaModel.markedAsSpamAt!.getTime(),
        has_delivered: true,
        can_have_delivery_info: true,
      };
    }
  }
  throw new StackAssertionError(`Unknown email outbox status: ${status}`, { status });
}

export const emailOutboxCrudHandlers = createLazyProxy(() => createCrudHandlers(emailOutboxCrud, {
  paramsSchema: yupObject({
    id: yupString().uuid().optional(),
  }),
  querySchema: yupObject({
    status: yupString().optional(),
    simple_status: yupString().optional(),
  }),
  onRead: async ({ auth, params }) => {
    if (!params.id) {
      throw new StatusError(400, "Email ID is required");
    }

    const email = await globalPrismaClient.emailOutbox.findUnique({
      where: {
        tenancyId_id: {
          tenancyId: auth.tenancy.id,
          id: params.id,
        },
      },
    });

    if (!email) {
      throw new StatusError(404, "Email not found");
    }

    return prismaModelToCrud(email);
  },
  onList: async ({ auth, query }) => {
    const where: Prisma.EmailOutboxWhereInput = {
      tenancyId: auth.tenancy.id,
    };

    // Convert API format (lowercase-with-dashes) to database format (UPPERCASE_WITH_UNDERSCORES)
    if (query.status) {
      where.status = query.status.toUpperCase().replace(/-/g, "_") as any;
    }
    if (query.simple_status) {
      where.simpleStatus = query.simple_status.toUpperCase().replace(/-/g, "_") as any;
    }

    const emails = await globalPrismaClient.emailOutbox.findMany({
      where,
      orderBy: [
        { finishedSendingAt: "desc" },
        { scheduledAtIfNotYetQueued: "desc" },
        { priority: "asc" },
        { id: "asc" },
      ],
      take: 100,
    });

    return {
      items: emails.map(prismaModelToCrud),
      is_paginated: false,
    };
  },
  onUpdate: async ({ auth, params, data }) => {
    if (!params.id) {
      throw new StatusError(400, "Email ID is required");
    }

    const email = await globalPrismaClient.emailOutbox.findUnique({
      where: {
        tenancyId_id: {
          tenancyId: auth.tenancy.id,
          id: params.id,
        },
      },
    });

    if (!email) {
      throw new StatusError(404, "Email not found");
    }

    // Check if email is in an editable state
    if (!EDITABLE_STATUSES.has(email.status)) {
      throw new KnownErrors.EmailNotEditable(email.id, email.status);
    }

    // Handle cancel action
    // SKIPPED can now happen at any time, so we just set the skipped reason
    if (data.cancel) {
      const updateData: Prisma.EmailOutboxUpdateInput = {
        // Ensure email is not paused (so status can become SKIPPED, not PAUSED)
        isPaused: false,
        // Set skip reason - this alone will make the status become SKIPPED
        skippedReason: EmailOutboxSkippedReason.MANUALLY_CANCELLED,
        skippedDetails: {},
      };

      const updated = await globalPrismaClient.emailOutbox.update({
        where: {
          tenancyId_id: {
            tenancyId: auth.tenancy.id,
            id: params.id,
          },
        },
        data: updateData,
      });
      return prismaModelToCrud(updated);
    }

    // Build update data
    const updateData: Prisma.EmailOutboxUpdateInput = {};
    let needsRerenderReset = false;

    if (data.tsx_source !== undefined) {
      updateData.tsxSource = data.tsx_source;
      needsRerenderReset = true;
    }
    if (data.theme_id !== undefined) {
      updateData.themeId = data.theme_id;
      needsRerenderReset = true;
    }
    if (data.to !== undefined) {
      // Convert API format (snake_case: user_id) to DB format (camelCase: userId)
      const internalRecipient = apiRecipientToDb(data.to);
      // serializeRecipient always returns a valid JSON object for valid recipients
      updateData.to = serializeRecipient(internalRecipient) as Prisma.InputJsonValue;
      needsRerenderReset = true;
    }
    if (data.variables !== undefined) {
      updateData.extraRenderVariables = data.variables as any;
      needsRerenderReset = true;
    }
    if (data.skip_deliverability_check !== undefined) {
      updateData.shouldSkipDeliverabilityCheck = data.skip_deliverability_check;
    }
    if (data.scheduled_at_millis !== undefined) {
      updateData.scheduledAt = new Date(data.scheduled_at_millis);
      updateData.isQueued = false;
    }
    if (data.is_paused !== undefined) {
      updateData.isPaused = data.is_paused;
    }

    // If content changed, reset rendering state
    if (needsRerenderReset) {
      updateData.renderedByWorkerId = null;
      updateData.startedRenderingAt = null;
      updateData.finishedRenderingAt = null;
      updateData.renderErrorExternalMessage = null;
      updateData.renderErrorExternalDetails = Prisma.DbNull;
      updateData.renderErrorInternalMessage = null;
      updateData.renderErrorInternalDetails = Prisma.DbNull;
      updateData.renderedHtml = null;
      updateData.renderedText = null;
      updateData.renderedSubject = null;
      updateData.renderedIsTransactional = null;
      updateData.renderedNotificationCategoryId = null;
      updateData.isQueued = false;
      // Also reset sending state if applicable
      updateData.startedSendingAt = null;
      updateData.finishedSendingAt = null;
      updateData.sendServerErrorExternalMessage = null;
      updateData.sendServerErrorExternalDetails = Prisma.DbNull;
      updateData.sendServerErrorInternalMessage = null;
      updateData.sendServerErrorInternalDetails = Prisma.DbNull;
      updateData.skippedReason = null;
      updateData.skippedDetails = Prisma.DbNull;
      updateData.canHaveDeliveryInfo = null;
      updateData.deliveredAt = null;
      updateData.deliveryDelayedAt = null;
      updateData.bouncedAt = null;
      updateData.openedAt = null;
      updateData.clickedAt = null;
      updateData.unsubscribedAt = null;
      updateData.markedAsSpamAt = null;
    }

    const updated = await globalPrismaClient.emailOutbox.update({
      where: {
        tenancyId_id: {
          tenancyId: auth.tenancy.id,
          id: params.id,
        },
      },
      data: updateData,
    });

    return prismaModelToCrud(updated);
  },
}));

