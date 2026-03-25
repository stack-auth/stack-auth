-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
-- CONDITIONALLY_REPEAT_MIGRATION_SENTINEL
WITH to_migrate AS (
    SELECT se."tenancyId", se."id"
    FROM "SentEmail" se
    WHERE EXISTS (
        SELECT 1 FROM "Tenancy" t WHERE t."id" = se."tenancyId"
    )
    AND NOT EXISTS (
        SELECT 1 FROM "EmailOutbox" eo 
        WHERE eo."tenancyId" = se."tenancyId" AND eo."id" = se."id"
    )
    LIMIT 10000
),
inserted AS (
    INSERT INTO "EmailOutbox" (
        "tenancyId",
        "id",
        "createdAt",
        "updatedAt",
        "tsxSource",
        "themeId",
        "renderedIsTransactional",
        "isHighPriority",
        "to",
        "renderedNotificationCategoryId",
        "extraRenderVariables",
        "createdWith",
        "emailDraftId",
        "emailProgrammaticCallTemplateId",
        "isPaused",
        "renderedByWorkerId",
        "startedRenderingAt",
        "finishedRenderingAt",
        "renderErrorExternalMessage",
        "renderErrorExternalDetails",
        "renderErrorInternalMessage",
        "renderErrorInternalDetails",
        "renderedHtml",
        "renderedText",
        "renderedSubject",
        "scheduledAt",
        "isQueued",
        "startedSendingAt",
        "finishedSendingAt",
        "sendServerErrorExternalMessage",
        "sendServerErrorExternalDetails",
        "sendServerErrorInternalMessage",
        "sendServerErrorInternalDetails",
        "skippedReason",
        "canHaveDeliveryInfo",
        "deliveredAt",
        "deliveryDelayedAt",
        "bouncedAt",
        "openedAt",
        "clickedAt",
        "unsubscribedAt",
        "markedAsSpamAt",
        "shouldSkipDeliverabilityCheck"
    )
    SELECT
        se."tenancyId",
        se."id",
        se."createdAt",
        se."updatedAt",
        'export function LegacyEmail() { throw new Error("This is a legacy email older than the EmailOutbox migration. Its tsx source code is no longer available."); }' AS "tsxSource",
        NULL,
        TRUE,
        FALSE,
        CASE
            WHEN se."userId" IS NOT NULL THEN jsonb_build_object(
                'type', 'user-custom-emails',
                'userId', se."userId",
                'emails', COALESCE(to_jsonb(se."to"), '[]'::jsonb)
            )
            ELSE jsonb_build_object(
                'type', 'custom-emails',
                'emails', COALESCE(to_jsonb(se."to"), '[]'::jsonb)
            )
        END,
        NULL,
        '{}'::jsonb,
        'PROGRAMMATIC_CALL',
        NULL,
        NULL,
        FALSE,
        gen_random_uuid(),
        se."createdAt",
        se."createdAt",
        NULL,
        NULL,
        NULL,
        NULL,
        se."html",
        se."text",
        se."subject",
        se."createdAt",
        TRUE,
        se."createdAt",
        se."updatedAt",
        CASE
            WHEN se."error" IS NULL THEN NULL
            ELSE COALESCE(se."error"->>'message', 'An unknown error occurred while sending the email.')
        END,
        CASE
            WHEN se."error" IS NULL THEN NULL
            ELSE jsonb_strip_nulls(jsonb_build_object(
                'legacyErrorType', se."error"->>'errorType',
                'legacyCanRetry', se."error"->>'canRetry'
            ))
        END,
        CASE
            WHEN se."error" IS NULL THEN NULL
            ELSE COALESCE(se."error"->>'message', se."error"->>'errorType', 'Legacy send error')
        END,
        se."error",
        NULL,
        FALSE,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        FALSE
    FROM "SentEmail" se
    INNER JOIN to_migrate tm ON se."tenancyId" = tm."tenancyId" AND se."id" = tm."id"
    ON CONFLICT ("tenancyId", "id") DO NOTHING
    RETURNING 1
)
SELECT COUNT(*) > 0 AS should_repeat_migration FROM inserted;
-- SPLIT_STATEMENT_SENTINEL

INSERT INTO "EmailOutboxProcessingMetadata" ("key", "createdAt", "updatedAt", "lastExecutedAt")
VALUES ('EMAIL_QUEUE_METADATA_KEY', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL)
ON CONFLICT ("key") DO NOTHING;

DROP TABLE IF EXISTS "SentEmail";
