-- CreateTable
CREATE TABLE "BulldozerStorageEngine" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "keyPath" JSONB[] NOT NULL,
    "keyPathParent" JSONB[] GENERATED ALWAYS AS (
      CASE
        WHEN cardinality("keyPath") = 0 THEN NULL
        ELSE "keyPath"[1:cardinality("keyPath") - 1]
      END
    ) STORED,
    "value" JSONB NOT NULL,

    CONSTRAINT "BulldozerStorageEngine_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "BulldozerStorageEngine_keyPath_key" UNIQUE ("keyPath"),
    CONSTRAINT "BulldozerStorageEngine_keyPathParent_fkey"
      FOREIGN KEY ("keyPathParent")
      REFERENCES "BulldozerStorageEngine"("keyPath")
      ON DELETE CASCADE
);

-- Seed root hierarchy rows used by all tables.
INSERT INTO "BulldozerStorageEngine" ("id", "keyPath", "value")
VALUES
  ('00000000-0000-0000-0000-000000000100'::uuid, ARRAY[]::jsonb[], 'null'::jsonb);

INSERT INTO "BulldozerStorageEngine" ("id", "keyPath", "value")
VALUES
  ('00000000-0000-0000-0000-000000000101'::uuid, ARRAY[to_jsonb('table'::text)]::jsonb[], 'null'::jsonb);

-- CreateIndex
CREATE INDEX "BulldozerStorageEngine_keyPathParent_idx" ON "BulldozerStorageEngine"("keyPathParent");
