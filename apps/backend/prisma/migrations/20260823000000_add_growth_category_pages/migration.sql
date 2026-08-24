-- CreateTable
CREATE TABLE "GrowthCategoryPage" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "projectId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "sourceJson" JSONB NOT NULL,
    "document" JSONB NOT NULL,
    "sourceItemIds" JSONB NOT NULL,
    "authoredByUserId" TEXT,
    "publishedByUserId" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "isDraft" BOOLEAN GENERATED ALWAYS AS (
        CASE
            WHEN "status" = 'draft' THEN TRUE
            ELSE NULL
        END
    ) STORED,
    "isPublished" BOOLEAN GENERATED ALWAYS AS (
        CASE
            WHEN "status" = 'published' THEN TRUE
            ELSE NULL
        END
    ) STORED,

    CONSTRAINT "GrowthCategoryPage_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "GrowthCategoryPage_status_check" CHECK ("status" IN ('draft', 'published', 'archived')),
    CONSTRAINT "GrowthCategoryPage_category_check" CHECK ("category" IN ('product', 'reach', 'conversion', 'retention', 'revenue')),
    CONSTRAINT "GrowthCategoryPage_version_check" CHECK ("version" > 0),
    CONSTRAINT "GrowthCategoryPage_published_attribution_check" CHECK (
        "status" <> 'published' OR "publishedAt" IS NOT NULL
    )
);

-- CreateIndex
CREATE UNIQUE INDEX "GrowthCategoryPage_projectId_branchId_category_version_key" ON "GrowthCategoryPage"("projectId", "branchId", "category", "version");

-- CreateIndex
CREATE UNIQUE INDEX "GrowthCategoryPage_draft_slot" ON "GrowthCategoryPage"("projectId", "branchId", "category", "isDraft");

-- CreateIndex
CREATE UNIQUE INDEX "GrowthCategoryPage_published_slot" ON "GrowthCategoryPage"("projectId", "branchId", "category", "isPublished");

-- CreateIndex
CREATE INDEX "GrowthCategoryPage_projectId_branchId_category_version_idx" ON "GrowthCategoryPage"("projectId", "branchId", "category", "version" DESC);

-- AddForeignKey
ALTER TABLE "GrowthCategoryPage" ADD CONSTRAINT "GrowthCategoryPage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
