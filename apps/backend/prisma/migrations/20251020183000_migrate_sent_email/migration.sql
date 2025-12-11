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
    jsonb_build_object(
        'type', 'custom-emails',
        'emails', COALESCE(to_jsonb(se."to"), '[]'::jsonb)
    ),
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
ON CONFLICT ("tenancyId", "id") DO NOTHING;

INSERT INTO "EmailOutboxProcessingMetadata" ("key", "createdAt", "updatedAt", "lastExecutedAt")
VALUES ('EMAIL_QUEUE_METADATA_KEY', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL)
ON CONFLICT ("key") DO NOTHING;

DROP TABLE IF EXISTS "SentEmail";
