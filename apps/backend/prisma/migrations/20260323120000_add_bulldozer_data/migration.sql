-- CreateTable
CREATE TABLE "BulldozerStorageEngine" (
    "id" UUID NOT NULL,
    "keyPath" TEXT[] NOT NULL,
    "keyPathParent" TEXT[] GENERATED ALWAYS AS (
      CASE
        WHEN cardinality("keyPath") > 1 THEN "keyPath"[1:cardinality("keyPath") - 1]
        ELSE "keyPath"
      END
    ) STORED,
    "value" JSONB NOT NULL,

    CONSTRAINT "BulldozerStorageEngine_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "BulldozerStorageEngine_keyPath_key" UNIQUE ("keyPath"),
    CONSTRAINT "BulldozerStorageEngine_keyPath_non_empty_check" CHECK (cardinality("keyPath") >= 1),
    CONSTRAINT "BulldozerStorageEngine_keyPathParent_fkey"
      FOREIGN KEY ("keyPathParent")
      REFERENCES "BulldozerStorageEngine"("keyPath")
      ON DELETE CASCADE
);

-- CreateIndex
CREATE INDEX "BulldozerStorageEngine_keyPathParent_idx" ON "BulldozerStorageEngine"("keyPathParent");
