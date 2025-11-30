
CREATE TABLE  "OutgoingRequest" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "qstashOptions" JSONB NOT NULL,
    "fulfilledAt" TIMESTAMP(3),

    CONSTRAINT "OutgoingRequest_pkey" PRIMARY KEY ("id")
);


CREATE INDEX  "OutgoingRequest_fulfilledAt_idx" ON "OutgoingRequest"("fulfilledAt");

