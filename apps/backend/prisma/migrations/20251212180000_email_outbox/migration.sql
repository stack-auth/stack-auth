-- CreateEnum
CREATE TYPE "EmailOutboxStatus" AS ENUM (
    'PAUSED',
    'PREPARING',
    'RENDERING',
    'RENDER_ERROR',
    'SCHEDULED',
    'QUEUED',
    'SENDING',
    'SERVER_ERROR',
    'SENT',
    'SKIPPED',
    'DELIVERY_DELAYED',
    'BOUNCED',
    'OPENED',
    'CLICKED',
    'MARKED_AS_SPAM'
);

-- CreateEnum
CREATE TYPE "EmailOutboxSimpleStatus" AS ENUM ('IN_PROGRESS', 'ERROR', 'OK');

-- CreateEnum
CREATE TYPE "EmailOutboxSkippedReason" AS ENUM ('USER_UNSUBSCRIBED', 'USER_ACCOUNT_DELETED', 'USER_HAS_NO_PRIMARY_EMAIL');

-- CreateEnum
CREATE TYPE "EmailOutboxCreatedWith" AS ENUM ('DRAFT', 'PROGRAMMATIC_CALL');

-- CreateTable
CREATE TABLE "EmailOutbox" (
    "tenancyId" UUID NOT NULL,
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tsxSource" TEXT NOT NULL,
    "themeId" TEXT,
    "isHighPriority" BOOLEAN NOT NULL,
    "to" JSONB NOT NULL,
    "overrideSubject" TEXT,
    "overrideNotificationCategoryId" TEXT,
    "renderedIsTransactional" BOOLEAN,
    "renderedNotificationCategoryId" TEXT,
    "extraRenderVariables" JSONB NOT NULL,
    "createdWith" "EmailOutboxCreatedWith" NOT NULL,
    "emailDraftId" TEXT,
    "emailProgrammaticCallTemplateId" TEXT,
    "shouldSkipDeliverabilityCheck" BOOLEAN NOT NULL,
    "status" "EmailOutboxStatus" NOT NULL GENERATED ALWAYS AS (
        CASE
            -- paused
            WHEN "isPaused" THEN 'PAUSED'::"EmailOutboxStatus"

            -- starting, not rendering yet
            WHEN "startedRenderingAt" IS NULL THEN 'PREPARING'::"EmailOutboxStatus"
            
            -- rendering
            WHEN "finishedRenderingAt" IS NULL THEN 'RENDERING'::"EmailOutboxStatus"

            -- rendering error
            WHEN "renderErrorExternalMessage" IS NOT NULL THEN 'RENDER_ERROR'::"EmailOutboxStatus"

            -- queued or scheduled
            WHEN "startedSendingAt" IS NULL AND "isQueued" IS FALSE THEN 'SCHEDULED'::"EmailOutboxStatus"
            WHEN "startedSendingAt" IS NULL THEN 'QUEUED'::"EmailOutboxStatus"

            -- sending
            WHEN "finishedSendingAt" IS NULL THEN 'SENDING'::"EmailOutboxStatus"
            WHEN "canHaveDeliveryInfo" IS TRUE AND "deliveredAt" IS NULL THEN 'SENDING'::"EmailOutboxStatus"

            -- failed to send
            WHEN "sendServerErrorExternalMessage" IS NOT NULL THEN 'SERVER_ERROR'::"EmailOutboxStatus"
            WHEN "skippedReason" IS NOT NULL THEN 'SKIPPED'::"EmailOutboxStatus"

            -- delivered successfully
            WHEN "canHaveDeliveryInfo" IS FALSE THEN 'SENT'::"EmailOutboxStatus"
            WHEN "markedAsSpamAt" IS NOT NULL THEN 'MARKED_AS_SPAM'::"EmailOutboxStatus"
            WHEN "clickedAt" IS NOT NULL THEN 'CLICKED'::"EmailOutboxStatus"
            WHEN "openedAt" IS NOT NULL THEN 'OPENED'::"EmailOutboxStatus"
            WHEN "bouncedAt" IS NOT NULL THEN 'BOUNCED'::"EmailOutboxStatus"
            WHEN "deliveryDelayedAt" IS NOT NULL THEN 'DELIVERY_DELAYED'::"EmailOutboxStatus"
            ELSE 'SENT'::"EmailOutboxStatus"
        END
    ) STORED,
    "simpleStatus" "EmailOutboxSimpleStatus" NOT NULL GENERATED ALWAYS AS (
        CASE
            WHEN "renderErrorExternalMessage" IS NOT NULL OR "sendServerErrorExternalMessage" IS NOT NULL OR "bouncedAt" IS NOT NULL THEN 'ERROR'::"EmailOutboxSimpleStatus"
            WHEN "finishedSendingAt" IS NOT NULL AND ("skippedReason" IS NOT NULL OR "canHaveDeliveryInfo" IS FALSE OR "deliveredAt" IS NOT NULL) THEN 'OK'::"EmailOutboxSimpleStatus"
            WHEN "finishedSendingAt" IS NULL OR ("canHaveDeliveryInfo" IS TRUE AND "deliveredAt" IS NULL) THEN 'IN_PROGRESS'::"EmailOutboxSimpleStatus"
            ELSE 'OK'::"EmailOutboxSimpleStatus"
        END
    ) STORED,
    "priority" INTEGER NOT NULL GENERATED ALWAYS AS (
        (CASE WHEN "isHighPriority" THEN 100 ELSE 0 END) +
        (CASE WHEN "renderedIsTransactional" THEN 10 ELSE 0 END)
    ) STORED,
    "isPaused" BOOLEAN NOT NULL DEFAULT FALSE,
    "renderedByWorkerId" UUID,
    "startedRenderingAt" TIMESTAMP(3),
    "finishedRenderingAt" TIMESTAMP(3),
    "renderErrorExternalMessage" TEXT,
    "renderErrorExternalDetails" JSONB,
    "renderErrorInternalMessage" TEXT,
    "renderErrorInternalDetails" JSONB,
    "renderedHtml" TEXT,
    "renderedText" TEXT,
    "renderedSubject" TEXT,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "isQueued" BOOLEAN NOT NULL DEFAULT FALSE,
    "scheduledAtIfNotYetQueued" TIMESTAMP(3) GENERATED ALWAYS AS (
        CASE WHEN "isQueued" THEN NULL ELSE "scheduledAt" END
    ) STORED,
    "startedSendingAt" TIMESTAMP(3),
    "finishedSendingAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3) GENERATED ALWAYS AS (
        CASE
            WHEN "canHaveDeliveryInfo" IS TRUE THEN "deliveredAt"
            WHEN "canHaveDeliveryInfo" IS FALSE THEN "finishedSendingAt"
            ELSE NULL
        END
    ) STORED,
    "sendServerErrorExternalMessage" TEXT,
    "sendServerErrorExternalDetails" JSONB,
    "sendServerErrorInternalMessage" TEXT,
    "sendServerErrorInternalDetails" JSONB,
    "skippedReason" "EmailOutboxSkippedReason",
    "canHaveDeliveryInfo" BOOLEAN,
    "deliveredAt" TIMESTAMP(3),
    "deliveryDelayedAt" TIMESTAMP(3),
    "bouncedAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),
    "clickedAt" TIMESTAMP(3),
    "unsubscribedAt" TIMESTAMP(3),
    "markedAsSpamAt" TIMESTAMP(3),

    CONSTRAINT "EmailOutbox_pkey" PRIMARY KEY ("tenancyId", "id"),
    CONSTRAINT "EmailOutbox_tenancyId_fkey" FOREIGN KEY ("tenancyId") REFERENCES "Tenancy"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EmailOutbox_render_worker_pair_check"
        CHECK (("renderedByWorkerId" IS NULL) = ("startedRenderingAt" IS NULL)),
    CONSTRAINT "EmailOutbox_finished_rendering_check"
        CHECK ("finishedRenderingAt" IS NULL OR "startedRenderingAt" IS NOT NULL),
    CONSTRAINT "EmailOutbox_render_payload_when_not_finished_check"
        CHECK (
            "finishedRenderingAt" IS NOT NULL OR (
                "renderedHtml" IS NULL
                AND "renderedText" IS NULL
                AND "renderedSubject" IS NULL
                AND "renderedIsTransactional" IS NULL
                AND "renderedNotificationCategoryId" IS NULL
                AND "renderErrorExternalMessage" IS NULL
                AND "renderErrorExternalDetails" IS NULL
                AND "renderErrorInternalMessage" IS NULL
                AND "renderErrorInternalDetails" IS NULL
            )
        ),
    CONSTRAINT "EmailOutbox_render_payload_consistency_check"
        CHECK (
            "finishedRenderingAt" IS NULL OR (
                (
                    ("renderedHtml" IS NOT NULL OR "renderedText" IS NOT NULL OR "renderedSubject" IS NOT NULL OR "renderedIsTransactional" IS NOT NULL OR "renderedNotificationCategoryId" IS NOT NULL)
                    AND "renderErrorExternalMessage" IS NULL
                    AND "renderErrorExternalDetails" IS NULL
                    AND "renderErrorInternalMessage" IS NULL
                    AND "renderErrorInternalDetails" IS NULL
                ) OR (
                    ("renderedHtml" IS NULL AND "renderedText" IS NULL AND "renderedSubject" IS NULL AND "renderedIsTransactional" IS NULL AND "renderedNotificationCategoryId" IS NULL)
                    AND (
                        "renderErrorExternalMessage" IS NOT NULL
                        OR "renderErrorExternalDetails" IS NOT NULL
                        OR "renderErrorInternalMessage" IS NOT NULL
                        OR "renderErrorInternalDetails" IS NOT NULL
                    )
                )
            )
        ),
    CONSTRAINT "EmailOutbox_email_draft_check"
        CHECK ("createdWith" <> 'DRAFT' OR "emailDraftId" IS NOT NULL),
    CONSTRAINT "EmailOutbox_email_draft_reverse_check"
        CHECK ("emailDraftId" IS NULL OR "createdWith" = 'DRAFT'),
    CONSTRAINT "EmailOutbox_email_programmatic_call_template_check"
        CHECK ("createdWith" = 'PROGRAMMATIC_CALL' OR "emailProgrammaticCallTemplateId" IS NULL),
    CONSTRAINT "EmailOutbox_finished_sending_check"
        CHECK ("finishedSendingAt" IS NULL OR "startedSendingAt" IS NOT NULL),
    CONSTRAINT "EmailOutbox_send_payload_when_not_finished_check"
        CHECK (
            "finishedSendingAt" IS NOT NULL OR (
                "sendServerErrorExternalMessage" IS NULL
                AND "sendServerErrorExternalDetails" IS NULL
                AND "sendServerErrorInternalMessage" IS NULL
                AND "sendServerErrorInternalDetails" IS NULL
                AND "skippedReason" IS NULL
                AND "canHaveDeliveryInfo" IS NULL
                AND "deliveredAt" IS NULL
                AND "deliveryDelayedAt" IS NULL
                AND "bouncedAt" IS NULL
                AND "openedAt" IS NULL
                AND "clickedAt" IS NULL
                AND "unsubscribedAt" IS NULL
                AND "markedAsSpamAt" IS NULL
            )
        ),
    CONSTRAINT "EmailOutbox_can_have_delivery_info_check"
        CHECK (
            ("finishedSendingAt" IS NULL AND "canHaveDeliveryInfo" IS NULL)
            OR ("finishedSendingAt" IS NOT NULL AND "canHaveDeliveryInfo" IS NOT NULL)
        ),
    CONSTRAINT "EmailOutbox_delivery_status_check"
        CHECK (
            "canHaveDeliveryInfo" IS DISTINCT FROM FALSE OR (
                "deliveredAt" IS NULL
                AND "deliveryDelayedAt" IS NULL
                AND "bouncedAt" IS NULL
            )
        ),
    CONSTRAINT "EmailOutbox_delivery_exclusive_check"
        CHECK (
            (CASE WHEN "deliveredAt" IS NOT NULL THEN 1 ELSE 0 END) +
            (CASE WHEN "deliveryDelayedAt" IS NOT NULL THEN 1 ELSE 0 END) +
            (CASE WHEN "bouncedAt" IS NOT NULL THEN 1 ELSE 0 END)
            <= 1
        ),
    CONSTRAINT "EmailOutbox_click_implies_open_check"
        CHECK ("clickedAt" IS NULL OR "openedAt" IS NOT NULL)
);

-- CreateTable
CREATE TABLE "EmailOutboxProcessingMetadata" (
    "key" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastExecutedAt" TIMESTAMP(3),

    CONSTRAINT "EmailOutboxProcessingMetadata_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "EmailOutbox_status_tenancy_idx" ON "EmailOutbox" ("tenancyId", "status");

-- CreateIndex
CREATE INDEX "EmailOutbox_simple_status_tenancy_idx" ON "EmailOutbox" ("tenancyId", "simpleStatus");

-- CreateIndex
CREATE INDEX "EmailOutbox_render_queue_idx" ON "EmailOutbox" ("tenancyId", "createdAt") WHERE "renderedByWorkerId" IS NULL;

-- CreateIndex
CREATE INDEX "EmailOutbox_schedule_idx" ON "EmailOutbox" ("tenancyId", "scheduledAt") WHERE NOT "isQueued";

-- CreateIndex
CREATE INDEX "EmailOutbox_sending_idx" ON "EmailOutbox" ("tenancyId", "priority", "scheduledAt") WHERE "isQueued" AND "startedSendingAt" IS NULL;

-- CreateIndex
CREATE INDEX "EmailOutbox_ordering_idx"
    ON "EmailOutbox" (
        "tenancyId",
        "finishedSendingAt" DESC NULLS FIRST,
        "scheduledAtIfNotYetQueued" DESC NULLS LAST,
        "priority" ASC,
        "id" ASC
    );
