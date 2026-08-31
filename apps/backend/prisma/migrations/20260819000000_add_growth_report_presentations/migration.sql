-- CreateTable
CREATE TABLE "GrowthReportPresentation" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "reportId" UUID NOT NULL,
    "projectId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "tsxSource" TEXT NOT NULL,
    "actionItemIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "version" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT,
    "publishedAt" TIMESTAMP(3),
    "publishedByUserId" TEXT,

    CONSTRAINT "GrowthReportPresentation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GrowthReportPresentation_reportId_version_key"
ON "GrowthReportPresentation"("reportId", "version");

-- CreateIndex
CREATE INDEX "GrowthReportPresentation_reportId_createdAt_version_idx"
ON "GrowthReportPresentation"("reportId", "createdAt" DESC, "version" DESC);

-- CreateIndex
CREATE INDEX "GrowthReportPresentation_reportId_publishedAt_idx"
ON "GrowthReportPresentation"("reportId", "publishedAt");

-- CreateIndex
-- A report can have many authored versions, but only one may be live at a time.
CREATE UNIQUE INDEX "GrowthReportPresentation_one_published_per_report_key"
ON "GrowthReportPresentation"("reportId")
WHERE "publishedAt" IS NOT NULL;

-- AddForeignKey
ALTER TABLE "GrowthReportPresentation"
ADD CONSTRAINT "GrowthReportPresentation_reportId_fkey"
FOREIGN KEY ("reportId") REFERENCES "GrowthReport"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
