-- Growth stage pages: the staff-authored page a customer reads under a hexagon
-- stage, instead of that stage's raw findings/notes/actions.
--
-- The table is created empty by this migration, so its CHECK constraints are
-- added inline rather than split into a NOT VALID migration plus a later
-- VALIDATE CONSTRAINT one (the pattern 20260806110000 / 20260806110001 needs).
-- Validating a constraint on a zero-row table takes no long lock. Any LATER
-- migration adding a constraint here must still split.
--
-- NOTE: "isDraft" and "isPublished" are hand-written GENERATED ALWAYS AS ...
-- STORED columns (Prisma cannot express generated columns; the schema declares
-- them as dbgenerated() defaults kept in sync with these expressions). Each is
-- TRUE in exactly one status and NULL otherwise, so the two unique indexes below
-- enforce "at most one draft per stage" and "at most one live version per stage"
-- as ordinary unique indexes (NULLs never collide) — the same technique as
-- GrowthQuizGame's two slots.
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
    -- The status vocabulary is enforced in the database as well as in the code: a
    -- row in an unknown status would fall out of BOTH generated columns, so it
    -- would be neither editable nor visible nor holding a slot — an invisible
    -- row, which is the worst failure mode for a publishing queue.
    CONSTRAINT "GrowthCategoryPage_status_check" CHECK ("status" IN ('draft', 'published', 'archived')),
    -- Same vocabulary as every other Growth category column (see
    -- 20260812000000_widen_growth_category_check): a page for a stage the hexagon
    -- does not render could never be read by anyone.
    CONSTRAINT "GrowthCategoryPage_category_check" CHECK ("category" IN ('product', 'reach', 'conversion', 'retention', 'revenue')),
    CONSTRAINT "GrowthCategoryPage_version_check" CHECK ("version" > 0),
    -- Publishing puts staff-written words in front of a customer, so it must never
    -- be anonymous in time: a live or previously-live version records when it went
    -- live.
    CONSTRAINT "GrowthCategoryPage_published_attribution_check" CHECK (
        "status" <> 'published' OR "publishedAt" IS NOT NULL
    )
);

-- CreateIndex
CREATE UNIQUE INDEX "GrowthCategoryPage_projectId_branchId_category_version_key" ON "GrowthCategoryPage"("projectId", "branchId", "category", "version");

-- CreateIndex
CREATE UNIQUE INDEX "GrowthCategoryPage_draft_slot" ON "GrowthCategoryPage"("projectId", "branchId", "category", "isDraft");

-- CreateIndex
-- This is the concurrency guard behind publishing: two staff publishing different
-- versions of the same stage at once must collide here rather than both go live.
CREATE UNIQUE INDEX "GrowthCategoryPage_published_slot" ON "GrowthCategoryPage"("projectId", "branchId", "category", "isPublished");

-- CreateIndex
CREATE INDEX "GrowthCategoryPage_projectId_branchId_category_version_idx" ON "GrowthCategoryPage"("projectId", "branchId", "category", "version" DESC);

-- AddForeignKey
ALTER TABLE "GrowthCategoryPage" ADD CONSTRAINT "GrowthCategoryPage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
